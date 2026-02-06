import { config } from './config';
import { blockchainService } from './services/blockchain';

/**
 * Security checks and warnings for DACN backend
 */

export function runSecurityChecks(): void {
  console.log('🔒 Running security checks...\n');
  
  // Check 1: Private key exposure
  if (config.blockchain.privateKey) {
    const walletAddress = blockchainService.getAddress();
    const isTestnet = config.blockchain.rpcUrl.includes('sepolia') || 
                      config.blockchain.rpcUrl.includes('goerli') ||
                      config.blockchain.rpcUrl.includes('test');
    
    console.warn('⚠️  SECURITY WARNING: Private key configured');
    console.warn(`   Wallet: ${walletAddress}`);
    
    if (isTestnet) {
      console.log('   ✓ Using testnet - OK for development\n');
    } else {
      console.error('   🚨 PRODUCTION MAINNET DETECTED!');
      console.error('   Ensure this is a DEDICATED backend wallet');
      console.error('   NEVER use your personal mainnet wallet!\n');
    }
  } else {
    console.log('   ✓ No private key configured (read-only mode)\n');
  }
  
  // Check 2: Database path
  const dbPath = config.database.path;
  if (dbPath.includes('..') || dbPath.startsWith('/etc') || dbPath.startsWith('C:\\Windows')) {
    console.error('🚨 WARNING: Suspicious database path:', dbPath);
    console.error('   Using default path instead\n');
    config.database.path = './data/dacn.db';
  } else {
    console.log(`   ✓ Database path: ${dbPath}\n`);
  }
  
  // Check 3: Environment
  console.log(`   Environment: ${config.server.env}`);
  console.log(`   RPC URL: ${config.blockchain.rpcUrl}`);
  console.log(`   Contract: ${config.blockchain.contractAddress || 'NOT SET'}\n`);
  
  // Check 4: CORS
  if (config.server.env === 'development') {
    console.log('   ✓ CORS restricted to localhost in development\n');
  } else {
    const origins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) || [];
    if (origins.length === 0) {
      console.warn('⚠️  DEPLOYMENT REMINDER: Set CORS_ORIGINS in production (comma-separated frontend URLs).');
      console.warn('   Example: CORS_ORIGINS=https://app.example.com\n');
    }
  }

  console.log('🔒 Security checks complete\n');
}

export function getCorsOrigins(): string[] {
  if (config.server.env === 'production') {
    const origins = (process.env.CORS_ORIGINS?.split(',') || []).map((o) => o.trim()).filter(Boolean);
    if (origins.length === 0) {
      console.warn('⚠️  No CORS_ORIGINS set in production! Blocking all cross-origin requests.\n');
    }
    return origins;
  }
  
  // Development - localhost only
  return [
    'http://localhost:3000',
    'http://localhost:5173', 
    'http://localhost:4173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173'
  ];
}
