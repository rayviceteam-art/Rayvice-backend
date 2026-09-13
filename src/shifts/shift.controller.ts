import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/ApiResponse';
import * as shiftService from './shift.service';
import { ActorContext } from './shift.service';

function ctxFrom(req: Request): ActorContext {
  return {
    businessId: req.user!.businessId,
    userId: req.user!.id,
    role: req.user!.role as ActorContext['role'],
  };
}

export const create = asyncHandler(async (req: Request, res: Response) => {
  const idempotencyKey = req.header('Idempotency-Key') || undefined;
  const result = await shiftService.createShift(ctxFrom(req), req.body, idempotencyKey);
  sendSuccess(
    res,
    result.idempotentReplay ? 200 : 201,
    result.idempotentReplay ? 'Shift already logged (idempotent replay).' : 'Shift logged successfully.',
    { shift: result.shift, budget: result.budget, warnings: result.warnings }
  );
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const data = await shiftService.listShifts(ctxFrom(req), req.query as never);
  sendSuccess(res, 200, 'Shifts retrieved successfully.', data);
});

export const detail = asyncHandler(async (req: Request, res: Response) => {
  const data = await shiftService.getShiftById(ctxFrom(req), req.params.id as string);
  sendSuccess(res, 200, 'Shift retrieved successfully.', data);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const result = await shiftService.updateShift(ctxFrom(req), req.params.id as string, req.body);
  sendSuccess(res, 200, 'Shift updated successfully.', {
    shift: result.shift,
    budget: result.budget,
    warnings: result.warnings,
  });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await shiftService.cancelShift(ctxFrom(req), req.params.id as string);
  sendSuccess(res, 200, 'Shift cancelled successfully.', {});
});

export const uninvoiced = asyncHandler(async (req: Request, res: Response) => {
  const data = await shiftService.getUninvoicedGrouped(ctxFrom(req));
  sendSuccess(res, 200, 'Uninvoiced shifts retrieved successfully.', data);
});
