import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateRequest } from '../middleware/validateRequest';
import * as controller from './billing.controller';

const checkoutBodySchema = z.object({
  body: z.object({ plan: z.enum(['STARTER', 'PRO']) }),
});

const router = Router();

// IMPORTANT: the webhook route needs the RAW body for signature verification.
// Register it BEFORE any express.json() body parser touches this path, and
// do not apply `authenticate` to it — it is public (spec 2.10.10).
router.post('/webhook', express.raw({ type: 'application/json' }), controller.handleStripeWebhook);

router.use(authenticate);
router.get('/status', authorize('OWNER'), controller.getBillingStatus);
router.post('/checkout', authorize('OWNER'), validateRequest(checkoutBodySchema), controller.createCheckoutSession);
router.post('/change-plan', authorize('OWNER'), validateRequest(checkoutBodySchema), controller.changePlan);
router.post('/portal', authorize('OWNER'), controller.createPortalSession);

export default router;
