import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initializeDatabase } from './db/connection';
import { errorHandler, notFoundHandler } from './middleware/error';
import providersRouter from './routes/providers';
import creditsRouter from './routes/credits';
import webhooksRouter from './routes/webhooks';
import { config } from './config';
import { blockchainService } from './services/blockchain';
import { runSecurityChecks, getCorsOrigins } from './security';

const app = express();

// Run security checks on startup
runSecurityChecks();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: getCorsOrigins(),
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
});
app.use(limiter);

// Stricter rate limit for credit creation
const creditLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many credit requests, please slow down' },
});

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Initialize database
initializeDatabase();
console.log('Database initialized');

// Health check
app.get('/health', async (req: Request, res: Response) => {
  try {
    const blockNumber = await blockchainService['provider'].getBlockNumber();
    const hasKey = !!config.blockchain.privateKey;
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      blockchain: {
        connected: true,
        blockNumber,
        walletConfigured: hasKey,
        walletAddress: hasKey ? blockchainService.getAddress() : null,
      },
    });
  } catch (error: any) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// API routes
app.use('/api/providers', providersRouter);
app.use('/api/credits', creditsRouter);
app.use('/api/webhooks', webhooksRouter);

// Apply stricter rate limit to credit requests
app.use('/api/credits/request', creditLimiter);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// Start server
app.listen(config.server.port, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║          DACN API Server                               ║
╠════════════════════════════════════════════════════════╣
║  Port:      ${config.server.port.toString().padEnd(43)}║
║  Env:       ${config.server.env.padEnd(43)}║
║  Network:   ${config.blockchain.rpcUrl.includes('sepolia') ? 'Base Sepolia (testnet)' : 'PRODUCTION MAINNET ⚠️'}${''.padEnd(24)}║
╚════════════════════════════════════════════════════════╝
  `);
});

export default app;
