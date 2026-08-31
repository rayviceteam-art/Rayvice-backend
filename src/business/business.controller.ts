import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/ApiResponse';
import * as businessService from './business.service';
import { ListTeamQuery } from './business.validators';

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

export const getMyBusiness = asyncHandler(async (req: Request, res: Response) => {
  const business = await businessService.getBusinessProfile(req.user!.businessId);
  sendSuccess(res, 200, 'Business profile retrieved successfully.', business);
});

export const updateMyBusiness = asyncHandler(async (req: Request, res: Response) => {
  const business = await businessService.updateBusinessProfile(
    req.user!.businessId,
    req.body,
    req.user!.id,
    requestMeta(req)
  );
  sendSuccess(res, 200, 'Business profile updated successfully.', business);
});

export const getBankDetails = asyncHandler(async (req: Request, res: Response) => {
  const bankDetails = await businessService.getBankDetails(req.user!.businessId);
  sendSuccess(res, 200, 'Bank details retrieved successfully.', bankDetails);
});

export const updateBankDetails = asyncHandler(async (req: Request, res: Response) => {
  const bankDetails = await businessService.updateBankDetails(
    req.user!.businessId,
    req.body,
    req.user!.id,
    requestMeta(req)
  );
  sendSuccess(res, 200, 'Bank details updated successfully.', bankDetails);
});

export const getComplianceStatus = asyncHandler(async (req: Request, res: Response) => {
  const compliance = await businessService.getComplianceStatus(req.user!.businessId);
  sendSuccess(res, 200, 'Compliance readiness report retrieved.', compliance);
});

export const validateAbn = asyncHandler(async (req: Request, res: Response) => {
  const result = businessService.validateAbnHelper(req.body.abn);
  sendSuccess(res, 200, result.isValid ? 'Valid Australian Business Number (ABN).' : 'Invalid ABN.', result);
});

export const inviteTeamMember = asyncHandler(async (req: Request, res: Response) => {
  const invitedUser = await businessService.inviteTeamMember(req.user!.businessId, req.body, requestMeta(req));
  sendSuccess(res, 201, 'Invitation sent successfully.', invitedUser);
});

export const acceptInvite = asyncHandler(async (req: Request, res: Response) => {
  await businessService.acceptInvite(req.body, requestMeta(req));
  sendSuccess(res, 200, 'Invitation accepted. You can now log in.', {});
});

export const listTeamMembers = asyncHandler(async (req: Request, res: Response) => {
  const result = await businessService.listTeamMembers(req.user!.businessId, req.query as unknown as ListTeamQuery);
  sendSuccess(res, 200, 'Team members retrieved.', { records: result.records, pagination: result.pagination });
});

export const suspendTeamMember = asyncHandler(async (req: Request, res: Response) => {
  await businessService.suspendTeamMember(
    req.user!.businessId,
    req.params.userId as string,
    req.user!.id,
    requestMeta(req)
  );
  sendSuccess(res, 200, 'Team member suspended.', {});
});

export const reactivateTeamMember = asyncHandler(async (req: Request, res: Response) => {
  await businessService.reactivateTeamMember(
    req.user!.businessId,
    req.params.userId as string,
    req.user!.id,
    requestMeta(req)
  );
  sendSuccess(res, 200, 'Team member reactivated.', {});
});
