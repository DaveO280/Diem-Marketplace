/**
 * Pre-deploy safety check
 * Prevents accidental mainnet deployments with loaded keys
 */

const NETWORK = process.env.HARDHAT_NETWORK || 'hardhat';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

console.log(`
╔══════════════════════════════════════════════════════════╗
║           DEPLOYMENT SAFETY CHECK                        ║
╠══════════════════════════════════════════════════════════╣
║  Network: ${NETWORK.padEnd(48)}║
║  Private Key: ${PRIVATE_KEY ? '⚠️ CONFIGURED' : '❌ NOT SET'}${''.padEnd(33)}║
╚══════════════════════════════════════════════════════════╝
`);

// Check for mainnet
const isMainnet = NETWORK === 'base' || NETWORK === 'mainnet' || NETWORK === 'baseMainnet';

if (isMainnet) {
  console.error('🚨🚨🚨  MAINNET DEPLOYMENT DETECTED  🚨🚨🚨');
  console.error('');
  console.error('You are about to deploy to PRODUCTION MAINNET.');
  console.error('This will:');
  console.error('  - Use real funds from the configured wallet');
  console.error('  - Deploy a permanent contract');
  console.error('  - Cost real ETH for gas');
  console.error('');
  console.error('If you are SURE you want to proceed, set:');
  console.error('  export CONFIRM_MAINNET_DEPLOY=true');
  console.error('');
  
  if (process.env.CONFIRM_MAINNET_DEPLOY !== 'true') {
    console.error('❌ Deployment blocked. Set CONFIRM_MAINNET_DEPLOY=true to override.');
    process.exit(1);
  }
  
  console.log('✅ Mainnet deployment confirmed. Proceeding...\n');
} else {
  console.log(`✅ Testnet/Local deployment (${NETWORK}) - Safe to proceed\n`);
}

// Warn if no private key
if (!PRIVATE_KEY) {
  console.error('⚠️  WARNING: No PRIVATE_KEY set in .env');
  console.error('   Deployment will fail or use default accounts.\n');
}
