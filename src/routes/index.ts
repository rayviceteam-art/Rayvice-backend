import { Router } from 'express';

import healthRoutes from './health.routes';

/**
 * Root API router.
 *
 * Feature modules (auth, crm, appointments, billing, ai, etc.) will each
 * expose their own router under `src/modules/<module>/` and be mounted
 * here in later steps, keeping this file as the single place that maps
 * URL prefixes to modules.
 */
const router = Router();

router.use('/health', healthRoutes);

export default router;
