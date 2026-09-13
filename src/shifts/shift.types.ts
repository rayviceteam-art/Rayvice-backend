/**
 * MODULE 4 — shared type contracts
 *
 * NOTE ON Decimal: in the real repo, replace the `decimal.js` import
 * below with `import { Prisma } from '@prisma/client'; type Decimal =
 * Prisma.Decimal;` and `import Decimal from '@prisma/client/runtime/...'`
 * is not needed — `new Prisma.Decimal(x)` has the identical API used
 * throughout this module (decimal.js under the hood).
 */
import { Prisma } from '@prisma/client';
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

export type RateTier = 'DAY' | 'EVENING' | 'SATURDAY' | 'SUNDAY' | 'HOLIDAY' | 'TRAVEL';
export type ShiftStatus = 'PENDING' | 'INVOICED' | 'CANCELLED';
export type RateSource = 'AUTO' | 'MANUAL' | 'NOT_HOLIDAY';
export type PlanTier = 'TRIAL' | 'STARTER' | 'PRO';

export interface ShiftCalculationInput {
  date: string; // "YYYY-MM-DD" business-local calendar date of shift start
  startTime: string; // "HH:mm" 24-hour, business local time
  endTime: string; // "HH:mm" 24-hour, business local time
  travelKms?: number | null; // optional, >= 0, max 500
  timezone: string; // IANA, e.g. "Australia/Sydney"
  isPublicHoliday?: boolean | null; // null/undefined = auto-detect
}

export interface RateCell {
  itemCode: string;
  cap: Decimal;
}

export interface RateTable {
  day: RateCell;
  evening: RateCell;
  saturday: RateCell;
  sunday: RateCell;
  holiday: RateCell;
  travel: RateCell & { unit: 'KM' };
  agreedRate: Decimal | null; // Client.hourlyRateAgreed
  travelAllowed: boolean; // NdisSupportItem.isTravelAllowed for the chosen item
}

export interface CalculatedLine {
  rateTier: RateTier;
  supportItemCode: string;
  description: string;
  quantity: Decimal;
  unit: 'Hour' | 'KM';
  ndisCapRate: Decimal;
  appliedRate: Decimal;
  amount: Decimal;
  segmentStart: Date | null;
  segmentEnd: Date | null;
  sortOrder: number;
}

export interface ShiftCalculationResult {
  lines: CalculatedLine[];
  totalHours: Decimal;
  travelKms: Decimal;
  grandTotal: Decimal;
  isPublicHoliday: boolean;
  publicHolidayName: string | null;
  holidaySource: RateSource;
  startAt: Date;
  endAt: Date;
  timezoneUsed: string;
  warnings: string[];
}

/**
 * Injected holiday fact resolver — kept out of the engine so the engine
 * itself has zero I/O and is trivially unit-testable. The real
 * implementation (src/shifts/holiday.service.ts) wraps the offline
 * `date-holidays` package (Section 5.5) keyed by the business's state.
 */
export type HolidayChecker = (localDateISO: string) => { isHoliday: boolean; name: string | null };

export const ENGINE_ERROR_CODES = [
  'SHIFT_TIME_FORMAT_INVALID',
  'SHIFT_DATE_INVALID',
  'SHIFT_DURATION_INVALID',
  'SHIFT_DURATION_TOO_LONG',
  'TRAVEL_KM_INVALID',
  'TRAVEL_NOT_ALLOWED_FOR_ITEM',
  'SUPPORT_CATALOGUE_INCOMPLETE',
] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export class ShiftEngineError extends Error {
  code: EngineErrorCode;
  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'ShiftEngineError';
    this.code = code;
  }
}
