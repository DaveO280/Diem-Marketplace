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

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
});
app.use(limiter);

// Stricter rate limit for credit creation
const creditLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 credit requests per minute
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
    // Check blockchain connection
    const blockNumber = await blockchainService['provider'].getBlockNumber();
    const balance = await blockchainService.getBalance();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      blockchain: {
        connected: true,
        blockNumber,
        walletAddress: blockchainService.getAddress(),
        balance: `${balance} ETH`,
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
║          DACN API Server (Base Sepolia)                ║
╠════════════════════════════════════════════════════════╣
║  Port:      ${config.server.port.toString().padEnd(43)}║
║  Contract:  ${config.blockchain.contractAddress.slice(0, 20)}...${config.blockchain.contractAddress.slice(-10).padEnd(10)}║
║  Wallet:    ${blockchainService.getAddress().slice(0, 20)}...${blockchainService.getAddress().slice(-10).padEnd(10)}║
╚════════════════════════════════════════════════════════╝
  `);
});

export default app;
