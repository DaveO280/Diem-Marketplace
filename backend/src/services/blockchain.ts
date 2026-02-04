import { ethers } from 'ethers';
import { config, CONTRACT_ABI, ERC20_ABI } from '../config';
import { OnChainCredit } from '../types';

class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private usdc: ethers.Contract;

  constructor() {
    if (!config.blockchain.privateKey) {
      throw new Error('Private key not configured');
    }
    if (!config.blockchain.contractAddress) {
      throw new Error('Contract address not configured');
    }

    this.provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);
    this.wallet = new ethers.Wallet(config.blockchain.privateKey, this.provider);
    this.contract = new ethers.Contract(
      config.blockchain.contractAddress,
      CONTRACT_ABI,
      this.wallet
    );
    this.usdc = new ethers.Contract(
      config.blockchain.usdcAddress,
      ERC20_ABI,
      this.wallet
    );
  }

  getAddress(): string {
    return this.wallet.address;
  }

  async getBalance(): Promise<string> {
    const balance = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(balance);
  }

  async createCredit(
    buyerAddress: string,
    amount: bigint,
    durationDays: number
  ): Promise<number> {
    // First approve USDC
    const platformFee = (amount * BigInt(config.platform.feeBasisPoints)) / BigInt(10000);
    const totalAmount = amount + platformFee;
    
    const approveTx = await this.usdc.approve(
      config.blockchain.contractAddress,
      totalAmount
    );
    await approveTx.wait();

    // Create credit on-chain
    const tx = await this.contract.createCredit(
      buyerAddress,
      amount,
      durationDays
    );
    const receipt = await tx.wait();

    // Parse event to get credit ID
    const event = receipt.logs.find(
      (log: any) => log.fragment?.name === 'CreditCreated'
    );
    
    if (!event) {
      throw new Error('CreditCreated event not found in transaction receipt');
    }

    return Number(event.args[0]);
  }

  async deliverKey(creditId: number, keyHash: string): Promise<void> {
    const tx = await this.contract.deliverKey(creditId, keyHash);
    await tx.wait();
  }

  async confirmReceipt(creditId: number): Promise<void> {
    const tx = await this.contract.confirmReceipt(creditId);
    await tx.wait();
  }

  async reportUsage(creditId: number, actualUsage: bigint): Promise<void> {
    const tx = await this.contract.reportUsage(creditId, actualUsage);
    await tx.wait();
  }

  async confirmUsage(creditId: number): Promise<void> {
    const tx = await this.contract.confirmUsage(creditId);
    await tx.wait();
  }

  async cancelCredit(creditId: number): Promise<void> {
    const tx = await this.contract.cancelCredit(creditId);
    await tx.wait();
  }

  async getCredit(creditId: number): Promise<OnChainCredit> {
    const credit = await this.contract.getCredit(creditId);
    return {
      id: Number(credit.id),
      provider: credit.provider,
      buyer: credit.buyer,
      amount: credit.amount,
      startTime: Number(credit.startTime),
      duration: Number(credit.duration),
      status: Number(credit.status),
      keyHash: credit.keyHash,
      actualUsage: credit.actualUsage,
      providerConfirmed: credit.providerConfirmed,
      buyerConfirmed: credit.buyerConfirmed,
    };
  }

  async getPlatformFee(): Promise<number> {
    const fee = await this.contract.platformFeeBasisPoints();
    return Number(fee);
  }

  // Listen for events
  async listenForEvents(
    eventName: string,
    callback: (event: any) => void
  ): Promise<void> {
    this.contract.on(eventName, callback);
  }
}

export const blockchainService = new BlockchainService();
