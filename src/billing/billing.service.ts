import { DateTime } from 'luxon';
import Stripe from 'stripe';
import { prisma } from '../config/database';
import { env, isBillingConfigured } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { recordAuditEvent } from '../audit/audit.service';
import { getStripeClient, mapPriceIdToPlanTier } from './stripe.client';
import { TRIAL_LIMITS, getTrialDetails } from '../business/trial.util';
import { logger } from '../config/logger';

export interface BillingContext {
  businessId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

function requireStripe(): Stripe {
  const client = getStripeClient();
  if (!client) throw ApiError.serviceUnavailable('Billing is not configured on this server.', 'BILLING_UNAVAILABLE');
  return client;
}

const STARTER_LIMITS = { clients: 5, invoicesPerMonth: 20, voice: 0 };
const PRO_LIMITS = { clients: Infinity, invoicesPerMonth: Infinity, voice: Infinity };
const TRIAL_LIMITS_VIEW = {
  clients: TRIAL_LIMITS.MAX_CLIENTS,
  invoicesPerMonth: TRIAL_LIMITS.MAX_INVOICES,
  voice: TRIAL_LIMITS.MAX_VOICE_TRANSCRIPTIONS,
};

export async function getBillingStatus(ctx: BillingContext) {
  const business = await prisma.business.findUnique({ where: { id: ctx.businessId } });
  if (!business) throw ApiError.notFound('Business not found.');

  const tz = business.timezone || 'Australia/Sydney';
  const now = DateTime.now().setZone(tz);
  const monthStart = now.startOf('month').toJSDate();
  const monthEnd = now.endOf('month').toJSDate();

  const [activeClients, invoicesThisMonth] = await Promise.all([
    prisma.client.count({ where: { businessId: ctx.businessId, deletedAt: null, isActive: true } }),
    prisma.invoice.count({ where: { businessId: ctx.businessId, createdAt: { gte: monthStart, lte: monthEnd } } }),
  ]);

  const limits =
    business.planTier === 'STARTER' ? STARTER_LIMITS : business.planTier === 'PRO' ? PRO_LIMITS : TRIAL_LIMITS_VIEW;

  const trial = getTrialDetails(business);

  return {
    planTier: business.planTier,
    subscriptionStatus: business.subscriptionStatus,
    currentPeriodEnd: business.currentPeriodEnd ? business.currentPeriodEnd.toISOString() : null,
    cancelAtPeriodEnd: business.cancelAtPeriodEnd,
    stripeCustomerId: business.stripeCustomerId ?? undefined,
    limits,
    usage: {
      activeClients,
      invoicesThisMonth,
      trialDaysRemaining: trial.daysRemaining,
    },
  };
}

export async function createCheckoutSession(plan: 'STARTER' | 'PRO', ctx: BillingContext): Promise<{ url: string }> {
  const stripe = requireStripe();
  const business = await prisma.business.findUnique({ where: { id: ctx.businessId } });
  if (!business) throw ApiError.notFound('Business not found.');

  if (business.subscriptionStatus === 'active' || business.subscriptionStatus === 'trialing') {
    throw ApiError.conflict('This business already has an active subscription.', 'ALREADY_SUBSCRIBED');
  }

  const priceId = plan === 'STARTER' ? env.STRIPE_PRICE_BASIC_AUD : env.STRIPE_PRICE_PRO_AUD;
  if (!priceId) throw ApiError.serviceUnavailable('Billing is not configured on this server.', 'BILLING_UNAVAILABLE');

  let customerId = business.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: business.email,
      name: business.name,
      metadata: { businessId: business.id },
    });
    customerId = customer.id;
    await prisma.business.update({ where: { id: business.id }, data: { stripeCustomerId: customerId } });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.CLIENT_URL}/settings/billing?checkout=success`,
    cancel_url: `${env.CLIENT_URL}/settings/billing?checkout=cancelled`,
    metadata: { businessId: business.id },
  });

  await recordAuditEvent({
    action: 'SUBSCRIPTION_CHECKOUT_CREATED',
    businessId: ctx.businessId,
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { plan },
  });

  if (!session.url) throw ApiError.internal('Stripe did not return a checkout URL.');
  return { url: session.url };
}

export async function createPortalSession(ctx: BillingContext): Promise<{ url: string }> {
  const stripe = requireStripe();
  const business = await prisma.business.findUnique({ where: { id: ctx.businessId } });
  if (!business) throw ApiError.notFound('Business not found.');
  if (!business.stripeCustomerId) {
    throw ApiError.conflict('This business has no Stripe subscription yet.', 'NO_SUBSCRIPTION');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: business.stripeCustomerId,
    return_url: `${env.CLIENT_URL}/settings/billing`,
  });

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Webhook handling — spec 2.10.10
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
  const stripe = requireStripe();
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw ApiError.badRequest('Invalid Stripe webhook signature.', 'INVALID_SIGNATURE');
  }
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<{ duplicate: boolean }> {
  const existing = await prisma.stripeEvent.findUnique({ where: { eventId: event.id } });
  if (existing) {
    return { duplicate: true };
  }

  let businessId: string | null = null;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        businessId = (session.metadata?.businessId as string) ?? null;
        if (businessId && session.subscription) {
          const subscription = await requireStripe().subscriptions.retrieve(session.subscription as string);
          const priceId = subscription.items.data[0]?.price.id;
          const planTier = priceId ? mapPriceIdToPlanTier(priceId) : null;

          if (!planTier) {
            logger.warn('Unknown Stripe price id on checkout.session.completed; plan left unchanged.', { priceId });
          } else {
            await prisma.business.update({
              where: { id: businessId },
              data: {
                planTier,
                stripeCustomerId: subscription.customer as string,
                stripeSubscriptionId: subscription.id,
                subscriptionStatus: subscription.status,
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                planStartedAt: new Date(),
              },
            });
            await recordAuditEvent({
              action: 'SUBSCRIPTION_ACTIVATED',
              businessId,
              metadata: { planTier, subscriptionId: subscription.id, status: subscription.status, currentPeriodEnd: subscription.current_period_end },
            });
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const business = await prisma.business.findFirst({ where: { stripeSubscriptionId: subscription.id } });
        if (business) {
          businessId = business.id;
          const priceId = subscription.items.data[0]?.price.id;
          const mappedTier = priceId ? mapPriceIdToPlanTier(priceId) : null;

          await prisma.business.update({
            where: { id: business.id },
            data: {
              subscriptionStatus: subscription.status,
              currentPeriodEnd: new Date(subscription.current_period_end * 1000),
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              ...(mappedTier ? { planTier: mappedTier } : {}),
            },
          });
          await recordAuditEvent({
            action: 'SUBSCRIPTION_UPDATED',
            businessId: business.id,
            metadata: { planTier: mappedTier ?? business.planTier, subscriptionId: subscription.id, status: subscription.status, currentPeriodEnd: subscription.current_period_end },
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const business = await prisma.business.findFirst({ where: { stripeSubscriptionId: subscription.id } });
        if (business) {
          businessId = business.id;
          await prisma.business.update({
            where: { id: business.id },
            data: { subscriptionStatus: 'canceled', planTier: 'TRIAL' },
          });
          await recordAuditEvent({
            action: 'SUBSCRIPTION_CANCELLED',
            businessId: business.id,
            metadata: { planTier: 'TRIAL', subscriptionId: subscription.id, status: 'canceled' },
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const stripeInvoice = event.data.object as Stripe.Invoice;
        const subscriptionId = stripeInvoice.subscription as string | null;
        if (subscriptionId) {
          const business = await prisma.business.findFirst({ where: { stripeSubscriptionId: subscriptionId } });
          if (business) {
            businessId = business.id;
            await prisma.business.update({ where: { id: business.id }, data: { subscriptionStatus: 'past_due' } });
            await recordAuditEvent({
              action: 'SUBSCRIPTION_PAYMENT_FAILED',
              businessId: business.id,
              metadata: { planTier: business.planTier, subscriptionId, status: 'past_due' },
            });
          }
        }
        break;
      }

      default:
        // Unknown/unhandled event types are acknowledged and ignored.
        break;
    }
  } finally {
    await prisma.stripeEvent.create({
      data: {
        eventId: event.id,
        type: event.type,
        businessId,
        payload: event as unknown as object,
      },
    });
  }

  return { duplicate: false };
}
