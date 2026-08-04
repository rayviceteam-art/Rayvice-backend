import type { Server } from 'http';

import { createApp } from './app';
import { env } from './config/env.config';
import { logger } from './utils/logger';

const app = createApp();

const server: Server = app.listen(env.PORT, () => {
  logger.info(`Rayvice API listening on port ${env.PORT}`, {
    environment: env.NODE_ENV,
    url: env.APP_URL,
  });
});

function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  server.close((err) => {
    if (err) {
      logger.error('Error during server shutdown', { error: err.message });
      process.exit(1);
    }

    logger.info('Server closed. Goodbye.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});
