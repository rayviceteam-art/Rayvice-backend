import type { Request, Response } from 'express';

import { env } from '../config/env.config';

/**
 * Reports basic liveness information. Used by load balancers, uptime
 * monitors, and deployment platforms (e.g. Render) to verify the
 * service is running.
 */
export function getHealthStatus(_req: Request, res: Response): void {
  res.status(200).json({
    success: true,
    message: 'Rayvice API is healthy',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
}
