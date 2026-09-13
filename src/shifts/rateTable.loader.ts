/**
 * MODULE 4 — rate table loader
 * src/shifts/rateTable.loader.ts
 *
 * The ONLY place Module 4 reads NDIS rates from. Never hardcode a rate
 * literal anywhere else (Section 0.1.3 / Section 17 acceptance #2).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { ApiError } from '../utils/ApiError';
import { RateTable } from './shift.types';

export const SUPPORT_ITEM_CODES = {
  DAY: '01_011_0107_1_1',
  EVENING: '01_015_0107_1_1',
  SATURDAY: '01_014_0107_1_1',
  SUNDAY: '01_013_0107_1_1',
  HOLIDAY: '01_012_0107_1_1',
  TRAVEL: '01_799_0107_1_1',
} as const;

export const DEFAULT_SUPPORT_ITEM_CODE = SUPPORT_ITEM_CODES.DAY;

/** The catalogue's tier columns are nullable; a missing rate is a configuration error. */
function capOrFail(value: Prisma.Decimal | null, itemNumber: string): Prisma.Decimal {
  if (value === null || value === undefined) {
    throw ApiError.internal(
      `NDIS support item ${itemNumber} has no rate configured for this tier`,
      'SUPPORT_CATALOGUE_INCOMPLETE'
    );
  }
  return value;
}

/**
 * Loads the six required catalogue rows and assembles a RateTable for the
 * engine. `agreedRate` and the resolved item's `travelAllowed` flag are
 * merged in by the caller (shift.service.ts) since they're per-shift, not
 * global to the catalogue.
 */
export async function loadRateTable(
  agreedRate: Prisma.Decimal | null,
  travelAllowed: boolean,
): Promise<RateTable> {
  const codes = Object.values(SUPPORT_ITEM_CODES);
  const rows = await prisma.ndisSupportItem.findMany({
    where: { itemNumber: { in: codes } },
  });

  const byCode = new Map(rows.map((r) => [r.itemNumber, r]));
  for (const code of codes) {
    if (!byCode.has(code)) {
      throw ApiError.internal(
        `Required NDIS support item ${code} is missing from the catalogue`,
        'SUPPORT_CATALOGUE_INCOMPLETE',
      );
    }
  }

  const day = byCode.get(SUPPORT_ITEM_CODES.DAY)!;
  const evening = byCode.get(SUPPORT_ITEM_CODES.EVENING)!;
  const saturday = byCode.get(SUPPORT_ITEM_CODES.SATURDAY)!;
  const sunday = byCode.get(SUPPORT_ITEM_CODES.SUNDAY)!;
  const holiday = byCode.get(SUPPORT_ITEM_CODES.HOLIDAY)!;
  const travel = byCode.get(SUPPORT_ITEM_CODES.TRAVEL)!;

  return {
    day: { itemCode: day.itemNumber, cap: capOrFail(day.nationalWeekdayRate, day.itemNumber) },
    evening: { itemCode: evening.itemNumber, cap: capOrFail(evening.nationalEveningRate, evening.itemNumber) },
    saturday: { itemCode: saturday.itemNumber, cap: capOrFail(saturday.nationalSaturdayRate, saturday.itemNumber) },
    sunday: { itemCode: sunday.itemNumber, cap: capOrFail(sunday.nationalSundayRate, sunday.itemNumber) },
    holiday: { itemCode: holiday.itemNumber, cap: capOrFail(holiday.nationalHolidayRate, holiday.itemNumber) },
    travel: { itemCode: travel.itemNumber, cap: capOrFail(travel.nationalWeekdayRate, travel.itemNumber), unit: 'KM' },
    agreedRate,
    travelAllowed,
  };
}

/**
 * Resolves which support item the shift should be filed against
 * (Section 12.1 step 5): request value > Client.defaultSupportItemCode >
 * DEFAULT_SUPPORT_ITEM_CODE. Confirms the item exists and is not expired.
 */
export async function resolveSupportItem(
  requestedCode: string | undefined,
  clientDefaultCode: string | null,
): Promise<{ itemCode: string; travelAllowed: boolean }> {
  const code = requestedCode ?? clientDefaultCode ?? DEFAULT_SUPPORT_ITEM_CODE;
  const item = await prisma.ndisSupportItem.findUnique({ where: { itemNumber: code } });
  if (!item || (item.effectiveTo && item.effectiveTo < new Date())) {
    throw ApiError.unprocessable(`Support item ${code} does not exist or has expired`, 'INVALID_SUPPORT_ITEM');
  }
  return { itemCode: item.itemNumber, travelAllowed: item.isTravelAllowed };
}
