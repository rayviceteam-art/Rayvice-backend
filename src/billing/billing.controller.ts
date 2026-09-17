import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import * as billingService from './billing.service';

function ctxFrom(req: any) {
  return {
    businessId: req.user!.businessId,
    userId: req.user!.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

export const getBillingStatus = asyncHandler(async (req, res) => {
  const status = await billingService.getBillingStatus(ctxFrom(req));
  sendSuccess(res, 200, 'Billing status retrieved.', status);
});

export const createCheckoutSession = asyncHandler(async (req, res) => {
  const { plan } = req.body as { plan: 'STARTER' | 'PRO' };
  const result = await billingService.createCheckoutSession(plan, ctxFrom(req));
  sendSuccess(res, 200, 'Checkout session created.', result);
});

export const createPortalSession = asyncHandler(async (req, res) => {
  const result = await billingService.createPortalSession(ctxFrom(req));
  sendSuccess(res, 200, 'Billing portal session created.', result);
});

export const handleStripeWebhook = asyncHandler(async (req, res) => {
  const signature = req.get('stripe-signature');
  if (!signature) throw ApiError.badRequest('Missing Stripe signature header.', 'INVALID_SIGNATURE');

  const event = billingService.verifyWebhookSignature(req.body as Buffer, signature);
  const result = await billingService.handleWebhookEvent(event);

  res.status(200).json({ received: true, duplicate: result.duplicate });
});
