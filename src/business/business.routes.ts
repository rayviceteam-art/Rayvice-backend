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
  updateBusinessSchema,
  userIdParamSchema,
} from './business.validators';

const router = Router();

// --- Public: invite acceptance (the invitee is not authenticated yet) ---
router.post('/team/accept-invite', authRateLimiter, validateRequest(acceptInviteSchema), businessController.acceptInvite);

// --- Protected: everyone in the business can view its own profile ---
router.get('/me', authenticate, businessController.getMyBusiness);

// --- Protected: Owner-only (BACKEND-03 §3 — Settings & Team Management) ---
router.patch('/me', authenticate, authorize('OWNER'), validateRequest(updateBusinessSchema), businessController.updateMyBusiness);

router.post(
  '/team/invite',
  authenticate,
  authorize('OWNER'),
  validateRequest(inviteTeamMemberSchema),
  businessController.inviteTeamMember,
);
router.get('/team', authenticate, authorize('OWNER'), validateRequest(listTeamQuerySchema), businessController.listTeamMembers);
router.patch(
  '/team/:userId/suspend',
  authenticate,
  authorize('OWNER'),
  validateRequest(userIdParamSchema),
  businessController.suspendTeamMember,
);
router.patch(
  '/team/:userId/reactivate',
  authenticate,
  authorize('OWNER'),
  validateRequest(userIdParamSchema),
  businessController.reactivateTeamMember,
);

export default router;
