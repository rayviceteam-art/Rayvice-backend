import cors from 'cors';
import express, { type Application } from 'express';
import helmet from 'helmet';

import { env } from './config/env.config';
import { errorHandlerMiddleware } from './middlewares/errorHandler.middleware';
import { notFoundMiddleware } from './middlewares/notFound.middleware';
import rootRouter from './routes';

/**
 * Builds and configures the Express application.
 *
 * Kept separate from `server.ts` so the app instance can be imported
 * directly in tests without binding to a real network port.
 */
export function createApp(): Application {
  const app = express();

  // Trust the first proxy hop (required behind Render/other PaaS load balancers
  // for correct client IPs, secure cookies, and rate limiting).
  app.set('trust proxy', 1);

  // --- Security ---
  app.use(helmet());
  app.use(
    cors({
      origin: (env.CLIENT_URL || 'http://localhost:5173').trim().replace(/\/$/, ''),
      credentials: true,
    }),
  );

  // --- Body parsing ---
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // --- Routes ---
  app.use('/api/v1', rootRouter);

  // --- 404 + centralized error handling (must be registered last) ---
  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}
