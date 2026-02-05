import path from 'path';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initializeDatabase } from './db/connection';
import { errorHandler, notFoundHandler } from './middleware/error';
import providersRouter from './routes/providers';
import creditsRouter from './routes/credits';
import webhooksRouter from './routes/webhooks';
import listingsRouter from './routes/listings';
import { config } from './config';
import { blockchainService } from './services/blockchain';
import { runSecurityChecks, getCorsOrigins } from './security';

const app = express();

// Run security checks on startup
runSecurityChecks();

// Security middleware – CSP relaxed so served frontend can load CDN scripts and run inline app code
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.venice.ai", "https://sepolia.base.org"],
      fontSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
}));
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
app.use('/api/listings', listingsRouter);

// Apply stricter rate limit to credit requests
app.use('/api/credits/request', creditLimiter);

// Static frontend (index.html at /, dashboard.html at /dashboard.html)
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { index: 'index.html' }));

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// Start server
app.listen(config.server.port, () => {
  const w = 50;
  const network = config.blockchain.rpcUrl.includes('sepolia') ? 'Base Sepolia (testnet)' : 'PRODUCTION MAINNET';
  console.log(`
╔${'═'.repeat(w)}╗
║${' DACN API Server'.padEnd(w)}║
╠${'═'.repeat(w)}╣
║  Port:      ${config.server.port.toString().padEnd(w - 13)}║
║  Env:       ${config.server.env.padEnd(w - 13)}║
║  Network:   ${network.padEnd(w - 13)}║
╚${'═'.repeat(w)}╝
  `);
});

export default app;
