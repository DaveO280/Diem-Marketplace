export interface Provider {
  id: string;
  address: string;
  name: string;
  maxDiemCapacity: number;
  ratePerDiem: number; // In USDC wei
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Credit {
  id: string;
  creditId: number; // On-chain credit ID
  providerId: string;
  buyerAddress: string;
  totalDiemAmount: number;
  actualUsage: number | null;
  durationDays: number;
  status: CreditStatus;
  apiKey: string | null;
  apiKeyHash: string | null;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
}

export enum CreditStatus {
  REQUESTED = 'requested',
  CREATED = 'created',
  KEY_DELIVERED = 'key_delivered',
  CONFIRMED = 'confirmed',
  USAGE_REPORTED = 'usage_reported',
  COMPLETED = 'completed',
  DISPUTED = 'disputed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired'
}

export interface UsageReport {
  id: string;
  creditId: string;
  reporter: 'provider' | 'buyer';
  usageAmount: number;
  reportedAt: string;
}

export interface VeniceApiKey {
  id: string;
  key: string;
  name: string;
  spendLimit?: number;
  expiresAt?: string;
}

export interface CreateCreditRequest {
  providerId: string;
  buyerAddress: string;
  diemAmount: number;
  durationDays: number;
}

export interface CreditQuote {
  providerId: string;
  diemAmount: number;
  durationDays: number;
  totalCost: string; // In USDC (formatted)
  platformFee: string;
  ratePerDiem: string;
}

// Smart contract types
export interface OnChainCredit {
  id: number;
  provider: string;
  buyer: string;
  amount: bigint;
  startTime: number;
  duration: number;
  status: number;
  keyHash: string;
  actualUsage: bigint;
  providerConfirmed: boolean;
  buyerConfirmed: boolean;
}
