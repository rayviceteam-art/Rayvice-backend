import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/ApiResponse';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { getDashboardSummary } from './dashboard.service';

const router = Router();

router.get(
  '/summary',
  authenticate,
  authorize('OWNER', 'OFFICE_MANAGER', 'TECHNICIAN'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getDashboardSummary({
      businessId: req.user!.businessId,
      userId: req.user!.id,
      role: req.user!.role as 'OWNER' | 'OFFICE_MANAGER' | 'TECHNICIAN' | 'SUPER_ADMIN',
    });
    sendSuccess(res, 200, 'Dashboard summary retrieved successfully.', data);
  })
);

// TEMP DIAG — REMOVE AFTER FIXING
router.get(
  '/_debug',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const data = await getDashboardSummary({
        businessId: req.user!.businessId,
        userId: req.user!.id,
        role: req.user!.role as any,
      });
      res.json({ ok: true, data });
    } catch (err: any) {
      res.status(200).json({
        ok: false,
        name: err?.constructor?.name,
        message: err?.message,
        code: err?.code,
        stack: err?.stack?.split('\n').slice(0, 10),
      });
    }
  })
);

export default router;
