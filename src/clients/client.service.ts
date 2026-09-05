import { Prisma, PlanManagementType } from "@prisma/client";
import { prisma } from "../config/database";
import { ApiError } from "../utils/ApiError";
import { recordAuditEvent } from "../audit/audit.service";
import { AuditAction } from "@prisma/client";
import { assertCanMutate, checkTrialResourceLimit } from "../business/trial.util";
import { buildPaginationMeta, paginationSkip } from "../utils/pagination";
import { CreateClientInput, UpdateClientInput, ListClientsQuery } from "./client.validators";

export interface ClientContext {
  businessId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export function calculateBudgetUtilization(
  total: Prisma.Decimal | number | null | undefined,
  spent: Prisma.Decimal | number | null | undefined
): number | null {
  if (total === null || total === undefined) return null;
  const totalNum = typeof total === "number" ? total : Number(total.toString());
  const spentNum = spent === null || spent === undefined ? 0 : typeof spent === "number" ? spent : Number(spent.toString());

  if (totalNum <= 0) return null;
  const percentage = (spentNum / totalNum) * 100;
  return Math.round(percentage * 100) / 100;
}

export async function createClient(input: CreateClientInput, ctx: ClientContext) {
  const { businessId, userId, ipAddress, userAgent } = ctx;

  await assertCanMutate(businessId);
  await checkTrialResourceLimit(businessId, "clients");

  if (input.defaultSupportItemCode) {
    const supportItem = await prisma.ndisSupportItem.findUnique({
      where: { itemNumber: input.defaultSupportItemCode },
    });
    if (!supportItem) {
      throw ApiError.badRequest(
        "Support item " + input.defaultSupportItemCode + " does not exist in the NDIS catalogue.",
        "INVALID_SUPPORT_ITEM"
      );
    }
    if (supportItem.effectiveTo && supportItem.effectiveTo < new Date()) {
      throw ApiError.badRequest(
        "Support item " + input.defaultSupportItemCode + " is no longer active in the NDIS catalogue.",
        "EXPIRED_SUPPORT_ITEM"
      );
    }
  }

  const existingActive = await prisma.client.findFirst({
    where: {
      businessId,
      ndisNumber: input.ndisNumber,
      deletedAt: null,
      isActive: true,
    },
  });

  if (existingActive) {
    throw ApiError.conflict(
      "A participant with NDIS number " + input.ndisNumber + " is already registered in your business.",
      "DUPLICATE_NDIS_NUMBER"
    );
  }

  const client = await prisma.client.create({
    data: {
      businessId,
      participantName: input.participantName,
      ndisNumber: input.ndisNumber,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      planManagementType: input.planManagementType,
      planManagerAgencyName:
        input.planManagementType === PlanManagementType.PLAN_MANAGED ? input.planManagerAgencyName : null,
      planManagerEmail:
        input.planManagementType === PlanManagementType.PLAN_MANAGED ? input.planManagerEmail : null,
      selfManagedBillingEmail: input.selfManagedBillingEmail ?? null,
      selfManagedBillingPhone: input.selfManagedBillingPhone ?? null,
      hourlyRateAgreed: input.hourlyRateAgreed !== undefined && input.hourlyRateAgreed !== null ? new Prisma.Decimal(input.hourlyRateAgreed) : null,
      defaultSupportItemCode: input.defaultSupportItemCode ?? null,
      allocatedBudgetTotal: input.allocatedBudgetTotal !== undefined && input.allocatedBudgetTotal !== null ? new Prisma.Decimal(input.allocatedBudgetTotal) : null,
      allocatedBudgetSpent: new Prisma.Decimal(0.0),
      isActive: true,
    },
  });

  await recordAuditEvent({
    action: AuditAction.CLIENT_CREATED,
    businessId,
    userId,
    ipAddress,
    userAgent,
    metadata: {
      clientId: client.id,
      participantName: client.participantName,
      ndisNumber: client.ndisNumber,
      planManagementType: client.planManagementType,
    },
  });

  return {
    ...client,
    budgetUtilizationPercent: calculateBudgetUtilization(client.allocatedBudgetTotal, client.allocatedBudgetSpent),
  };
}

export async function listClients(businessId: string, query: ListClientsQuery) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = paginationSkip(page, pageSize);

  const where: Prisma.ClientWhereInput = {
    businessId,
    deletedAt: null,
  };

  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  if (query.planManagementType) {
    where.planManagementType = query.planManagementType;
  }

  if (query.search) {
    const trimmed = query.search.trim();
    where.OR = [
      { participantName: { contains: trimmed, mode: "insensitive" } },
      { ndisNumber: { contains: trimmed } },
    ];
  }

  const [items, totalRecords] = await Promise.all([
    prisma.client.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        defaultSupportItem: {
          select: {
            itemNumber: true,
            supportItemName: true,
            categoryName: true,
            nationalWeekdayRate: true,
          },
        },
      },
    }),
    prisma.client.count({ where }),
  ]);

  const clientIds = items.map((c) => c.id);
  const pendingCounts = clientIds.length > 0
    ? await prisma.shift.groupBy({
        by: ["clientId"],
        where: {
          businessId,
          clientId: { in: clientIds },
          isInvoiced: false,
        },
        _count: { _all: true },
      })
    : [];

  const pendingMap = new Map<string, number>();
  for (const row of pendingCounts) {
    pendingMap.set(row.clientId, row._count._all);
  }

  const transformedItems = items.map((client) => ({
    ...client,
    pendingUninvoicedShiftsCount: pendingMap.get(client.id) ?? 0,
    budgetUtilizationPercent: calculateBudgetUtilization(client.allocatedBudgetTotal, client.allocatedBudgetSpent),
  }));

  return {
    items: transformedItems,
    pagination: buildPaginationMeta(page, pageSize, totalRecords),
  };
}

export async function getClientById(id: string, businessId: string) {
  const client = await prisma.client.findFirst({
    where: {
      id,
      businessId,
      deletedAt: null,
    },
    include: {
      defaultSupportItem: true,
      shifts: {
        where: { businessId },
        orderBy: { shiftDate: "desc" },
        take: 5,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });

  if (!client) {
    throw ApiError.notFound("Participant not found.");
  }

  return {
    ...client,
    budgetUtilizationPercent: calculateBudgetUtilization(client.allocatedBudgetTotal, client.allocatedBudgetSpent),
  };
}

export async function updateClient(id: string, input: UpdateClientInput, ctx: ClientContext) {
  const { businessId, userId, ipAddress, userAgent } = ctx;

  await assertCanMutate(businessId);

  const existing = await prisma.client.findFirst({
    where: {
      id,
      businessId,
      deletedAt: null,
    },
  });

  if (!existing) {
    throw ApiError.notFound("Participant not found.");
  }

  const targetPlanType = input.planManagementType ?? existing.planManagementType;
  if (targetPlanType === PlanManagementType.PLAN_MANAGED) {
    const finalAgencyName = input.planManagerAgencyName !== undefined ? input.planManagerAgencyName : existing.planManagerAgencyName;
    const finalAgencyEmail = input.planManagerEmail !== undefined ? input.planManagerEmail : existing.planManagerEmail;

    if (!finalAgencyName || finalAgencyName.trim() === "") {
      throw ApiError.badRequest(
        "Plan Manager agency name is required when plan management type is PLAN_MANAGED.",
        "PLAN_MANAGER_AGENCY_REQUIRED"
      );
    }
    if (!finalAgencyEmail || finalAgencyEmail.trim() === "") {
      throw ApiError.badRequest(
        "Plan Manager claims email is required when plan management type is PLAN_MANAGED.",
        "PLAN_MANAGER_EMAIL_REQUIRED"
      );
    }
  }

  if (input.defaultSupportItemCode && input.defaultSupportItemCode !== existing.defaultSupportItemCode) {
    const item = await prisma.ndisSupportItem.findUnique({
      where: { itemNumber: input.defaultSupportItemCode },
    });
    if (!item) {
      throw ApiError.badRequest(
        "Support item " + input.defaultSupportItemCode + " does not exist in the catalogue.",
        "INVALID_SUPPORT_ITEM"
      );
    }
  }

  const updated = await prisma.client.update({
    where: { id },
    data: {
      ...(input.participantName !== undefined ? { participantName: input.participantName } : {}),
      ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null } : {}),
      ...(input.planManagementType !== undefined ? { planManagementType: input.planManagementType } : {}),
      ...(input.planManagerAgencyName !== undefined ? { planManagerAgencyName: input.planManagerAgencyName } : {}),
      ...(input.planManagerEmail !== undefined ? { planManagerEmail: input.planManagerEmail } : {}),
      ...(input.selfManagedBillingEmail !== undefined ? { selfManagedBillingEmail: input.selfManagedBillingEmail } : {}),
      ...(input.selfManagedBillingPhone !== undefined ? { selfManagedBillingPhone: input.selfManagedBillingPhone } : {}),
      ...(input.hourlyRateAgreed !== undefined
        ? { hourlyRateAgreed: input.hourlyRateAgreed !== null ? new Prisma.Decimal(input.hourlyRateAgreed) : null }
        : {}),
      ...(input.defaultSupportItemCode !== undefined ? { defaultSupportItemCode: input.defaultSupportItemCode } : {}),
      ...(input.allocatedBudgetTotal !== undefined
        ? { allocatedBudgetTotal: input.allocatedBudgetTotal !== null ? new Prisma.Decimal(input.allocatedBudgetTotal) : null }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  await recordAuditEvent({
    action: AuditAction.CLIENT_UPDATED,
    businessId,
    userId,
    ipAddress,
    userAgent,
    metadata: {
      clientId: updated.id,
      updatedFields: Object.keys(input),
    },
  });

  return {
    ...updated,
    budgetUtilizationPercent: calculateBudgetUtilization(updated.allocatedBudgetTotal, updated.allocatedBudgetSpent),
  };
}

export async function softDeleteClient(id: string, ctx: ClientContext) {
  const { businessId, userId, ipAddress, userAgent } = ctx;

  await assertCanMutate(businessId);

  const existing = await prisma.client.findFirst({
    where: {
      id,
      businessId,
    },
  });

  if (!existing || existing.deletedAt) {
    throw ApiError.notFound("Participant not found.");
  }

  const deactivated = await prisma.client.update({
    where: { id },
    data: {
      isActive: false,
      deletedAt: new Date(),
    },
  });

  await recordAuditEvent({
    action: AuditAction.CLIENT_DELETED,
    businessId,
    userId,
    ipAddress,
    userAgent,
    metadata: {
      clientId: deactivated.id,
      participantName: deactivated.participantName,
      ndisNumber: deactivated.ndisNumber,
    },
  });

  return deactivated;
}
