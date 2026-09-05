import { Router } from "express";
import * as clientController from "./client.controller";
import { authenticate } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";
import { validateRequest } from "../middleware/validateRequest";
import {
  createClientSchema,
  updateClientSchema,
  listClientsQuerySchema,
  clientIdParamSchema,
} from "./client.validators";

const router = Router();

// Apply authentication to all client routes
router.use(authenticate);

// List participants
router.get(
  "/",
  validateRequest(listClientsQuerySchema),
  clientController.listClients
);

// Get single participant details
router.get(
  "/:id",
  validateRequest(clientIdParamSchema),
  clientController.getClientById
);

// Create participant (OWNER or OFFICE_MANAGER)
router.post(
  "/",
  authorize("OWNER", "OFFICE_MANAGER"),
  validateRequest(createClientSchema),
  clientController.createClient
);

// Update participant (OWNER or OFFICE_MANAGER)
router.put(
  "/:id",
  authorize("OWNER", "OFFICE_MANAGER"),
  validateRequest(updateClientSchema),
  clientController.updateClient
);

// Soft delete / deactivate participant (OWNER or OFFICE_MANAGER)
router.delete(
  "/:id",
  authorize("OWNER", "OFFICE_MANAGER"),
  validateRequest(clientIdParamSchema),
  clientController.deleteClient
);

export default router;
