import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// mapPriceIdToPlanTier reads from env at call time, so we set the env vars
// before importing the module under test.
process.env.STRIPE_PRICE_BASIC_AUD = 'price_starter_test';
process.env.STRIPE_PRICE_PRO_AUD = 'price_pro_test';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/db';
process.env.APP_URL = process.env.APP_URL || 'http://localhost:4000';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

import { mapPriceIdToPlanTier } from '../src/billing/stripe.client';

describe('billing — price id to plan tier mapping', () => {
  it('maps the Starter price id to STARTER', () => {
    assert.equal(mapPriceIdToPlanTier('price_starter_test'), 'STARTER');
  });

  it('maps the Pro price id to PRO', () => {
    assert.equal(mapPriceIdToPlanTier('price_pro_test'), 'PRO');
  });

  it('leaves the plan unmapped (null) for an unknown price id', () => {
    assert.equal(mapPriceIdToPlanTier('price_totally_unknown'), null);
  });
});
