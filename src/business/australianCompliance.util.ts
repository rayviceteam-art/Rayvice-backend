/**
 * Australian Compliance & Financial System Utilities
 * Source of truth: Australian Taxation Office (ATO) & NDIA Tax Invoicing Rules
 */

// ATO ABN weighting factors for Modulo 89 calculation
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;

/**
 * Validates an Australian Business Number (ABN) using the official ATO Modulo 89 algorithm.
 *
 * Algorithm Rules:
 * 1. Must be 11 numeric digits.
 * 2. Subtract 1 from the first digit.
 * 3. Multiply each digit by its weighting factor.
 * 4. Sum all products.
 * 5. Divide the sum by 89. If remainder is 0, the ABN is valid.
 */
export function validateAbn(rawAbn: string | null | undefined): {
  isValid: boolean;
  error?: string;
  formatted?: string;
  digits?: string;
} {
  if (!rawAbn || typeof rawAbn !== 'string') {
    return { isValid: false, error: 'ABN is required.' };
  }

  const digits = rawAbn.replace(/\s+/g, '').replace(/-/g, '');

  if (!/^\d{11}$/.test(digits)) {
    return { isValid: false, error: 'ABN must be exactly 11 numeric digits.', digits };
  }

  const digitArray = digits.split('').map(Number);

  // Step 2 & 3: Subtract 1 from first digit and calculate weighted sum
  const weightedSum = digitArray.reduce((acc, digit, idx) => {
    const adjusted = idx === 0 ? digit - 1 : digit;
    return acc + adjusted * ABN_WEIGHTS[idx];
  }, 0);

  // Step 4 & 5: Check remainder
  if (weightedSum % 89 !== 0) {
    return { isValid: false, error: 'Invalid ABN checksum according to ATO Modulo 89 algorithm.', digits };
  }

  // Format as standard Australian presentation: XX XXX XXX XXX
  const formatted = `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;

  return { isValid: true, formatted, digits };
}

/**
 * Common Australian Bank BSB prefix mapping
 */
const BSB_BANK_PREFIX_MAP: Record<string, string> = {
  '01': 'Australia and New Zealand Banking Group (ANZ)',
  '02': 'Australia and New Zealand Banking Group (ANZ)',
  '03': 'Westpac Banking Corporation',
  '73': 'Westpac Banking Corporation',
  '06': 'Commonwealth Bank of Australia (CBA)',
  '07': 'Commonwealth Bank of Australia (CBA)',
  '08': 'National Australia Bank (NAB)',
  '09': 'National Australia Bank (NAB)',
  '11': 'St. George Bank / BankSA / Bank of Melbourne',
  '18': 'Macquarie Bank',
  '48': 'Suncorp Bank',
  '63': 'Beyond Bank Australia',
  '80': 'Cuscal / Community Mutual Banks',
  '91': 'ING Bank Australia',
  '92': 'Bendigo and Adelaide Bank',
  '94': 'AMP Bank',
};

/**
 * Validates and formats an Australian Bank State Branch (BSB) code.
 * Standard format: XXX-XXX (6 numeric digits).
 */
export function validateAndFormatBsb(rawBsb: string | null | undefined): {
  isValid: boolean;
  error?: string;
  formatted?: string;
  bankName?: string;
} {
  if (!rawBsb || typeof rawBsb !== 'string') {
    return { isValid: false, error: 'BSB is required.' };
  }

  const digits = rawBsb.replace(/\D/g, '');

  if (digits.length !== 6) {
    return { isValid: false, error: 'BSB must be exactly 6 numeric digits (e.g. 062-000).' };
  }

  const prefix = digits.slice(0, 2);
  const bankName = BSB_BANK_PREFIX_MAP[prefix] || 'Australian Financial Institution';
  const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;

  return { isValid: true, formatted, bankName };
}

/**
 * Validates Australian Bank Account Number.
 * Australian bank accounts are typically 6 to 9 digits.
 */
export function validateAccountNumber(rawAcc: string | null | undefined): {
  isValid: boolean;
  error?: string;
  digits?: string;
} {
  if (!rawAcc || typeof rawAcc !== 'string') {
    return { isValid: false, error: 'Account number is required.' };
  }

  const digits = rawAcc.replace(/\s+/g, '').replace(/-/g, '');

  if (!/^\d{6,9}$/.test(digits)) {
    return { isValid: false, error: 'Account number must be 6 to 9 numeric digits.' };
  }

  return { isValid: true, digits };
}

export const AUSTRALIAN_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;

export interface ComplianceEvaluationInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  abn?: string | null;
  bsb?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  bankName?: string | null;
  invoicePrefix?: string | null;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  isGstRegistered?: boolean | null;
}

export interface ComplianceReport {
  isCompliant: boolean;
  readinessPercentage: number;
  checklist: {
    abn: boolean;
    bankDetails: boolean;
    businessAddress: boolean;
    contactInfo: boolean;
    invoicePrefix: boolean;
  };
  missingFields: string[];
  recommendations: string[];
}

/**
 * Pre-Flight Compliance Shield Evaluator
 * Verifies whether the sole trader's business profile satisfies all mandatory
 * ATO & NDIS requirements to issue valid, auto-rejection-free tax invoices.
 */
export function evaluateComplianceReadiness(business: ComplianceEvaluationInput): ComplianceReport {
  const missingFields: string[] = [];
  const recommendations: string[] = [];

  // 1. ABN Check
  const abnCheck = validateAbn(business.abn);
  const hasValidAbn = abnCheck.isValid;
  if (!hasValidAbn) {
    missingFields.push('abn');
    recommendations.push(business.abn ? 'Provide a valid 11-digit ABN verified by the ATO.' : 'Add your 11-digit Australian Business Number (ABN).');
  }

  // 2. Bank Details (BSB + Account Number)
  const bsbCheck = validateAndFormatBsb(business.bsb);
  const accCheck = validateAccountNumber(business.accountNumber);
  const hasBankDetails = bsbCheck.isValid && accCheck.isValid;
  if (!bsbCheck.isValid) {
    missingFields.push('bsb');
    recommendations.push('Add a valid 6-digit BSB code (e.g. 062-000).');
  }
  if (!accCheck.isValid) {
    missingFields.push('accountNumber');
    recommendations.push('Add your 6 to 9-digit bank account number for direct EFT payments.');
  }

  // 3. Business Address / Location
  const hasAddress = Boolean(business.address && business.suburb && business.state && business.postcode);
  if (!business.address) missingFields.push('address');
  if (!business.suburb) missingFields.push('suburb');
  if (!business.state) missingFields.push('state');
  if (!business.postcode) missingFields.push('postcode');

  if (!hasAddress) {
    recommendations.push('Complete your physical business address (Street, Suburb, State, Postcode) for ATO compliant tax invoice headers.');
  }

  // 4. Contact Info
  const hasContact = Boolean(business.name && (business.phone || business.email));
  if (!business.phone) {
    recommendations.push('Add a contact phone number so Plan Managers can reach you regarding payment remittances.');
  }

  // 5. Invoice Prefix
  const hasInvoicePrefix = Boolean(business.invoicePrefix && business.invoicePrefix.trim().length > 0);

  const checklist = {
    abn: hasValidAbn,
    bankDetails: hasBankDetails,
    businessAddress: hasAddress,
    contactInfo: hasContact,
    invoicePrefix: hasInvoicePrefix,
  };

  const totalCriteria = 5;
  const passedCriteria = Object.values(checklist).filter(Boolean).length;
  const readinessPercentage = Math.round((passedCriteria / totalCriteria) * 100);
  const isCompliant = hasValidAbn && hasBankDetails && Boolean(business.name);

  return {
    isCompliant,
    readinessPercentage,
    checklist,
    missingFields,
    recommendations,
  };
}
