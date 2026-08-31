import { Router } from 'express';
import * as businessController from './business.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateRequest } from '../middleware/validateRequest';
import { authRateLimiter } from '../middleware/rateLimiter';
import {
  acceptInviteSchema,
  inviteTeamMemberSchema,
  listTeamQuerySchema,
  updateBusinessProfileSchema,
  updateBankDetailsSchema,
  validateAbnRequestSchema,
  userIdParamSchema,
} from './business.validators';

const router = Router();

// =============================================================================
// Public Endpoints
// =============================================================================

// Invite acceptance (the invitee is not authenticated yet)
router.post(
  '/team/accept-invite',
  authRateLimiter,
  validateRequest(acceptInviteSchema),
  businessController.acceptInvite
);

// Standalone ABN Validator (can be called from registration/onboarding wizard)
router.post(
  '/validate-abn',
  authRateLimiter,
  validateRequest(validateAbnRequestSchema),
  businessController.validateAbn
);

// =============================================================================
// Protected Endpoints — Module 2: Business Profile, Bank Details & Compliance
// =============================================================================

// Get full business profile & Australian compliance parameters
router.get('/profile', authenticate, businessController.getMyBusiness);
router.get('/me', authenticate, businessController.getMyBusiness);

// Update business profile, ABN, invoice prefix, address, GST toggle (OWNER only)
router.put(
  '/profile',
  authenticate,
  authorize('OWNER'),
  validateRequest(updateBusinessProfileSchema),
  businessController.updateMyBusiness
);
router.patch(
  '/profile',
  authenticate,
  authorize('OWNER'),
  validateRequest(updateBusinessProfileSchema),
  businessController.updateMyBusiness
);
router.patch(
  '/me',
  authenticate,
  authorize('OWNER'),
  validateRequest(updateBusinessProfileSchema),
  businessController.updateMyBusiness
);

// Banking & EFT Details
router.get('/bank-details', authenticate, businessController.getBankDetails);
router.put(
  '/bank-details',
  authenticate,
  authorize('OWNER'),
  validateRequest(updateBankDetailsSchema),
  businessController.updateBankDetails
);
router.patch(
  '/bank-details',
  authenticate,
  authorize('OWNER'),
  validateRequest(updateBankDetailsSchema),
  businessController.updateBankDetails
);

// Pre-flight NDIS Tax Invoice Compliance Readiness Report
router.get('/compliance-status', authenticate, businessController.getComplianceStatus);

// =============================================================================
// Protected Endpoints — Team Management (Owner-only)
// =============================================================================

router.post(
  '/team/invite',
  authenticate,
  authorize('OWNER'),
  validateRequest(inviteTeamMemberSchema),
  businessController.inviteTeamMember
);
router.get(
  '/team',
  authenticate,
  authorize('OWNER'),
  validateRequest(listTeamQuerySchema),
  businessController.listTeamMembers
);
router.patch(
  '/team/:userId/suspend',
  authenticate,
  authorize('OWNER'),
  validateRequest(userIdParamSchema),
  businessController.suspendTeamMember
);
router.patch(
  '/team/:userId/reactivate',
  authenticate,
  authorize('OWNER'),
  validateRequest(userIdParamSchema),
  businessController.reactivateTeamMember
);

export default router;
