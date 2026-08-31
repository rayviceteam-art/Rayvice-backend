import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/ApiResponse';
import * as adminService from './admin.service';
import { RequestMeta } from '../auth/auth.service';

function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

export const getMetrics = asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await adminService.getPlatformOverviewMetrics();
  sendSuccess(res, 200, 'Platform metrics retrieved successfully.', metrics);
});

export const listBusinesses = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.listAllBusinesses(req.query as any);
  sendSuccess(res, 200, 'Businesses retrieved successfully.', result);
});

export const getBusiness = asyncHandler(async (req: Request, res: Response) => {
  const business = await adminService.getBusinessDetails(req.params.id);
  sendSuccess(res, 200, 'Business details retrieved successfully.', business);
});

export const updateBusinessStatus = asyncHandler(async (req: Request, res: Response) => {
  const meta = requestMeta(req);
  const updated = await adminService.updateBusinessStatus(
    req.params.id,
    req.body,
    req.user!.userId,
    meta
  );
  sendSuccess(res, 200, 'Business status updated successfully.', updated);
});

export const extendTrial = asyncHandler(async (req: Request, res: Response) => {
  const meta = requestMeta(req);
  const updated = await adminService.extendBusinessTrial(
    req.params.id,
    req.body,
    req.user!.userId,
    meta
  );
  sendSuccess(res, 200, 'Business trial extended successfully.', updated);
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.listAllUsers(req.query as any);
  sendSuccess(res, 200, 'Users retrieved successfully.', result);
});

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 30);
  const result = await adminService.getPlatformAuditLogs(page, pageSize);
  sendSuccess(res, 200, 'Audit logs retrieved successfully.', result);
});
