#!/usr/bin/env node

/**
 * DACN Provider CLI
 * 
 * For DIEM holders to list and manage API credit offerings
 * 
 * Usage:
 *   dacn-provider login
 *   dacn-provider list --diem 5.0 --price 0.95
 *   dacn-provider status
 *   dacn-provider withdraw
 */

const { Command } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');
const { ethers } = require('ethers');
const crypto = require('crypto');

const CONFIG_DIR = path.join(os.homedir(), '.dacn');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const API_URL = process.env.DACN_API_URL || 'https://api.diemcredit.network/v1';

// Contract addresses - will be updated after deployment
const CONTRACTS = {
  baseSepolia: {
    escrow: process.env.ESCROW_CONTRACT || '',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
  },
  baseMainnet: {
    escrow: '',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  }
};

const ESCROW_ABI = [
  "function withdrawProviderBalance() external",
  "function providerBalances(address) view returns (uint256)",
  "function accumulatedPlatformFees() view returns (uint256)",
  "function paused() view returns (bool)",
  "event ProviderWithdrawal(address indexed provider, uint256 amount)"
];

const program = new Command();

// Simple encryption using a key derived from machine-specific info
// NOTE: This is NOT foolproof - determined attackers with root access can still extract keys
// For production, use hardware wallets or proper key management systems
function getEncryptionKey() {
  // Use machine-specific info to derive a key
  // This prevents simple copy-paste of config files between machines
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const platform = os.platform();
  
  return crypto.scryptSync(
    `${hostname}:${username}:${platform}:dacn-salt-v1`,
    'dacn-static-salt-change-in-production',
    32
  );
}

function encrypt(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(16);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  } catch (err) {
    console.error('Encryption failed:', err.message);
    return '';
  }
}

function decrypt(encryptedData) {
  if (!encryptedData) return '';
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) return '';
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption failed. Config may be from different machine or corrupted.');
    return '';
  }
}

async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    const config = JSON.parse(data);
    
    // Decrypt sensitive fields
    if (config.walletPrivateKeyEncrypted) {
      config.walletPrivateKey = decrypt(config.walletPrivateKeyEncrypted);
    }
    if (config.veniceApiKeyEncrypted) {
      config.veniceApiKey = decrypt(config.veniceApiKeyEncrypted);
    }
    
    return config;
  } catch {
    return null;
  }
}

async function saveConfig(config) {
  // Create config directory with restricted permissions
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  
  // Encrypt sensitive fields
  const configToSave = {
    ...config,
    walletPrivateKeyEncrypted: encrypt(config.walletPrivateKey),
    veniceApiKeyEncrypted: encrypt(config.veniceApiKey)
  };
  
  // Remove plaintext keys from saved config
  delete configToSave.walletPrivateKey;
  delete configToSave.veniceApiKey;
  
  // Write with restricted permissions
  await fs.writeFile(
    CONFIG_FILE, 
    JSON.stringify(configToSave, null, 2), 
    { mode: 0o600 }
  );
  
  console.log('✅ Configuration saved with encryption');
  console.log('⚠️  NOTE: Keys are encrypted but still stored locally.');
  console.log('   For maximum security, use a hardware wallet in production.');
}

function getApiClient(config) {
  return axios.create({
    baseURL: API_URL,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
}

function validateAddress(address, name) {
  if (!address) {
    throw new Error(`${name} is required`);
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`Invalid ${name}: ${address}`);
  }
  return address;
}

function validateAmount(amount, name, min = 0) {
  const val = parseFloat(amount);
  if (isNaN(val) || val <= min) {
    throw new Error(`${name} must be greater than ${min}`);
  }
  return val;
}

// Commands
program
  .name('dacn-provider')
  .description('DACN Provider CLI - Monetize your DIEM tokens')
  .version('0.1.0');

program
  .command('login')
  .description('Authenticate with DACN platform')
  .action(async () => {
    console.log('🔐 DACN Provider Login\n');
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'apiKey',
        message: 'Enter your DACN API key:',
        validate: (input) => input.length > 0 || 'API key is required'
      },
      {
        type: 'input',
        name: 'veniceApiKey',
        message: 'Enter your Venice Admin API key:',
        validate: (input) => input.length > 0 || 'Venice API key is required'
      },
      {
        type: 'input',
        name: 'walletPrivateKey',
        message: 'Enter your Base wallet private key (for receiving USDC):',
        validate: (input) => {
          if (input.length === 0) return 'Private key is required';
          if (!/^0x[a-fA-F0-9]{64}$/.test(input)) return 'Invalid private key format (should be 0x + 64 hex chars)';
          return true;
        }
      },
      {
        type: 'input',
        name: 'escrowContract',
        message: 'Escrow contract address (Base Sepolia):',
        default: CONTRACTS.baseSepolia.escrow,
        validate: (input) => {
          if (!input) return 'Contract address is required for withdrawals';
          if (!/^0x[a-fA-F0-9]{40}$/.test(input)) return 'Invalid Ethereum address';
          return true;
        }
      },
      {
        type: 'confirm',
        name: 'save',
        message: 'Save credentials locally? (encrypted)',
        default: true
      }
    ]);
    
    // Verify API key works
    try {
      const client = axios.create({
        baseURL: API_URL,
        headers: { 'Authorization': `Bearer ${answers.apiKey}` },
        timeout: 10000
      });
      await client.get('/provider/profile');
      console.log('✅ API key verified');
    } catch (err) {
      console.error('❌ API key invalid:', err.message);
      process.exit(1);
    }
    
    // Verify Venice key works
    try {
      const response = await axios.get('https://api.venice.ai/api/v1/api_keys', {
        headers: { 'Authorization': `Bearer ${answers.veniceApiKey}` },
        timeout: 10000
      });
      console.log(`✅ Venice API key verified (${response.data.data?.length || 0} existing keys)`);
    } catch (err) {
      console.error('❌ Venice API key invalid:', err.message);
      process.exit(1);
    }
    
    // Verify wallet
    let walletAddress;
    try {
      const wallet = new ethers.Wallet(answers.walletPrivateKey);
      walletAddress = wallet.address;
      console.log(`✅ Wallet verified: ${walletAddress}`);
    } catch (err) {
      console.error('❌ Invalid private key:', err.message);
      process.exit(1);
    }
    
    if (answers.save) {
      await saveConfig({
        apiKey: answers.apiKey,
        veniceApiKey: answers.veniceApiKey,
        walletPrivateKey: answers.walletPrivateKey,
        walletAddress: walletAddress,
        escrowContract: answers.escrowContract,
        providerAddress: walletAddress
      });
    }
    
    console.log('\n🎉 Login successful! You can now list DIEM capacity.');
  });

program
  .command('list')
  .description('List DIEM capacity for rent')
  .option('-d, --diem <amount>', 'Amount of DIEM to list', '1.0')
  .option('-p, --price <price>', 'Price per DIEM in USDC', '0.95')
  .option('-m, --min <amount>', 'Minimum purchase amount', '0.1')
  .option('-x, --max <amount>', 'Maximum purchase amount')
  .option('-t, --duration <hours>', 'Duration in hours', '24')
  .action(async (options) => {
    const config = await loadConfig();
    if (!config) {
      console.error('❌ Not logged in. Run: dacn-provider login');
      process.exit(1);
    }
    
    console.log('📋 Creating DIEM Listing\n');
    
    try {
      const diemAmount = validateAmount(options.diem, 'DIEM amount');
      const price = validateAmount(options.price, 'Price', 0);
      const minPurchase = validateAmount(options.min, 'Min purchase', 0);
      const maxPurchase = options.max ? validateAmount(options.max, 'Max purchase') : diemAmount;
      const duration = parseInt(options.duration);
      
      if (duration < 1 || duration > 168) {
        throw new Error('Duration must be between 1 and 168 hours');
      }
      
      if (minPurchase > diemAmount) {
        throw new Error('Min purchase cannot exceed total DIEM');
      }
      if (maxPurchase > diemAmount) {
        throw new Error('Max purchase cannot exceed total DIEM');
      }
      
      // Verify we have enough DIEM staked
      console.log('Checking Venice DIEM balance...');
      try {
        const response = await axios.get('https://api.venice.ai/api/v1/api_keys/rate_limits', {
          headers: { 'Authorization': `Bearer ${config.veniceApiKey}` },
          timeout: 10000
        });
        const diemBalance = response.data.data?.diemBalance || 0;
        
        if (diemBalance < diemAmount) {
          console.error(`❌ Insufficient DIEM: have ${diemBalance}, need ${diemAmount}`);
          process.exit(1);
        }
        
        console.log(`✅ DIEM balance: ${diemBalance} (listing ${diemAmount})`);
      } catch (err) {
        console.error('❌ Failed to check DIEM balance:', err.message);
        process.exit(1);
      }
      
      // Confirm listing
      console.log('\n📊 Listing Summary:');
      console.log(`   DIEM Available: ${diemAmount}`);
      console.log(`   Price: ${price} USDC/DIEM (${((1 - price) * 100).toFixed(1)}% discount)`);
      console.log(`   Min Purchase: ${minPurchase} DIEM`);
      console.log(`   Max Purchase: ${maxPurchase} DIEM`);
      console.log(`   Duration: ${duration} hours`);
      console.log(`   Est. Revenue: ${(diemAmount * price).toFixed(2)} USDC if fully utilized`);
      
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Create this listing?',
        default: true
      }]);
      
      if (!confirm) {
        console.log('Cancelled');
        return;
      }
      
      // Create listing
      const client = getApiClient(config);
      const response = await client.post('/listings', {
        diem_available: diemAmount,
        price_per_diem: price,
        min_purchase: minPurchase,
        max_purchase: maxPurchase,
        duration_hours: duration
      });
      
      console.log('\n✅ Listing created!');
      console.log(`   ID: ${response.data.listing_id}`);
      console.log(`   Status: ${response.data.status}`);
      console.log(`   Expires: ${response.data.expires_at}`);
      console.log('\nThe marketplace will now match you with agents.');
      
    } catch (err) {
      console.error('❌ Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('listings')
  .description('View your active listings')
  .action(async () => {
    const config = await loadConfig();
    if (!config) {
      console.error('❌ Not logged in');
      process.exit(1);
    }
    
    try {
      const client = getApiClient(config);
      const response = await client.get('/provider/listings');
      
      const listings = response.data.listings || [];
      
      if (listings.length === 0) {
        console.log('No active listings. Create one with: dacn-provider list');
        return;
      }
      
      console.log(`\n📋 Your Listings (${listings.length}):\n`);
      
      listings.forEach(l => {
        console.log(`   ID: ${l.listing_id}`);
        console.log(`   DIEM: ${l.diem_available} @ ${l.price_per_diem} USDC`);
        console.log(`   Status: ${l.status}`);
        console.log(`   Expires: ${l.expires_at}`);
        console.log('');
      });
    } catch (err) {
      console.error('❌ Failed to fetch listings:', err.message);
    }
  });

program
  .command('orders')
  .alias('escrows')
  .description('View active orders/escrows')
  .action(async () => {
    const config = await loadConfig();
    if (!config) {
      console.error('❌ Not logged in');
      process.exit(1);
    }
    
    try {
      const client = getApiClient(config);
      const response = await client.get('/provider/escrows');
      
      const escrows = response.data.escrows || [];
      
      if (escrows.length === 0) {
        console.log('No active escrows.');
        return;
      }
      
      console.log(`\n📦 Active Escrows (${escrows.length}):\n`);
      
      escrows.forEach(e => {
        console.log(`   ID: ${e.escrow_id}`);
        console.log(`   DIEM: ${e.diem_limit}, Amount: ${e.amount} USDC`);
        console.log(`   Status: ${e.status}`);
        console.log(`   Consumer: ${e.consumer.slice(0, 10)}...`);
        console.log('');
      });
      
      const needKey = escrows.filter(e => e.status === 'funded');
      if (needKey.length > 0) {
        console.log(`⚠️  ${needKey.length} escrows need API keys delivered`);
        console.log('   Run: dacn-provider deliver <escrow_id>');
      }
    } catch (err) {
      console.error('❌ Failed to fetch escrows:', err.message);
    }
  });

program
  .command('deliver <escrowId>')
  .description('Create and deliver API key for an escrow')
  .action(async (escrowId) => {
    if (!escrowId || escrowId.length < 10) {
      console.error('❌ Invalid escrow ID');
      process.exit(1);
    }
    
    const config = await loadConfig();
    if (!config) {
      console.error('❌ Not logged in');
      process.exit(1);
    }
    
    console.log(`🔑 Delivering API key for escrow: ${escrowId}\n`);
    
    // Get escrow details
    let escrow;
    try {
      const client = getApiClient(config);
      const response = await client.get(`/escrows/${escrowId}`);
      escrow = response.data;
      
      if (escrow.status !== 'funded') {
        console.error(`❌ Escrow status is ${escrow.status}, expected 'funded'`);
        process.exit(1);
      }
    } catch (err) {
      console.error('❌ Failed to fetch escrow:', err.message);
      process.exit(1);
    }
    
    const diemAmount = escrow.diem_limit;
    console.log(`Creating Venice API key with ${diemAmount} DIEM limit...`);
    
    // Create limited Venice API key
    let veniceKey;
    try {
      const response = await axios.post('https://api.venice.ai/api/v1/api_keys', {
        apiKeyType: 'INFERENCE',
        description: `DACN escrow: ${escrowId}`,
        consumptionLimit: {
          diem: diemAmount,
          usd: 0,
          vcu: 0
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }, {
        headers: { 
          'Authorization': `Bearer ${config.veniceApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });
      
      veniceKey = response.data.data.apiKey;
      console.log('✅ Venice API key created');
      console.log(`   Key preview: ${veniceKey.slice(0, 15)}...${veniceKey.slice(-3)}`);
    } catch (err) {
      console.error('❌ Failed to create Venice key:', err.response?.data || err.message);
      process.exit(1);
    }
    
    // Deliver to platform
    try {
      const client = getApiClient(config);
      const keyHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(veniceKey));
      
      await client.post(`/escrows/${escrowId}/deliver`, {
        api_key: veniceKey,
        api_key_hash: keyHash
      });
      
      console.log('\n✅ Key delivered to consumer!');
      console.log('   You will be paid when they confirm usage.');
    } catch (err) {
      console.error('❌ Failed to deliver key:', err.message);
      console.log('\n⚠️  IMPORTANT: Revoke the Venice key manually if this fails!');
      process.exit(1);
    }
  });

program
  .command('withdraw')
  .description('Withdraw accumulated USDC earnings')
  .action(async () => {
    const config = await loadConfig();
    if (!config) {
      console.error('❌ Not logged in');
      process.exit(1);
    }
    
    if (!config.escrowContract) {
      console.error('❌ No escrow contract configured. Run login again with contract address.');
      process.exit(1);
    }
    
    console.log('💰 Checking withdrawable balance...\n');
    
    try {
      // Connect to provider
      const provider = new ethers.providers.JsonRpcProvider('https://sepolia.base.org');
      const wallet = new ethers.Wallet(config.walletPrivateKey, provider);
      
      // Connect to escrow contract
      const escrow = new ethers.Contract(config.escrowContract, ESCROW_ABI, wallet);
      
      // Check balance
      const balance = await escrow.providerBalances(wallet.address);
      const balanceFormatted = ethers.utils.formatUnits(balance, 6);
      
      console.log(`Provider address: ${wallet.address}`);
      console.log(`Withdrawable balance: ${balanceFormatted} USDC`);
      
      if (balance.isZero()) {
        console.log('\nNo balance to withdraw.');
        return;
      }
      
      // Check if contract is paused
      const isPaused = await escrow.paused();
      if (isPaused) {
        console.error('\n❌ Contract is currently paused. Cannot withdraw.');
        process.exit(1);
      }
      
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Withdraw ${balanceFormatted} USDC to ${wallet.address}?`,
        default: true
      }]);
      
      if (!confirm) return;
      
      // Submit withdrawal
      console.log('\nSubmitting withdrawal transaction...');
      const tx = await escrow.withdrawProviderBalance();
      console.log(`   TX submitted: ${tx.hash}`);
      console.log(`   View on BaseScan: https://sepolia.basescan.org/tx/${tx.hash}`);
      
      console.log('   Waiting for confirmation...');
      const receipt = await tx.wait();
      console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
      
      console.log(`\n💵 Successfully withdrew ${balanceFormatted} USDC!`);
      
    } catch (err) {
      console.error('\n❌ Withdrawal failed:', err.message);
      if (err.reason) {
        console.error('   Reason:', err.reason);
      }
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show provider status and stats')
  .action(async () => {
    const config = await loadConfig();
    if (!config) {
      console.error('❌ Not logged in');
      process.exit(1);
    }
    
    console.log('\n📊 DACN Provider Status\n');
    console.log(`Address: ${config.walletAddress}`);
    console.log(`Escrow Contract: ${config.escrowContract || 'Not set'}`);
    
    try {
      // Get Venice stats
      const veniceResponse = await axios.get('https://api.venice.ai/api/v1/api_keys/rate_limits', {
        headers: { 'Authorization': `Bearer ${config.veniceApiKey}` },
        timeout: 10000
      });
      const diemBalance = veniceResponse.data.data?.diemBalance || 0;
      console.log(`\nDIEM Balance: ${diemBalance}`);
      
      // Check on-chain balance if contract is set
      if (config.escrowContract) {
        const provider = new ethers.providers.JsonRpcProvider('https://sepolia.base.org');
        const escrow = new ethers.Contract(config.escrowContract, ESCROW_ABI, provider);
        const balance = await escrow.providerBalances(config.walletAddress);
        console.log(`USDC Earnings: ${ethers.utils.formatUnits(balance, 6)}`);
        
        const isPaused = await escrow.paused();
        if (isPaused) {
          console.log('\n⚠️  Contract is PAUSED');
        }
      }
      
      // Get platform stats
      const client = getApiClient(config);
      const stats = await client.get('/provider/stats');
      
      console.log(`\nTotal Listings: ${stats.data.total_listings || 0}`);
      console.log(`Active Escrows: ${stats.data.active_escrows || 0}`);
      console.log(`Total Revenue: ${stats.data.total_revenue || 0} USDC`);
    } catch (err) {
      console.log('\nCould not fetch full stats:', err.message);
    }
  });

program
  .command('logout')
  .description('Remove saved credentials')
  .action(async () => {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Remove all saved credentials?',
      default: false
    }]);
    
    if (confirm) {
      try {
        await fs.unlink(CONFIG_FILE);
        console.log('✅ Credentials removed');
      } catch {
        console.log('No credentials found');
      }
    }
  });

program.parse();
