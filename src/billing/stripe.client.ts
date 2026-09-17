import Stripe from 'stripe';
import { env, isBillingConfigured } from '../config/env';

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  if (!isBillingConfigured()) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  }
  return stripeClient;
}

/** Price id -> plan tier mapping, sourced only from env (D14). */
export function mapPriceIdToPlanTier(priceId: string): 'STARTER' | 'PRO' | null {
  const starter = process.env.STRIPE_PRICE_BASIC_AUD || env.STRIPE_PRICE_BASIC_AUD;
  const pro = process.env.STRIPE_PRICE_PRO_AUD || env.STRIPE_PRICE_PRO_AUD;
  if (starter && priceId === starter) return 'STARTER';
  if (pro && priceId === pro) return 'PRO';
  return null;
}
