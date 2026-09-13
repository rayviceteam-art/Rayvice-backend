import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ApiError } from '../utils/ApiError';
import { assertCanMutate, checkTrialResourceLimit } from '../business/trial.util';
import { recordAuditEvent } from '../audit/audit.service';
import { prisma } from '../config/database';
import { runVoicePipeline } from './voice-parser';

const MAX_FILE_BYTES = Number(process.env.VOICE_MAX_FILE_MB ?? 5) * 1024 * 1024;

const ACCEPTED_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a',
  'audio/aac',
]);

const upload = multer({
  storage: multer.memoryStorage(), // Section 0.1.8 — audio is never written to disk
  limits: { fileSize: MAX_FILE_BYTES },
});

/** Wraps multer so its size-limit error becomes the documented 413 error code. */
export function voiceUploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(ApiError.tooLarge('Recording is too large (max 5 MB).', 'VOICE_FILE_TOO_LARGE'));
        return;
      }
      next(ApiError.badRequest(`Audio upload failed: ${err.code}`, 'VOICE_UPLOAD_FAILED'));
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

function confidenceBucket(c: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (c < 0.5) return 'LOW';
  if (c < 0.8) return 'MEDIUM';
  return 'HIGH';
}

export async function voiceParse(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const businessId = req.user!.businessId;
    const userId = req.user!.id;

    await assertCanMutate(businessId);

    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    if (business.planTier === 'STARTER') {
      throw ApiError.forbidden('Voice AI requires the Pro plan.', 'VOICE_PLAN_REQUIRED');
    }
    if (business.planTier === 'TRIAL') {
      await checkTrialResourceLimit(businessId, 'voice');
    }

    const file = req.file;
    if (!file) throw ApiError.badRequest('Missing audio file.', 'VOICE_FILE_MISSING');
    if (!ACCEPTED_MIME.has(file.mimetype)) {
      throw ApiError.unsupportedMediaType(`Unsupported audio format: ${file.mimetype}`, 'INVALID_AUDIO_FORMAT');
    }

    const timezone = (req.body?.timezone as string) || business.timezone;
    const result = await runVoicePipeline(businessId, { buffer: file.buffer, mimeType: file.mimetype }, timezone);

    await recordAuditEvent({
      businessId,
      userId,
      action: 'SHIFT_VOICE_PARSED',
      ipAddress: req.ip || undefined,
      userAgent: req.headers['user-agent'] || undefined,
      metadata: {
        matched: Boolean(result.matchedClientId),
        clientCandidatesCount: result.clientCandidates.length,
        confidenceBucket: confidenceBucket(result.parsed.confidence),
        missingFieldsCount: result.parsed.missingFields.length,
        ndisNumberRedacted: result.ndisNumberRedacted,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Voice shift parsed successfully. Review before saving.',
      data: {
        transcriptPreview: result.transcriptPreview,
        parsed: result.parsed,
        matchedClientId: result.matchedClientId,
        clientCandidates: result.clientCandidates,
        ndisNumberRedacted: result.ndisNumberRedacted,
        warnings: result.warnings,
        usage: {
          planTier: business.planTier,
          voiceParsesLimit: business.planTier === 'TRIAL' ? 3 : null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}
