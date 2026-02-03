# DACN Smart Contracts

Smart contracts for the DIEM Agent Credit Network on Base.

## Contracts

- **DiemCreditEscrow.sol** - Main escrow contract for USDC payments

## Quick Start

### 1. Install dependencies

```bash
cd contracts
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your private key and other values
```

### 3. Get Base Sepolia ETH

Get free testnet ETH from:
- [Alchemy Faucet](https://www.alchemy.com/faucets/base-sepolia)
- [QuickNode Faucet](https://faucet.quicknode.com/base/sepolia)

### 4. Deploy to Testnet

```bash
npm run deploy:testnet
```

Save the deployed contract address!

### 5. Verify on BaseScan (optional)

```bash
npm run verify:testnet -- <CONTRACT_ADDRESS> <USDC_ADDRESS>
```

## Contract Functions

### For Consumers

```solidity
// Create escrow
function createEscrow(address _provider, uint256 _diemLimit, uint256 _amount, uint256 _duration)

// Fund with USDC
function fundEscrow(bytes32 _escrowId)

// Report usage
function reportUsage(bytes32 _escrowId, uint256 _usage)
```

### For Providers

```solidity
// Deliver API key hash
function deliverKey(bytes32 _escrowId, bytes32 _apiKeyHash)

// Confirm and release
function confirmRelease(bytes32 _escrowId, uint256 _usage)

// Withdraw earnings
function withdrawProviderBalance()
```

## Testing

```bash
# Run tests
npm test

# Run with coverage
npx hardhat coverage
```

## Mainnet Deployment

When ready for production:

```bash
npm run deploy:mainnet
```

**⚠️ WARNING: Mainnet deployment costs real money and is irreversible. Triple-check everything!**

## Contract Addresses

| Network | Address | USDC |
|---------|---------|------|
| Base Sepolia | TBD | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| Base Mainnet | TBD | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |

## Security

- Platform fee: 1% (max 5%)
- Unused penalty: 5% (max 20%)
- Owner can only: update fees within limits, resolve disputes
- No admin drain function

## License

MIT
