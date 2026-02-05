import { ethers, Interface, Log } from 'ethers';
import { config } from '../config';
import DiemCreditEscrowABI from '../abis/DiemCreditEscrow.json';

// USDC testnet (Base Sepolia mintable token); mainnet uses different address. Override via USDC_ADDRESS.
const DEFAULT_USDC = '0x6Ac3aB54Dc5019A2e57eCcb214337FF5bbD52897';

// ERC20 ABI for USDC
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

export enum EscrowStatus {
  Pending = 0,
  Funded = 1,
  Active = 2,
  Completed = 3,
  Disputed = 4,
  Refunded = 5
}

export interface Escrow {
  provider: string;
  consumer: string;
  amount: bigint;
  diemLimit: bigint;
  startTime: bigint;
  endTime: bigint;
  status: EscrowStatus;
  apiKeyHash: string;
  reportedUsage: bigint;
  providerConfirmed: boolean;
  consumerConfirmed: boolean;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet | null = null;
  private contract: ethers.Contract | null = null;
  private contractInterface: Interface;
  private usdcContract: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);
    this.contractInterface = new Interface(DiemCreditEscrowABI as ethers.InterfaceAbi);
    const usdcAddress = config.blockchain.usdcAddress || DEFAULT_USDC;
    this.usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, this.provider);

    const addr = (config.blockchain.contractAddress || '').trim();
    if (addr && addr !== ZERO_ADDRESS) {
      this.contract = new ethers.Contract(
        addr,
        DiemCreditEscrowABI as ethers.InterfaceAbi,
        this.provider
      );
    }

    if (config.blockchain.privateKey) {
      this.wallet = new ethers.Wallet(config.blockchain.privateKey, this.provider);
      if (this.contract) {
        this.contract = this.contract.connect(this.wallet) as ethers.Contract;
      }
      this.usdcContract = this.usdcContract.connect(this.wallet) as ethers.Contract;
    }
  }

  private ensureContract(): ethers.Contract {
    if (!this.contract) {
      throw new Error('Escrow contract not configured. Set CONTRACT_ADDRESS in .env.');
    }
    return this.contract;
  }

  /**
   * Create a new escrow (consumer initiates)
   * @returns escrowId (bytes32)
   */
  async createEscrow(
    providerAddress: string,
    diemLimitCents: number,
    amountUSDC: bigint,
    durationSeconds: number = 0
  ): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not configured');
    }

    const contract = this.ensureContract();
    const tx = await contract.createEscrow(
      providerAddress,
      diemLimitCents,
      amountUSDC,
      durationSeconds
    );

    const receipt = await tx.wait();
    
    // Parse event to get escrowId - ethers v6 compatible
    const event = this.parseEvent(receipt, 'EscrowCreated');
    if (!event) {
      throw new Error('EscrowCreated event not found');
    }
    
    return event.args[0] as string; // escrowId is first arg
  }

  /**
   * Approve the escrow contract to spend USDC from the backend wallet.
   * Call this once (or when you get "transfer amount exceeds allowance").
   * @param amount Amount to approve (default: max uint256 so one approval covers all escrows)
   */
  async approveUsdcForEscrow(amount?: bigint): Promise<ethers.TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('Wallet not configured');
    }
    const contract = this.ensureContract();
    const contractAddress = contract.target as string;
    const approveAmount = amount ?? (2n ** 256n - 1n); // max uint256
    const tx = await this.usdcContract.approve(contractAddress, approveAmount);
    return await tx.wait();
  }

  /**
   * Fund an escrow with USDC (consumer)
   */
  async fundEscrow(escrowId: string): Promise<ethers.TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('Wallet not configured');
    }

    const contract = this.ensureContract();
    const contractAddress = contract.target as string;
    const escrow = await this.getEscrow(escrowId);
    const currentAllowance = await this.usdcContract.allowance(
      this.wallet.address,
      contractAddress
    );

    if (currentAllowance < escrow.amount) {
      const receipt = await this.approveUsdcForEscrow(escrow.amount);
      if (!receipt) throw new Error('USDC approval failed');
    }

    const tx = await contract.fundEscrow(escrowId);
    return await tx.wait();
  }

  /**
   * Provider delivers API key hash
   */
  async deliverKey(escrowId: string, apiKeyHash: string): Promise<ethers.TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('Wallet not configured');
    }

    const tx = await this.ensureContract().deliverKey(escrowId, apiKeyHash);
    return await tx.wait();
  }

  /**
   * Report usage (honest oracle - both parties)
   */
  async reportUsage(escrowId: string, usageCents: number): Promise<ethers.TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('Wallet not configured');
    }

    const tx = await this.ensureContract().reportUsage(escrowId, usageCents);
    return await tx.wait();
  }

  /**
   * Get escrow details
   */
  async getEscrow(escrowId: string): Promise<Escrow> {
    const result = await this.ensureContract().getEscrow(escrowId);
    
    return {
      provider: result.provider,
      consumer: result.consumer,
      amount: result.amount,
      diemLimit: result.diemLimit,
      startTime: result.startTime,
      endTime: result.endTime,
      status: result.status,
      apiKeyHash: result.apiKeyHash,
      reportedUsage: result.reportedUsage,
      providerConfirmed: result.providerConfirmed,
      consumerConfirmed: result.consumerConfirmed
    };
  }

  /**
   * Get provider withdrawable balance
   */
  async getProviderBalance(providerAddress: string): Promise<bigint> {
    return await this.ensureContract().providerBalances(providerAddress);
  }

  /**
   * Provider withdraws accumulated balance
   */
  async withdrawProviderBalance(): Promise<ethers.TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('Wallet not configured');
    }

    const tx = await this.ensureContract().withdrawProviderBalance();
    return await tx.wait();
  }

  /**
   * Calculate expected distribution for given usage
   */
  async calculateDistribution(
    totalAmount: bigint,
    diemLimit: bigint,
    usage: bigint
  ): Promise<{
    providerAmount: bigint;
    consumerRefund: bigint;
    platformFee: bigint;
    penaltyAmount: bigint;
  }> {
    const result = await this.ensureContract().calculateDistribution(totalAmount, diemLimit, usage);
    
    return {
      providerAmount: result.providerAmount,
      consumerRefund: result.consumerRefund,
      platformFee: result.platformFee,
      penaltyAmount: result.penaltyAmount
    };
  }

  /**
   * Get platform fee rate
   */
  async getPlatformFeeBps(): Promise<number> {
    const fee = await this.ensureContract().platformFeeBps();
    return Number(fee);
  }

  /**
   * Parse event from transaction receipt (ethers v6 compatible)
   */
  private parseEvent(receipt: ethers.TransactionReceipt, eventName: string): ethers.LogDescription | null {
    for (const log of receipt.logs) {
      try {
        const parsed = this.contractInterface.parseLog(log as Log);
        if (parsed && parsed.name === eventName) {
          return parsed;
        }
      } catch {
        // Log doesn't match this event
        continue;
      }
    }
    return null;
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.wallet !== null;
  }

  /**
   * Get connected wallet address
   */
  getAddress(): string | null {
    return this.wallet?.address ?? null;
  }
}

export const blockchainService = new BlockchainService();
