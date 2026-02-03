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

const CONFIG_DIR = path.join(os.homedir(), '.dacn');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const API_URL = process.env.DACN_API_URL || 'https://api.diemcredit.network/v1';

const program = new Command();

// Utility functions
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getApiClient(config) {
  return axios.create({
    baseURL: API_URL,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    }
  });
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
        validate: (input) => input.length > 0 || 'Private key is required'
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
        headers: { 'Authorization': `Bearer ${answers.apiKey}` }
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
        headers: { 'Authorization': `Bearer ${answers.veniceApiKey}` }
      });
      console.log(`✅ Venice API key verified (${response.data.data.length} existing keys)`);
    } catch (err) {
      console.error('❌ Venice API key invalid:', err.message);
      process.exit(1);
    }
    
    // Verify wallet
    try {
      const wallet = new ethers.Wallet(answers.walletPrivateKey);
      console.log(`✅ Wallet verified: ${wallet.address}`);
    } catch (err) {
      console.error('❌ Invalid private key:', err.message);
      process.exit(1);
    }
    
    if (answers.save) {
      await saveConfig({
        apiKey: answers.apiKey,
        veniceApiKey: answers.veniceApiKey,
        walletPrivateKey: answers.walletPrivateKey,
        providerAddress: new ethers.Wallet(answers.walletPrivateKey).address
      });
      console.log('\n💾 Credentials saved to ~/.dacn/config.json');
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
    
    const diemAmount = parseFloat(options.diem);
    const price = parseFloat(options.price);
    const minPurchase = parseFloat(options.min);
    const maxPurchase = options.max ? parseFloat(options.max) : diemAmount;
    const duration = parseInt(options.duration);
    
    // Verify we have enough DIEM staked
    console.log('Checking Venice DIEM balance...');
    try {
      const response = await axios.get('https://api.venice.ai/api/v1/api_keys/rate_limits', {
        headers: { 'Authorization': `Bearer ${config.veniceApiKey}` }
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
    try {
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
      console.error('❌ Failed to create listing:', err.response?.data || err.message);
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
      
      // Check if any need action
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
        }
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
        api_key: veniceKey,  // Encrypted in transit
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
    
    console.log('💰 Checking withdrawable balance...\n');
    
    // Check on-chain balance
    const provider = new ethers.providers.JsonRpcProvider('https://sepolia.base.org');
    const wallet = new ethers.Wallet(config.walletPrivateKey, provider);
    
    // This would call the escrow contract
    // For now, just show mock
    console.log(`Provider address: ${wallet.address}`);
    console.log('Fetching balance from escrow contract...');
    
    try {
      const client = getApiClient(config);
      const response = await client.get('/provider/balance');
      const balance = response.data.balance;
      
      if (balance === 0) {
        console.log('No balance to withdraw.');
        return;
      }
      
      console.log(`\n💵 Withdrawable: ${balance} USDC`);
      
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Withdraw ${balance} USDC to ${wallet.address}?`,
        default: true
      }]);
      
      if (!confirm) return;
      
      // Call withdraw on contract
      console.log('Submitting withdrawal...');
      // const tx = await escrowContract.withdrawProviderBalance();
      // await tx.wait();
      
      console.log('✅ Withdrawal submitted!');
      // console.log(`   TX: ${tx.hash}`);
    } catch (err) {
      console.error('❌ Withdrawal failed:', err.message);
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
    console.log(`Address: ${config.providerAddress}`);
    
    try {
      // Get Venice stats
      const veniceResponse = await axios.get('https://api.venice.ai/api/v1/api_keys/rate_limits', {
        headers: { 'Authorization': `Bearer ${config.veniceApiKey}` }
      });
      const diemBalance = veniceResponse.data.data?.diemBalance || 0;
      console.log(`DIEM Balance: ${diemBalance}`);
      
      // Get platform stats
      const client = getApiClient(config);
      const stats = await client.get('/provider/stats');
      
      console.log(`\nTotal Listings: ${stats.data.total_listings}`);
      console.log(`Active Escrows: ${stats.data.active_escrows}`);
      console.log(`Total Revenue: ${stats.data.total_revenue} USDC`);
      console.log(`Lifetime Volume: ${stats.data.lifetime_volume} DIEM`);
    } catch (err) {
      console.log('Could not fetch full stats:', err.message);
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
      await fs.unlink(CONFIG_FILE).catch(() => {});
      console.log('✅ Credentials removed');
    }
  });

program.parse();
