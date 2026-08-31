import { Router } from 'express';
import * as adminController from './admin.controller';
import { authenticate } from '../middleware/authenticate';
import { requireSuperAdmin } from '../middleware/authorize';
import { validateRequest } from '../middleware/validateRequest';
import {
  listBusinessesQuerySchema,
  listUsersQuerySchema,
  updateBusinessStatusSchema,
  extendTrialSchema,
  businessIdParamSchema,
} from './admin.validators';

const router = Router();

// All admin routes require valid authentication & Super-Admin authorization
router.use(authenticate);
router.use(requireSuperAdmin);

// Platform Overview Metrics
router.get('/metrics', adminController.getMetrics);

// Businesses / Tenants
router.get('/businesses', validateRequest(listBusinessesQuerySchema), adminController.listBusinesses);
router.get('/businesses/:id', validateRequest(businessIdParamSchema), adminController.getBusiness);
router.patch(
  '/businesses/:id/status',
  validateRequest(updateBusinessStatusSchema),
  adminController.updateBusinessStatus
);
router.patch(
  '/businesses/:id/trial',
  validateRequest(extendTrialSchema),
  adminController.extendTrial
);

// Platform Users
router.get('/users', validateRequest(listUsersQuerySchema), adminController.listUsers);

// Platform Audit Log Stream
router.get('/audit-logs', adminController.listAuditLogs);

export default router;
