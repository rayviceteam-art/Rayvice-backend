import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
/**
 * MODULE 4 — voice parser tests (Section 15.1)
 * No real network calls to Groq/Gemini/DB. Focuses on the pieces that are
 * pure/testable in isolation: Zod validation of the AI JSON, 9-digit
 * NDIS-number redaction, and client matching (exact/prefix/none).
 */
import { voiceParseAiSchema } from '../src/shifts/shift.validators';

describe('voiceParseAiSchema', () => {
  test('accepts a fully-populated valid payload', () => {
    const result = voiceParseAiSchema.safeParse({
      clientFirstName: 'Sarah',
      shiftDate: '2026-08-31',
      startTime: '18:00',
      endTime: '21:30',
      travelKms: 12,
      caseNotes: 'Community access and evening meal preparation.',
      confidence: 0.86,
      missingFields: [],
    });
    assert.strictEqual(result.success, true);
  });

  test('accepts nulls for undetermined fields', () => {
    const result = voiceParseAiSchema.safeParse({
      clientFirstName: null,
      shiftDate: null,
      startTime: null,
      endTime: null,
      travelKms: null,
      caseNotes: null,
      confidence: 0.2,
      missingFields: ['clientFirstName', 'shiftDate'],
    });
    assert.strictEqual(result.success, true);
  });

  test('rejects confidence outside 0-1', () => {
    const result = voiceParseAiSchema.safeParse({
      clientFirstName: 'Sarah',
      shiftDate: '2026-08-31',
      startTime: '18:00',
      endTime: '21:30',
      travelKms: null,
      caseNotes: null,
      confidence: 1.5,
      missingFields: [],
    });
    assert.strictEqual(result.success, false);
  });

  test('rejects malformed startTime', () => {
    const result = voiceParseAiSchema.safeParse({
      clientFirstName: 'Sarah',
      shiftDate: '2026-08-31',
      startTime: '6pm',
      endTime: '21:30',
      travelKms: null,
      caseNotes: null,
      confidence: 0.8,
      missingFields: [],
    });
    assert.strictEqual(result.success, false);
  });

  test('rejects caseNotes over 1000 chars', () => {
    const result = voiceParseAiSchema.safeParse({
      clientFirstName: 'Sarah',
      shiftDate: '2026-08-31',
      startTime: '18:00',
      endTime: '21:30',
      travelKms: null,
      caseNotes: 'x'.repeat(1001),
      confidence: 0.8,
      missingFields: [],
    });
    assert.strictEqual(result.success, false);
  });
});

// Redaction is a private helper inside voice-parser.ts; re-implemented here
// verbatim so it can be unit-tested without pulling in fetch/Groq/Gemini.
// If you export `redact` from voice-parser.ts, replace this copy with a
// direct import instead of duplicating the regex.
const NDIS_NUMBER_RE = /\b\d{9}\b/g;
function redact(text: string): { text: string; redacted: boolean } {
  const redacted = NDIS_NUMBER_RE.test(text);
  NDIS_NUMBER_RE.lastIndex = 0;
  return { text: text.replace(NDIS_NUMBER_RE, '[redacted]'), redacted };
}

describe('9-digit NDIS number redaction', () => {
  test('redacts a 9-digit sequence embedded in text', () => {
    const { text, redacted } = redact('Client NDIS number is 430123456, worked 3 hours.');
    assert.strictEqual(redacted, true);
    assert.ok(!text.includes('430123456'), 'expected NDIS number to be redacted');
    assert.ok(text.includes('[redacted]'), `expected to contain '[redacted]'`);
  });

  test('leaves ordinary text untouched', () => {
    const { text, redacted } = redact('Drove 12 kilometers and prepared dinner.');
    assert.strictEqual(redacted, false);
    assert.strictEqual(text, 'Drove 12 kilometers and prepared dinner.');
  });

  test('does not falsely match an 8 or 10 digit number', () => {
    assert.strictEqual(redact('Phone ext 12345678').redacted, false);
    assert.strictEqual(redact('Ref 1234567890').redacted, false);
  });
});

describe('client matching logic (mirrors Section 11.7)', () => {
  type Candidate = { id: string; participantName: string; ndisNumber: string };
  const clients: Candidate[] = [
    { id: '1', participantName: 'Sarah Jenkins', ndisNumber: '430123456' },
    { id: '2', participantName: 'Sam Wilson', ndisNumber: '430987654' },
    { id: '3', participantName: 'Samuel Green', ndisNumber: '430111222' },
  ];

  function matchClient(firstName: string | null, pool: Candidate[]) {
    if (!firstName) return { matchedClientId: null, candidates: pool.slice(0, 5) };
    const needle = firstName.trim().toLowerCase();
    const exact = pool.filter((c) => c.participantName.split(/\s+/)[0]?.toLowerCase() === needle);
    if (exact.length === 1) return { matchedClientId: exact[0].id, candidates: exact };
    const prefix = pool.filter((c) => c.participantName.toLowerCase().startsWith(needle));
    if (prefix.length > 0) return { matchedClientId: null, candidates: prefix.slice(0, 5) };
    return { matchedClientId: null, candidates: pool.slice(0, 5) };
  }

  test('unique exact first-name match sets matchedClientId', () => {
    const r = matchClient('Sarah', clients);
    assert.strictEqual(r.matchedClientId, '1');
  });

  test('ambiguous prefix match ("Sa") returns candidates, no matchedClientId', () => {
    const r = matchClient('Sa', clients);
    assert.strictEqual(r.matchedClientId, null);
    assert.deepStrictEqual(r.candidates.map((c) => c.id).sort(), ['1', '2', '3']);
  });

  test('no match returns null with a full candidate list', () => {
    const r = matchClient('Zoe', clients);
    assert.strictEqual(r.matchedClientId, null);
    assert.strictEqual(r.candidates.length, 3);
  });

  test('missing first name returns null match with candidate list for the UI', () => {
    const r = matchClient(null, clients);
    assert.strictEqual(r.matchedClientId, null);
    assert.strictEqual(r.candidates.length, 3);
  });
});
