import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateInvoiceBeforeDispatch, ShieldInput } from '../src/invoices/invoice.shield';

function baseInput(overrides: Partial<ShieldInput> = {}): ShieldInput {
  return {
    businessAbn: '51824753556',
    businessBsb: '062-000',
    businessAccountNumber: '12345678',
    businessAccountName: 'Jane Smith',
    businessName: 'Jane Smith Support Services',
    businessEmail: 'jane@example.com',
    businessPhone: '0400000000',
    businessAddress: '1 Example St, Sydney NSW 2000',
    businessState: 'NSW',
    participantNdisNumber: '430123456',
    participantName: 'Sarah Jenkins',
    planManagementType: 'PLAN_MANAGED',
    planManagerAgencyName: 'My Plan Manager',
    planManagerEmail: 'invoices@myplanmanager.com.au',
    selfManagedBillingEmail: null,
    recipientEmail: 'invoices@myplanmanager.com.au',
    items: [{ code: '01_011_0107_1_1', unitPrice: 67.56, quantity: 2, serviceDate: '2020-01-01' }],
    rateLimitsMap: { '01_011_0107_1_1': 67.56 },
    ...overrides,
  };
}

describe('invoice.shield — pass path', () => {
  it('is valid for a fully compliant PLAN_MANAGED input', () => {
    const result = validateInvoiceBeforeDispatch(baseInput());
    assert.equal(result.isValid, true);
    assert.deepEqual(result.errors, []);
  });
});

describe('invoice.shield — check 1: ABN', () => {
  it('fails with the exact message when ABN is missing', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ businessAbn: null }));
    assert.equal(result.isValid, false);
    assert.ok(result.errors.includes('ATO Requirement: Business ABN is missing or invalid (must be 11 numeric digits).'));
  });

  it('fails when ABN is not 11 digits', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ businessAbn: '123' }));
    assert.equal(result.isValid, false);
  });
});

describe('invoice.shield — check 2: BSB', () => {
  it('fails with the exact message for an invalid BSB', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ businessBsb: 'ABCDEF' }));
    assert.ok(result.errors.includes('Banking Error: Valid Australian BSB (XXX-XXX) required for EFT payment.'));
  });

  it('accepts BSB without a hyphen', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ businessBsb: '062000' }));
    assert.equal(result.checks.find((c) => c.code === 'BSB_INVALID')?.passed, true);
  });
});

describe('invoice.shield — check 3/4: bank account', () => {
  it('fails with the exact message for an invalid account number', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ businessAccountNumber: '123' }));
    assert.ok(result.errors.includes('Banking Error: Valid Bank Account number required.'));
  });

  it('fails with the exact message when account name is missing', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ businessAccountName: '' }));
    assert.ok(result.errors.includes('Banking Error: Bank account name is required.'));
  });
});

describe('invoice.shield — check 5: business identity', () => {
  it('fails with the exact message when name or email missing', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ businessEmail: null }));
    assert.ok(result.errors.includes('Business identity is incomplete (legal name and contact email are required).'));
  });
});

describe('invoice.shield — check 6: NDIS number', () => {
  it('fails with the exact message for a non-9-digit number', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ participantNdisNumber: '123' }));
    assert.ok(result.errors.includes('NDIA Compliance Error: Participant NDIS Number must be exactly 9 digits.'));
  });

  it('strips spaces before validating', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ participantNdisNumber: '430 123 456' }));
    assert.equal(result.checks.find((c) => c.code === 'NDIS_NUMBER_INVALID')?.passed, true);
  });
});

describe('invoice.shield — check 7: no line items', () => {
  it('fails with the exact message', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ items: [] }));
    assert.ok(result.errors.includes('Invoice Error: No claimable line items were selected.'));
  });
});

describe('invoice.shield — check 8: quantity', () => {
  it('fails with the exact interpolated message', () => {
    const result = validateInvoiceBeforeDispatch(
      baseInput({ items: [{ code: 'ABC', unitPrice: 10, quantity: 0, serviceDate: '2020-01-01' }], rateLimitsMap: { ABC: 10 } })
    );
    assert.ok(result.errors.includes('Invalid line item quantity (0) for item ABC.'));
  });
});

describe('invoice.shield — check 9: unknown item', () => {
  it('fails with the exact interpolated message', () => {
    const result = validateInvoiceBeforeDispatch(
      baseInput({ items: [{ code: 'UNKNOWN_CODE', unitPrice: 10, quantity: 1, serviceDate: '2020-01-01' }], rateLimitsMap: {} })
    );
    assert.ok(result.errors.includes('NDIA Compliance Error: Unknown support item UNKNOWN_CODE.'));
  });
});

describe('invoice.shield — check 10: price cap', () => {
  it('fails when unit price exceeds the cap', () => {
    const result = validateInvoiceBeforeDispatch(
      baseInput({
        items: [{ code: 'ABC', unitPrice: 100, quantity: 1, serviceDate: '2020-01-01' }],
        rateLimitsMap: { ABC: 67.56 },
      })
    );
    assert.ok(result.errors.includes('NDIA Price Cap Violation: Item ABC charged at $100, but the 2026 price limit is $67.56.'));
  });

  it('tolerates a 0.001 rounding difference', () => {
    const result = validateInvoiceBeforeDispatch(
      baseInput({
        items: [{ code: 'ABC', unitPrice: 67.5605, quantity: 1, serviceDate: '2020-01-01' }],
        rateLimitsMap: { ABC: 67.56 },
      })
    );
    assert.equal(result.checks.find((c) => c.code === 'PRICE_CAP_VIOLATION')?.passed, true);
  });
});

describe('invoice.shield — checks 11-13: dispatch requirements', () => {
  it('PLAN_MANAGED requires an agency name', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ planManagerAgencyName: null }));
    assert.ok(result.errors.includes('Dispatch Error: Plan Manager agency name is required.'));
  });

  it('PLAN_MANAGED requires a valid agency email', () => {
    const result = validateInvoiceBeforeDispatch(baseInput({ planManagerEmail: 'not-an-email' }));
    assert.ok(result.errors.includes('Dispatch Error: Plan Manager agency claims email address is missing or invalid.'));
  });

  it('SELF_MANAGED requires a valid nominee email', () => {
    const result = validateInvoiceBeforeDispatch(
      baseInput({ planManagementType: 'SELF_MANAGED', planManagerAgencyName: null, planManagerEmail: null, selfManagedBillingEmail: null })
    );
    assert.ok(result.errors.includes('Dispatch Error: Self-managed participants need a nominee billing email.'));
  });
});

describe('invoice.shield — check 14: NDIA_MANAGED warning', () => {
  it('never blocks and adds the exact warning', () => {
    const result = validateInvoiceBeforeDispatch(
      baseInput({ planManagementType: 'NDIA_MANAGED', planManagerAgencyName: null, planManagerEmail: null, recipientEmail: null })
    );
    assert.equal(result.isValid, true);
    assert.ok(result.warnings.includes('NDIA-managed: claim through PRODA Myplace; no email will be sent.'));
  });
});

describe('invoice.shield — check 15: duplicate line warning', () => {
  it('warns but never blocks on duplicate lines', () => {
    const dup = { code: 'ABC', unitPrice: 10, quantity: 1, serviceDate: '2020-01-01' };
    const result = validateInvoiceBeforeDispatch(baseInput({ items: [dup, { ...dup }], rateLimitsMap: { ABC: 10 } }));
    assert.equal(result.isValid, true);
    assert.ok(result.warnings.includes('Duplicate line detected for ABC on 2020-01-01.'));
  });
});

describe('invoice.shield — check 16: future service date', () => {
  it('fails with the exact message for a future date', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
    const result = validateInvoiceBeforeDispatch(
      baseInput({ items: [{ code: '01_011_0107_1_1', unitPrice: 67.56, quantity: 1, serviceDate: futureDate }] })
    );
    assert.ok(result.errors.includes('Invoice Error: A selected shift has a future service date.'));
  });
});

describe('invoice.shield — isValid semantics', () => {
  it('warnings never affect isValid', () => {
    const result = validateInvoiceBeforeDispatch(
      baseInput({ planManagementType: 'NDIA_MANAGED', planManagerAgencyName: null, planManagerEmail: null, recipientEmail: null })
    );
    assert.equal(result.isValid, result.errors.length === 0);
  });
});
