import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/ApiResponse";
import * as clientService from "./client.service";
import { ListClientsQuery } from "./client.validators";

function requestMeta(req: Request) {
  return {
    businessId: req.user!.businessId,
    userId: req.user!.id,
    ipAddress: req.ip || undefined,
    userAgent: req.headers["user-agent"] || undefined,
  };
}

export const createClient = asyncHandler(async (req: Request, res: Response) => {
  const client = await clientService.createClient(req.body, requestMeta(req));
  sendSuccess(res, 201, "Participant created successfully.", client);
});

export const listClients = asyncHandler(async (req: Request, res: Response) => {
  const result = await clientService.listClients(req.user!.businessId, req.query as unknown as ListClientsQuery);
  sendSuccess(res, 200, "Participants retrieved successfully.", result);
});

export const getClientById = asyncHandler(async (req: Request, res: Response) => {
  const client = await clientService.getClientById(req.params.id as string, req.user!.businessId);
  sendSuccess(res, 200, "Participant retrieved successfully.", client);
});

export const updateClient = asyncHandler(async (req: Request, res: Response) => {
  const updated = await clientService.updateClient(req.params.id as string, req.body, requestMeta(req));
  sendSuccess(res, 200, "Participant updated successfully.", updated);
});

export const deleteClient = asyncHandler(async (req: Request, res: Response) => {
  const deactivated = await clientService.softDeleteClient(req.params.id as string, requestMeta(req));
  sendSuccess(res, 200, "Participant deactivated successfully.", deactivated);
});
