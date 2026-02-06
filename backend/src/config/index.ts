import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    env: process.env.NODE_ENV || 'development',
  },
  database: {
    path: process.env.DATABASE_PATH || './data/decan.db',
    encryptionKey: process.env.DB_ENCRYPTION_KEY || '',
  },
  blockchain: {
    rpcUrl: (process.env.RPC_URL || 'https://sepolia.base.org').trim(),
    contractAddress: (process.env.CONTRACT_ADDRESS || '').trim(),
    privateKey: (process.env.PRIVATE_KEY || '').trim(),
    usdcAddress: (process.env.USDC_ADDRESS || '0x6Ac3aB54Dc5019A2e57eCcb214337FF5bbD52897').trim(),
  },
  venice: {
    apiKey: process.env.VENICE_API_KEY || '',
    baseUrl: process.env.VENICE_BASE_URL || 'https://api.venice.ai',
  },
  webhook: {
    adminSecret: (process.env.WEBHOOK_ADMIN_SECRET || '').trim(),
  },
  platform: {
    feeBasisPoints: parseInt(process.env.PLATFORM_FEE_BASIS_POINTS || '100'), // 1%
  },
};

export const CONTRACT_ABI = [
  "function createCredit(address buyer, uint256 amount, uint256 durationDays) external returns (uint256)",
  "function deliverKey(uint256 creditId, bytes32 keyHash) external",
  "function confirmReceipt(uint256 creditId) external",
  "function reportUsage(uint256 creditId, uint256 actualUsage) external",
  "function confirmUsage(uint256 creditId) external",
  "function cancelCredit(uint256 creditId) external",
  "function getCredit(uint256 creditId) external view returns (tuple(uint256 id, address provider, address buyer, uint256 amount, uint256 startTime, uint256 duration, uint8 status, bytes32 keyHash, uint256 actualUsage, bool providerConfirmed, bool buyerConfirmed))",
  "function platformFeeBasisPoints() external view returns (uint256)",
  "event CreditCreated(uint256 indexed creditId, address indexed provider, address indexed buyer, uint256 amount)",
  "event KeyDelivered(uint256 indexed creditId, bytes32 keyHash)",
  "event UsageReported(uint256 indexed creditId, address indexed reporter, uint256 usage)",
  "event CreditCompleted(uint256 indexed creditId, uint256 usage, uint256 refund)"
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];
