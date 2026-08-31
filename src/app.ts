import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { generalRateLimiter } from './middleware/rateLimiter';
import { notFoundHandler } from './middleware/notFoundHandler';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './auth/auth.routes';
import businessRoutes from './business/business.routes';
import adminRoutes from './admin/admin.routes';

export function createApp(): Express {
  const app = express();

  // Trust the first proxy hop (e.g. Render's load balancer) so req.ip and
  // rate limiting see the real client IP. MASTER-06 §16 Deployment.
  app.set('trust proxy', 1);

  // --- Security headers (BACKEND-01 §8, MASTER-10 §7) ---
  app.use(helmet());

  // --- CORS (BACKEND-01 §8) ---
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
      credentials: true,
    }),
  );

  // --- Body & cookie parsing ---
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // --- Global rate limiting (BACKEND-04 §13) ---
  app.use(generalRateLimiter);

  // --- Health check (used by deployment platform health checks, MASTER-06 §18) ---
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ success: true, message: 'OK', data: { status: 'healthy' } });
  });
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ success: true, message: 'OK', data: { status: 'healthy' } });
  });

  // --- API routes (supporting both /api/v1 and /api) ---
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/business', businessRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/business', businessRoutes);
  app.use('/api/admin', adminRoutes);

  // --- 404 + centralized error handling (BACKEND-01 §7) ---
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
