# Deployment Guide

Step-by-step instructions to deploy DACN contracts to Base Sepolia testnet.

## Prerequisites

- Node.js 18+ installed
- Base Sepolia ETH (get from [Alchemy](https://www.alchemy.com/faucets/base-sepolia))
- A wallet private key (create one with Metamask, Rabby, etc.)

## Step 1: Get Testnet ETH

1. Go to https://www.alchemy.com/faucets/base-sepolia
2. Connect your wallet
3. Request Sepolia ETH (0.1-0.5 ETH should be plenty)
4. Wait for it to arrive (usually instant)

## Step 2: Prepare Files

### Option A: Git Clone (if repo is public)
```bash
git clone https://github.com/DaveO280/Diem-Marketplace.git
cd Diem-Marketplace/contracts
```

### Option B: Copy Files Manually
Copy these files from the workspace to a new directory:
- `contracts/DiemCreditEscrow.sol`
- `contracts/MockERC20.sol`
- `contracts/deploy.js`
- `contracts/hardhat.config.js`
- `contracts/package.json`
- `contracts/.env.example`
- `contracts/README.md`
- `test/DiemCreditEscrow.test.js`
- `.gitignore`

## Step 3: Install Dependencies

```bash
cd contracts
npm install
```

This installs Hardhat, OpenZeppelin contracts, and other dependencies.

## Step 4: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Your wallet private key (with 0x prefix)
# IMPORTANT: This must be the wallet that has Sepolia ETH
PRIVATE_KEY=0xabc123...your_private_key_here

# RPC endpoints (these defaults should work)
BASE_SEPOLIA_RPC=https://sepolia.base.org

# USDC on Base Sepolia (official testnet address)
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

# Optional: For contract verification
BASESCAN_API_KEY=your_basescan_api_key
```

**⚠️ Security Warning:**
- Never commit `.env` to git
- Use a dedicated wallet for testing (not your main wallet)
- Testnet private keys are less critical but still keep them private

## Step 5: Test Locally (Optional but Recommended)

```bash
# Compile contracts
npm run compile

# Run tests
npm test
```

All tests should pass. If not, check the error messages.

## Step 6: Deploy to Base Sepolia

```bash
npm run deploy:testnet
```

Expected output:
```
Deploying contracts with account: 0xYourAddress...
Account balance: 500000000000000000 (0.5 ETH)
Using USDC at: 0x036CbD53842c5426634e7929541eC2318f3dCF7e

✅ DiemCreditEscrow deployed to: 0xYourContractAddress

Save this address! You'll need it for the API.

Contract owner: 0xYourAddress
Platform fee: 100 bps (1%)
Unused penalty: 500 bps (5%)

To verify on BaseScan:
npx hardhat verify --network baseSepolia 0xYourContractAddress 0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

**🎉 Save that contract address! You'll need it.**

## Step 7: Verify on BaseScan (Optional)

Verification makes the contract source code readable on BaseScan.

1. Get a BaseScan API key: https://basescan.org/myapikey
2. Add it to `.env`: `BASESCAN_API_KEY=your_key`
3. Run:

```bash
npm run verify:testnet -- 0xYourContractAddress 0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

## Step 8: Test the Contract

### Using Hardhat Console

```bash
npx hardhat console --network baseSepolia
```

```javascript
// Load contract
const escrow = await ethers.getContractAt('DiemCreditEscrow', '0xYourContractAddress');

// Check owner
await escrow.owner();

// Check fees
await escrow.platformFeeBps();  // Should be 100 (1%)
await escrow.unusedPenaltyBps(); // Should be 500 (5%)

// Get USDC contract
const usdc = await ethers.getContractAt('IERC20', '0x036CbD53842c5426634e7929541eC2318f3dCF7e');

// Check your USDC balance (should be 0 initially)
const [signer] = await ethers.getSigners();
await usdc.balanceOf(signer.address);
```

### Getting Test USDC

You'll need test USDC to test escrows. Options:

1. **Faucet**: Some faucets give test USDC
2. **Swap**: Use a testnet DEX to swap Sepolia ETH for USDC
3. **Mint**: If you can find a testnet faucet that mints USDC

Or just test the contract functions without actual USDC for now.

## Step 9: Update Project Config

Once deployed, update these files with the contract address:

1. **`sdk/consumer.js`** - Update `ESCROW_CONTRACT_ADDRESS`
2. **Backend API config** - Add contract address and ABI
3. **`memory/diem-marketplace.md`** - Record deployed address

## Troubleshooting

### "Insufficient funds"
- You need more Sepolia ETH
- Get more from the faucet

### "Nonce too high"
- Reset your wallet's nonce
- Or wait a bit and try again

### "Contract verification failed"
- Make sure the constructor arguments match
- Try again in a few minutes (BaseScan can be slow)

### Tests failing
- Make sure you ran `npm install`
- Check Node.js version (need 18+)

## Next Steps After Deployment

1. **Build backend API** - Server that manages listings/escrows
2. **Test end-to-end** - Create real escrows, test key delivery
3. **Security audit** - Before mainnet
4. **Mainnet deployment** - When ready for production

## Contract Addresses

Record your deployed addresses here:

| Network | Contract Address | Deployed At |
|---------|-----------------|-------------|
| Base Sepolia | `0x...` | 2026-02-03 |
| Base Mainnet | `0x...` | TBD |

## Support

If you get stuck:
1. Check Hardhat docs: https://hardhat.org/docs
2. Base docs: https://docs.base.org
3. Ask in the OpenClaw Discord
