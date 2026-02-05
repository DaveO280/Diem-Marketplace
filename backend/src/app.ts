/**
 * Express app factory
 * Separated for testing
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import providerRoutes from './routes/providers';
import creditRoutes from './routes/credits';
import webhookRoutes from './routes/webhooks';
import { errorHandler } from './middleware/error';
import { getCorsOrigins } from './security';

export function createApp(): express.Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: getCorsOrigins()
  }));

  // Rate limiting
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  }));

  app.use(express.json());

  // Health check
  app.get('/health', async (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  // API routes
  app.use('/api/providers', providerRoutes);
  app.use('/api/credits', creditRoutes);
  app.use('/api/webhooks', webhookRoutes);

  // Error handling
  app.use(errorHandler);

  return app;
}
