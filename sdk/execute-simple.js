#!/usr/bin/env node
/**
 * DACN simple consumer: create escrow on-chain, approve USDC, fund.
 * Run: PRIVATE_KEY=0x... ESCROW_CONTRACT=0x... PROVIDER_ADDRESS=0x... node execute-simple.js
 *
 * IMPORTANT: This script does NOT use a listing or the DACN backend. It only talks to the
 * contract. So the provider dashboard will NOT show this escrow and there will be no
 * "Deliver API Key" button. To get that, create the credit via the API:
 *   POST /api/credits/request with { providerId, buyerAddress, diemAmount, durationDays }
 *
 * Escrow ID must be read from the EscrowCreated event (never use tx hash as escrowId).
 */

const ethers = require('ethers');

const ESCROW_ABI = [
  'function createEscrow(address _provider, uint256 _diemLimit, uint256 _amount, uint256 _duration) external returns (bytes32)',
  'function fundEscrow(bytes32 _escrowId) external',
  'event EscrowCreated(bytes32 indexed escrowId, address indexed provider, address indexed consumer, uint256 amount, uint256 diemLimit)',
];
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

const RPC = process.env.RPC_URL || 'https://sepolia.base.org';
const USDC = process.env.USDC_ADDRESS || '0x6Ac3aB54Dc5019A2e57eCcb214337FF5bbD52897';

// Topic0 = keccak256("EscrowCreated(bytes32,address,address,uint256,uint256)")
const ESCROW_CREATED_TOPIC0 = ethers.utils.id('EscrowCreated(bytes32,address,address,uint256,uint256)');

function getEscrowIdFromReceipt(receipt, contractInterface) {
  // ethers v5: receipt.events (preferred when present)
  if (receipt.events && receipt.events.length) {
    const ev = receipt.events.find((e) => e.event === 'EscrowCreated');
    if (ev && ev.args && ev.args.length) return ev.args[0];
  }
  // ethers v6 or raw logs: receipt.logs (no .events)
  if (receipt.logs && receipt.logs.length) {
    for (const log of receipt.logs) {
      if (log.topics && log.topics[0] === ESCROW_CREATED_TOPIC0) {
        // indexed escrowId is topics[1] (bytes32)
        if (log.topics[1]) return log.topics[1];
      }
      if (contractInterface) {
        try {
          const parsed = contractInterface.parseLog(log);
          if (parsed && parsed.name === 'EscrowCreated' && parsed.args && parsed.args[0])
            return parsed.args[0];
        } catch (_) {
          continue;
        }
      }
    }
  }
  return null;
}

async function main() {
  const pk = process.env.PRIVATE_KEY;
  const escrowContractAddress = process.env.ESCROW_CONTRACT;
  const providerAddress = process.env.PROVIDER_ADDRESS;

  if (!pk || !escrowContractAddress || !providerAddress) {
    console.error('Set PRIVATE_KEY, ESCROW_CONTRACT, PROVIDER_ADDRESS');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk, provider);
  const address = await wallet.getAddress();

  const escrowContract = new ethers.Contract(escrowContractAddress, ESCROW_ABI, wallet);
  const usdcContract = new ethers.Contract(USDC, ERC20_ABI, wallet);

  const diemLimit = 100; // 1.00 USD in cents
  const amountUSDC = ethers.utils.parseUnits('0.95', 6);
  const duration = 0;

  console.log('============================================================');
  console.log('DACN CONSUMER AGENT');
  console.log('============================================================');
  console.log('Agent:', address);
  const ethBal = await provider.getBalance(address);
  console.log('ETH:', ethers.utils.formatEther(ethBal), 'ETH\n');

  // 1. Create escrow
  console.log('Creating escrow...');
  const createTx = await escrowContract.createEscrow(providerAddress, diemLimit, amountUSDC, duration);
  const createReceipt = await createTx.wait();
  console.log('Hash:', createTx.hash);
  console.log('Created in block', createReceipt.blockNumber);

  const contractInterface = new ethers.utils.Interface(ESCROW_ABI);
  const escrowId = getEscrowIdFromReceipt(createReceipt, contractInterface);
  if (!escrowId) {
    console.error('Escrow ID not found in receipt. EscrowCreated event missing or parse failed.');
    process.exit(1);
  }
  console.log('Escrow ID:', escrowId);

  // 2. Approve USDC
  console.log('\nApproving USDC...');
  const approveTx = await usdcContract.approve(escrowContractAddress, amountUSDC);
  await approveTx.wait();
  console.log('Approved');

  // 3. Fund escrow
  console.log('\nFunding escrow...');
  const fundTx = await escrowContract.fundEscrow(escrowId);
  await fundTx.wait();
  console.log('Funded');

  console.log('\nDone. Escrow ID (use for key / status):', escrowId);
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
