/**
 * MODULE 4 — voice AI pipeline
 * src/shifts/voice-parser.ts
 * Section 11: audio -> Groq Whisper transcript -> Gemini structured JSON ->
 * server-side client matching -> preview response. Never saves a shift.
 * Audio and transcript are never persisted or logged (Section 11.6).
 */
import { prisma } from '../config/database';
import { ApiError } from '../utils/ApiError';
import { logger } from '../config/logger';
import { voiceParseAiSchema, VoiceParseAiOutput } from './shift.validators';

const GROQ_TIMEOUT_MS = 20_000;
const GEMINI_TIMEOUT_MS = 30_000;
const NDIS_NUMBER_RE = /\b\d{9}\b/g;

/** Groq accepts these containers; the filename extension must match the audio. */
const AUDIO_EXTENSION_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
};
/** Gemini model — 1.5 Flash is retired; override with GEMINI_MODEL if needed. */
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash';
/**
 * Free-tier capacity errors are common, and Google also retires models for new
 * keys (gemini-2.5-flash already 404s). Try the configured model first, then
 * stable fallbacks, instead of failing the whole voice request.
 */
const GEMINI_MODEL_CHAIN = [GEMINI_MODEL, 'gemini-flash-latest', 'gemini-3.1-flash-lite'].filter(
  (model, index, all) => Boolean(model) && all.indexOf(model) === index
);

function redact(text: string): { text: string; redacted: boolean } {
  const redacted = NDIS_NUMBER_RE.test(text);
  NDIS_NUMBER_RE.lastIndex = 0;
  return { text: text.replace(NDIS_NUMBER_RE, '[redacted]'), redacted };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, errorCode: string, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(ApiError.gatewayTimeout(message, errorCode)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 700;
const MAX_ATTEMPTS = 3;

/**
 * Free-tier providers (Groq/Gemini) intermittently return 429/503 under load.
 * One quick retry turns those transient failures into successful voice parses
 * instead of a user-visible "voice timed out" error.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  errorCode: string,
  timeoutMessage: string
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withTimeout(fetch(url, init), timeoutMs, errorCode, timeoutMessage);
      if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS - 1) return res;
      lastError = new Error(`provider responded ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS - 1) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error('provider request failed');
}

/** Step 1 — Groq Whisper transcription (Section 11.4). */
async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw ApiError.serviceUnavailable('Voice AI is not configured', 'VOICE_UNAVAILABLE');

  const form = new FormData();
  // Groq infers the container format from the filename extension and rejects an
  // extension-less upload with `unsupported_audio_format`. Always send one.
  const extension = AUDIO_EXTENSION_BY_MIME[mimeType] ?? 'webm';
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), `shift.${extension}`);
  form.append('model', 'whisper-large-v3');
  form.append('language', 'en');
  form.append('response_format', 'json');
  form.append('temperature', '0');

  const res = await fetchWithRetry(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
    GROQ_TIMEOUT_MS,
    'VOICE_TRANSCRIPTION_FAILED',
    'Voice transcription timed out',
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.warn('Groq transcription rejected the upload', { status: res.status, detail: detail.slice(0, 300) });
    if (res.status === 400 || res.status === 415) {
      throw ApiError.unsupportedMediaType('That audio format is not supported on this device.', 'INVALID_AUDIO_FORMAT');
    }
    if (res.status === 401 || res.status === 403) {
      throw ApiError.serviceUnavailable('Voice transcription is not configured correctly.', 'VOICE_UNAVAILABLE');
    }
    throw ApiError.gatewayTimeout('Voice transcription failed', 'VOICE_TRANSCRIPTION_FAILED');
  }
  const json = (await res.json()) as { text?: string };
  const transcript = (json.text ?? '').trim();
  if (transcript.split(/\s+/).filter(Boolean).length < 3) {
    throw ApiError.unprocessable('Transcript was too short or unclear', 'VOICE_TRANSCRIPT_UNUSABLE');
  }
  return transcript;
}

/** Step 2 — Gemini structured extraction (Section 11.5). */
async function structureTranscript(
  transcript: string,
  currentDate: string,
  timezone: string,
): Promise<VoiceParseAiOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw ApiError.serviceUnavailable('Voice AI is not configured', 'VOICE_UNAVAILABLE');

  const { text: safeTranscript, redacted } = redact(transcript);

  const prompt = `You convert a support worker's spoken shift summary into structured JSON.
Do not include any surnames, NDIS numbers, addresses, or dates of birth in the output.
Resolve relative dates ("today", "yesterday", "last Friday") against currentDate=${currentDate} in timezone=${timezone}.
Normalise all times to 24-hour "HH:mm". Return null for anything you cannot determine — never invent numbers.
Output ONLY a JSON object matching this schema:
{"clientFirstName": string|null, "shiftDate": "YYYY-MM-DD"|null, "startTime": "HH:mm"|null, "endTime": "HH:mm"|null, "travelKms": number|null, "caseNotes": string|null, "confidence": number, "missingFields": string[]}

Transcript: """${safeTranscript}"""`;

  let raw: string | undefined;
  let lastStatus = 0;

  for (const model of GEMINI_MODEL_CHAIN) {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      },
      GEMINI_TIMEOUT_MS,
      'VOICE_PARSE_FAILED',
      'Voice parsing timed out',
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      lastStatus = res.status;
      logger.warn('Gemini structured extraction failed', {
        status: res.status,
        model,
        detail: detail.slice(0, 300),
      });
      if (res.status === 401 || res.status === 403) {
        throw ApiError.serviceUnavailable('Voice parsing is not configured correctly.', 'VOICE_UNAVAILABLE');
      }
      continue; // try the next model in the chain
    }

    const json = await res.json();
    const candidate = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof candidate === 'string' && candidate.trim()) {
      try {
        JSON.parse(candidate);
        raw = candidate;
        break;
      } catch {
        logger.warn('Gemini returned non-JSON output', { model, detail: candidate.slice(0, 200) });
        continue;
      }
    }
  }

  if (!raw) {
    logger.warn('All Gemini models failed for voice parsing', { chain: GEMINI_MODEL_CHAIN, lastStatus });
    throw ApiError.gatewayTimeout('Voice parsing failed', 'VOICE_PARSE_FAILED');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw ApiError.gatewayTimeout('Voice parsing returned an unusable response', 'VOICE_PARSE_FAILED');
  }

  const result = voiceParseAiSchema.parse(parsed);
  if (result.caseNotes) {
    result.caseNotes = redact(result.caseNotes).text;
  }
  return { ...result, redactedFlag: redacted } as VoiceParseAiOutput & { redactedFlag?: boolean };
}

/** Step 3 — server-side client matching, no AI involved (Section 11.7). */
async function matchClient(businessId: string, firstName: string | null) {
  const clients = await prisma.client.findMany({
    where: { businessId, isActive: true, deletedAt: null },
    select: { id: true, participantName: true, ndisNumber: true },
    take: 200,
  });

  if (!firstName) {
    return { matchedClientId: null as string | null, candidates: clients.slice(0, 5), noParticipants: clients.length === 0 };
  }

  const needle = firstName.trim().toLowerCase();
  const exact = clients.filter((c) => c.participantName.split(/\s+/)[0]?.toLowerCase() === needle);
  if (exact.length === 1) {
    return { matchedClientId: exact[0].id, candidates: exact.slice(0, 5), noParticipants: false };
  }

  const prefix = clients.filter((c) => c.participantName.toLowerCase().startsWith(needle));
  if (prefix.length > 0) {
    return { matchedClientId: null, candidates: prefix.slice(0, 5), noParticipants: false };
  }

  return { matchedClientId: null, candidates: clients.slice(0, 5), noParticipants: clients.length === 0 };
}

export interface VoiceParseResult {
  transcriptPreview: string;
  parsed: VoiceParseAiOutput;
  matchedClientId: string | null;
  clientCandidates: Array<{ id: string; participantName: string; ndisNumber: string }>;
  ndisNumberRedacted: boolean;
  warnings: string[];
}

export async function runVoicePipeline(
  businessId: string,
  audio: { buffer: Buffer; mimeType: string },
  timezone: string,
): Promise<VoiceParseResult> {
  const transcript = await transcribeAudio(audio.buffer, audio.mimeType);
  const currentDate = new Date().toISOString().slice(0, 10);
  const parsed = await structureTranscript(transcript, currentDate, timezone);

  const { matchedClientId, candidates, noParticipants } = await matchClient(businessId, parsed.clientFirstName);

  const warnings: string[] = [];
  if (parsed.confidence < 0.5) warnings.push('LOW_CONFIDENCE');
  if (noParticipants) warnings.push('NO_PARTICIPANTS');

  const { text: safePreview, redacted: previewRedacted } = redact(transcript.slice(0, 300));

  return {
    transcriptPreview: safePreview,
    parsed,
    matchedClientId,
    clientCandidates: candidates,
    ndisNumberRedacted: previewRedacted || Boolean((parsed as any).redactedFlag),
    warnings,
  };
}
