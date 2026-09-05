import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createClientSchema,
  updateClientSchema,
  listClientsQuerySchema,
  clientIdParamSchema,
} from "../src/clients/client.validators";
import { calculateBudgetUtilization } from "../src/clients/client.service";
import { Decimal } from "@prisma/client/runtime/library";

describe("Module 3: Client Validators", () => {
  const validPlanManaged = {
    participantName: "Sarah Jenkins",
    ndisNumber: "430123456",
    planManagementType: "PLAN_MANAGED",
    planManagerAgencyName: "My Plan Manager",
    planManagerEmail: "invoices@myplanmanager.com.au",
  };

  it("accepts valid plan-managed participant data", () => {
    const result = createClientSchema.safeParse({ body: validPlanManaged });
    assert.equal(result.success, true);
  });

  it("validates exactly 9-digit NDIS number", () => {
    assert.equal(createClientSchema.safeParse({ body: { ...validPlanManaged, ndisNumber: "43012345" } }).success, false);
    assert.equal(createClientSchema.safeParse({ body: { ...validPlanManaged, ndisNumber: "4301234567" } }).success, false);
    assert.equal(createClientSchema.safeParse({ body: { ...validPlanManaged, ndisNumber: "43012345A" } }).success, false);
    assert.equal(createClientSchema.safeParse({ body: { ...validPlanManaged, ndisNumber: "430123456" } }).success, true);
  });

  it("rejects empty participant name", () => {
    const result = createClientSchema.safeParse({ body: { ...validPlanManaged, participantName: "   " } });
    assert.equal(result.success, false);
  });

  it("enforces plan manager agency name and email when PLAN_MANAGED", () => {
    const noAgency = { ...validPlanManaged };
    delete (noAgency as any).planManagerAgencyName;
    assert.equal(createClientSchema.safeParse({ body: noAgency }).success, false);

    const noEmail = { ...validPlanManaged };
    delete (noEmail as any).planManagerEmail;
    assert.equal(createClientSchema.safeParse({ body: noEmail }).success, false);
  });

  it("allows SELF_MANAGED and NDIA_MANAGED without plan manager fields", () => {
    const selfManaged = {
      participantName: "Alex Chen",
      ndisNumber: "430123457",
      planManagementType: "SELF_MANAGED",
    };
    assert.equal(createClientSchema.safeParse({ body: selfManaged }).success, true);

    const ndiaManaged = {
      participantName: "Jordan Lee",
      ndisNumber: "430123458",
      planManagementType: "NDIA_MANAGED",
    };
    assert.equal(createClientSchema.safeParse({ body: ndiaManaged }).success, true);
  });

  it("rejects negative budget or hourly rate", () => {
    assert.equal(
      createClientSchema.safeParse({ body: { ...validPlanManaged, allocatedBudgetTotal: -500 } }).success,
      false
    );
    assert.equal(
      createClientSchema.safeParse({ body: { ...validPlanManaged, hourlyRateAgreed: -10 } }).success,
      false
    );
  });

  it("accepts valid ISO dateOfBirth and rejects invalid formats", () => {
    assert.equal(
      createClientSchema.safeParse({ body: { ...validPlanManaged, dateOfBirth: "1998-05-14" } }).success,
      true
    );
    assert.equal(
      createClientSchema.safeParse({ body: { ...validPlanManaged, dateOfBirth: "14-05-1998" } }).success,
      false
    );
  });

  it("validates UUID for clientIdParamSchema", () => {
    assert.equal(
      clientIdParamSchema.safeParse({ params: { id: "550e8400-e29b-41d4-a716-446655440000" } }).success,
      true
    );
    assert.equal(
      clientIdParamSchema.safeParse({ params: { id: "invalid-uuid" } }).success,
      false
    );
  });

  it("validates query pagination in listClientsQuerySchema", () => {
    const parsed = listClientsQuerySchema.safeParse({
      query: { page: "2", pageSize: "10", search: "Sarah", isActive: "true" },
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.query.page, 2);
      assert.equal(parsed.data.query.pageSize, 10);
      assert.equal(parsed.data.query.search, "Sarah");
      assert.equal(parsed.data.query.isActive, true);
    }
  });
});

describe("Module 3: Budget Utilization Calculation", () => {
  it("returns null when total budget is null, undefined, or 0", () => {
    assert.equal(calculateBudgetUtilization(null, 100), null);
    assert.equal(calculateBudgetUtilization(undefined, 100), null);
    assert.equal(calculateBudgetUtilization(0, 100), null);
  });

  it("returns correct percentage rounded to 2 decimal places", () => {
    assert.equal(calculateBudgetUtilization(1000, 500), 50);
    assert.equal(calculateBudgetUtilization(1000, 0), 0);
    assert.equal(calculateBudgetUtilization(300, 100), 33.33);
  });

  it("handles Prisma Decimal instances properly", () => {
    const total = new Decimal(5000.0);
    const spent = new Decimal(1250.0);
    assert.equal(calculateBudgetUtilization(total, spent), 25);
  });
});
