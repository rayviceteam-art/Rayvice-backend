/**
 * MODULE 5 — Pre-Flight Auto-Rejection Shield
 * Spec §2.4. Pure function: the caller loads business/client/catalogue data
 * and passes it in. No DB access, no network, no AI — 100% unit-testable.
 *
 * Never write an invoice row without running this first (spec 2.0 rule 2).
 */

export interface ShieldLineItem {
  code: string; // NDIS support item number
  unitPrice: number; // applied rate
  quantity: number; // hours or km
  serviceDate: string; // YYYY-MM-DD
}

export interface ShieldInput {
  businessAbn: string | null;
  businessBsb: string | null;
  businessAccountNumber: string | null;
  businessAccountName: string | null;
  businessName: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  businessAddress: string | null;
  businessState: string | null;
  participantNdisNumber: string;
  participantName: string;
  planManagementType: 'PLAN_MANAGED' | 'SELF_MANAGED' | 'NDIA_MANAGED';
  planManagerAgencyName: string | null;
  planManagerEmail: string | null;
  selfManagedBillingEmail: string | null;
  recipientEmail: string | null;
  items: ShieldLineItem[];
  rateLimitsMap: Record<string, number>; // itemNumber -> NDIS cap
}

export interface ShieldCheck {
  code: string;
  passed: boolean;
  detail?: string;
}

export interface ShieldResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  checks: ShieldCheck[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ABN_RE = /^\d{11}$/;
const BSB_RE = /^\d{3}-?\d{3}$/;
const ACCOUNT_RE = /^\d{6,9}$/;
const NDIS_NUMBER_RE = /^\d{9}$/;

function isValidEmail(value: string | null | undefined): boolean {
  return Boolean(value && EMAIL_RE.test(value.trim()));
}

export function validateInvoiceBeforeDispatch(input: ShieldInput): ShieldResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: ShieldCheck[] = [];

  const record = (code: string, passed: boolean, detail?: string) => {
    checks.push({ code, passed, detail });
  };

  // 1 — ABN
  {
    const passed = Boolean(input.businessAbn && ABN_RE.test(input.businessAbn));
    if (!passed) {
      errors.push('ATO Requirement: Business ABN is missing or invalid (must be 11 numeric digits).');
    }
    record('ABN_MISSING', passed);
  }

  // 2 — BSB
  {
    const passed = Boolean(input.businessBsb && BSB_RE.test(input.businessBsb));
    if (!passed) {
      errors.push('Banking Error: Valid Australian BSB (XXX-XXX) required for EFT payment.');
    }
    record('BSB_INVALID', passed);
  }

  // 3 — Account number
  {
    const passed = Boolean(input.businessAccountNumber && ACCOUNT_RE.test(input.businessAccountNumber));
    if (!passed) {
      errors.push('Banking Error: Valid Bank Account number required.');
    }
    record('ACCOUNT_INVALID', passed);
  }

  // 4 — Account name
  {
    const passed = Boolean(input.businessAccountName && input.businessAccountName.trim().length > 0);
    if (!passed) {
      errors.push('Banking Error: Bank account name is required.');
    }
    record('ACCOUNT_NAME_MISSING', passed);
  }

  // 5 — Business identity
  {
    const passed = Boolean(
      input.businessName && input.businessName.trim().length > 0 && input.businessEmail && input.businessEmail.trim().length > 0
    );
    if (!passed) {
      errors.push('Business identity is incomplete (legal name and contact email are required).');
    }
    record('BUSINESS_IDENTITY_INCOMPLETE', passed);
  }

  // 6 — NDIS number
  {
    const stripped = (input.participantNdisNumber || '').replace(/\s+/g, '');
    const passed = NDIS_NUMBER_RE.test(stripped);
    if (!passed) {
      errors.push('NDIA Compliance Error: Participant NDIS Number must be exactly 9 digits.');
    }
    record('NDIS_NUMBER_INVALID', passed);
  }

  // 7 — At least one line item
  {
    const passed = input.items.length > 0;
    if (!passed) {
      errors.push('Invoice Error: No claimable line items were selected.');
    }
    record('NO_LINE_ITEMS', passed);
  }

  // 8 — Every item quantity > 0
  {
    let allPassed = true;
    for (const item of input.items) {
      if (!(item.quantity > 0)) {
        allPassed = false;
        errors.push(`Invalid line item quantity (${item.quantity}) for item ${item.code}.`);
      }
    }
    record('QUANTITY_INVALID', allPassed);
  }

  // 9 — Every item's code exists in the rate map
  {
    let allPassed = true;
    for (const item of input.items) {
      if (!(item.code in input.rateLimitsMap)) {
        allPassed = false;
        errors.push(`NDIA Compliance Error: Unknown support item ${item.code}.`);
      }
    }
    record('UNKNOWN_ITEM', allPassed);
  }

  // 10 — Price cap (tolerance 0.001), only for known items
  {
    let allPassed = true;
    for (const item of input.items) {
      const cap = input.rateLimitsMap[item.code];
      if (cap === undefined) continue; // already reported by check 9
      if (item.unitPrice > cap + 0.001) {
        allPassed = false;
        errors.push(
          `NDIA Price Cap Violation: Item ${item.code} charged at $${item.unitPrice}, but the 2026 price limit is $${cap}.`
        );
      }
    }
    record('PRICE_CAP_VIOLATION', allPassed);
  }

  // 11 / 12 / 13 / 14 — plan management type specific dispatch checks
  if (input.planManagementType === 'PLAN_MANAGED') {
    const agencyOk = Boolean(input.planManagerAgencyName && input.planManagerAgencyName.trim().length > 0);
    if (!agencyOk) {
      errors.push('Dispatch Error: Plan Manager agency name is required.');
    }
    record('AGENCY_MISSING', agencyOk);

    const agencyEmailOk = isValidEmail(input.planManagerEmail);
    if (!agencyEmailOk) {
      errors.push('Dispatch Error: Plan Manager agency claims email address is missing or invalid.');
    }
    record('AGENCY_EMAIL_INVALID', agencyEmailOk);
  } else if (input.planManagementType === 'SELF_MANAGED') {
    const nomineeOk = isValidEmail(input.selfManagedBillingEmail);
    if (!nomineeOk) {
      errors.push('Dispatch Error: Self-managed participants need a nominee billing email.');
    }
    record('NOMINEE_EMAIL_INVALID', nomineeOk);
  } else if (input.planManagementType === 'NDIA_MANAGED') {
    warnings.push('NDIA-managed: claim through PRODA Myplace; no email will be sent.');
    record('NDIA_MANUAL_CLAIM', true, 'NDIA-managed: claim through PRODA Myplace; no email will be sent.');
  }

  // 15 — Duplicate line detection (code, serviceDate, quantity, unitPrice)
  {
    const seen = new Set<string>();
    let hasDuplicate = false;
    for (const item of input.items) {
      const key = `${item.code}|${item.serviceDate}|${item.quantity}|${item.unitPrice}`;
      if (seen.has(key)) {
        hasDuplicate = true;
        warnings.push(`Duplicate line detected for ${item.code} on ${item.serviceDate}.`);
      } else {
        seen.add(key);
      }
    }
    record('DUPLICATE_LINE_WARNING', !hasDuplicate);
  }

  // 16 — Future service date
  {
    const todayStr = new Date().toISOString().slice(0, 10);
    let allPassed = true;
    for (const item of input.items) {
      if (item.serviceDate > todayStr) {
        allPassed = false;
      }
    }
    if (!allPassed) {
      errors.push('Invoice Error: A selected shift has a future service date.');
    }
    record('FUTURE_SERVICE_DATE', allPassed);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    checks,
  };
}
