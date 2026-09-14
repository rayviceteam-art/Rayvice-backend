import { Router } from 'express';
import * as controller from './shift.controller';
import { voiceUploadMiddleware, voiceParse } from './voice.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { voiceDailyRateLimiter, voiceMinuteRateLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../middleware/validateRequest';
import {
  createShiftRequestSchema,
  updateShiftRequestSchema,
  listShiftsRequestSchema,
  shiftIdParamSchema,
} from './shift.validators';

const router = Router();

// Module 4 — Shift Logging & Auto-Split Engine (all routes require auth)
router.use(authenticate);

// Uninvoiced shifts grouped by participant (Module 5 batch invoicing)
router.get('/uninvoiced', authorize('OWNER', 'OFFICE_MANAGER', 'TECHNICIAN'), controller.uninvoiced);

// Voice: audio -> transcript -> structured preview (never saves)
router.post(
  '/voice-parse',
  authorize('OWNER', 'OFFICE_MANAGER', 'TECHNICIAN'),
  voiceMinuteRateLimiter,
  voiceDailyRateLimiter,
  voiceUploadMiddleware,
  voiceParse
);

// Create shift (runs the deterministic split engine)
router.post(
  '/',
  authorize('OWNER', 'OFFICE_MANAGER', 'TECHNICIAN'),
  validateRequest(createShiftRequestSchema),
  controller.create
);

// List / filter shifts
router.get(
  '/',
  authorize('OWNER', 'OFFICE_MANAGER', 'TECHNICIAN'),
  validateRequest(listShiftsRequestSchema),
  controller.list
);

// Detail
router.get(
  '/:id',
  authorize('OWNER', 'OFFICE_MANAGER', 'TECHNICIAN'),
  validateRequest(shiftIdParamSchema),
  controller.detail
);

// Edit a PENDING shift (re-runs the split; forbidden once invoiced)
router.patch(
  '/:id',
  authorize('OWNER', 'OFFICE_MANAGER', 'TECHNICIAN'),
  validateRequest(updateShiftRequestSchema),
  controller.update
);

// Soft-cancel a shift (row preserved; forbidden once invoiced)
router.delete(
  '/:id',
  authorize('OWNER', 'OFFICE_MANAGER', 'TECHNICIAN'),
  validateRequest(shiftIdParamSchema),
  controller.remove
);

export default router;
