import { Prisma } from "@prisma/client";
import { prisma } from "./database";
import { logger } from "./logger";

/**
 * 2026 NDIS Price Guide catalogue items (supports Module 3 default-support
 * selection and Module 4 rate splits). The production database had no seed
 * data for this table, so every participant creation with a default support
 * item was rejected with INVALID_SUPPORT_ITEM. This idempotent upsert runs at
 * server startup (and can be run manually via `npm run db:seed`).
 */
const CATALOGUE: Array<{
  itemNumber: string;
  supportItemName: string;
  categoryName: string;
  unit: string;
  nationalWeekdayRate: number;
  nationalEveningRate: number | null;
  nationalSaturdayRate: number | null;
  nationalSundayRate: number | null;
  nationalHolidayRate: number | null;
  isTravelAllowed: boolean;
}> = [
  {
    itemNumber: "01_011_0107_1_1",
    supportItemName: "Assistance with Daily Life",
    categoryName: "Daily Life Support",
    unit: "Hour",
    nationalWeekdayRate: 67.56,
    nationalEveningRate: 74.42,
    nationalSaturdayRate: 95.07,
    nationalSundayRate: 122.59,
    nationalHolidayRate: 150.12,
    isTravelAllowed: true,
  },
  {
    itemNumber: "01_002_0107_1_1",
    supportItemName: "Assistance with Self-Care Activities",
    categoryName: "Self-Care Support",
    unit: "Hour",
    nationalWeekdayRate: 67.56,
    nationalEveningRate: 74.42,
    nationalSaturdayRate: 95.07,
    nationalSundayRate: 122.59,
    nationalHolidayRate: 150.12,
    isTravelAllowed: true,
  },
  {
    itemNumber: "01_013_0117_1_1",
    supportItemName: "Community Participation",
    categoryName: "Community Participation",
    unit: "Hour",
    nationalWeekdayRate: 67.56,
    nationalEveningRate: 74.42,
    nationalSaturdayRate: 95.07,
    nationalSundayRate: 122.59,
    nationalHolidayRate: 150.12,
    isTravelAllowed: true,
  },
  {
    itemNumber: "04_104_0125_6_1",
    supportItemName: "Household Tasks",
    categoryName: "Household Tasks",
    unit: "Hour",
    nationalWeekdayRate: 55.23,
    nationalEveningRate: 61.18,
    nationalSaturdayRate: 77.32,
    nationalSundayRate: 99.41,
    nationalHolidayRate: 110.46,
    isTravelAllowed: true,
  },
  {
    itemNumber: "15_056_0128_1_3",
    supportItemName: "Innovative Community Participation",
    categoryName: "Innovative Community Participation",
    unit: "Hour",
    nationalWeekdayRate: 67.56,
    nationalEveningRate: 74.42,
    nationalSaturdayRate: 95.07,
    nationalSundayRate: 122.59,
    nationalHolidayRate: 150.12,
    isTravelAllowed: true,
  },
  // Module 4 split-engine rate tiers (referenced by BACKEND_SPECIFICATION §4.1)
  {
    itemNumber: "01_015_0107_1_1",
    supportItemName: "Assistance with Daily Life (Evening)",
    categoryName: "Daily Life Support",
    unit: "Hour",
    nationalWeekdayRate: 74.42,
    nationalEveningRate: 74.42,
    nationalSaturdayRate: 74.42,
    nationalSundayRate: 74.42,
    nationalHolidayRate: 74.42,
    isTravelAllowed: true,
  },
  {
    itemNumber: "01_014_0107_1_1",
    supportItemName: "Assistance with Daily Life (Saturday)",
    categoryName: "Daily Life Support",
    unit: "Hour",
    nationalWeekdayRate: 95.07,
    nationalEveningRate: 95.07,
    nationalSaturdayRate: 95.07,
    nationalSundayRate: 95.07,
    nationalHolidayRate: 95.07,
    isTravelAllowed: true,
  },
  {
    itemNumber: "01_013_0107_1_1",
    supportItemName: "Assistance with Daily Life (Sunday)",
    categoryName: "Daily Life Support",
    unit: "Hour",
    nationalWeekdayRate: 122.59,
    nationalEveningRate: 122.59,
    nationalSaturdayRate: 122.59,
    nationalSundayRate: 122.59,
    nationalHolidayRate: 122.59,
    isTravelAllowed: true,
  },
  {
    itemNumber: "01_012_0107_1_1",
    supportItemName: "Assistance with Daily Life (Public Holiday)",
    categoryName: "Daily Life Support",
    unit: "Hour",
    nationalWeekdayRate: 150.12,
    nationalEveningRate: 150.12,
    nationalSaturdayRate: 150.12,
    nationalSundayRate: 150.12,
    nationalHolidayRate: 150.12,
    isTravelAllowed: true,
  },
  {
    itemNumber: "01_799_0107_1_1",
    supportItemName: "Activity-Based Transport",
    categoryName: "Transport",
    unit: "KM",
    nationalWeekdayRate: 0.97,
    nationalEveningRate: 0.97,
    nationalSaturdayRate: 0.97,
    nationalSundayRate: 0.97,
    nationalHolidayRate: 0.97,
    isTravelAllowed: true,
  },
];

export async function ensureSupportCatalogueSeeded(): Promise<void> {
  const EFFECTIVE_FROM = new Date("2026-07-01T00:00:00.000Z");

  for (const item of CATALOGUE) {
    await prisma.ndisSupportItem.upsert({
      where: { itemNumber: item.itemNumber },
      create: {
        itemNumber: item.itemNumber,
        supportItemName: item.supportItemName,
        categoryName: item.categoryName,
        unit: item.unit,
        nationalWeekdayRate: new Prisma.Decimal(item.nationalWeekdayRate),
        nationalEveningRate: item.nationalEveningRate !== null ? new Prisma.Decimal(item.nationalEveningRate) : null,
        nationalSaturdayRate: item.nationalSaturdayRate !== null ? new Prisma.Decimal(item.nationalSaturdayRate) : null,
        nationalSundayRate: item.nationalSundayRate !== null ? new Prisma.Decimal(item.nationalSundayRate) : null,
        nationalHolidayRate: item.nationalHolidayRate !== null ? new Prisma.Decimal(item.nationalHolidayRate) : null,
        isTravelAllowed: item.isTravelAllowed,
        effectiveFrom: EFFECTIVE_FROM,
      },
      update: {
        supportItemName: item.supportItemName,
        categoryName: item.categoryName,
        unit: item.unit,
        nationalWeekdayRate: new Prisma.Decimal(item.nationalWeekdayRate),
        nationalEveningRate: item.nationalEveningRate !== null ? new Prisma.Decimal(item.nationalEveningRate) : null,
        nationalSaturdayRate: item.nationalSaturdayRate !== null ? new Prisma.Decimal(item.nationalSaturdayRate) : null,
        nationalSundayRate: item.nationalSundayRate !== null ? new Prisma.Decimal(item.nationalSundayRate) : null,
        nationalHolidayRate: item.nationalHolidayRate !== null ? new Prisma.Decimal(item.nationalHolidayRate) : null,
        isTravelAllowed: item.isTravelAllowed,
      },
    });
  }

  logger.info(`NDIS support catalogue ensured (${CATALOGUE.length} items).`);
}
