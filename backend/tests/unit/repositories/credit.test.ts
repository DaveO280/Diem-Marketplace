import { CreditRepository } from '../../../src/repositories/credit';
import { ProviderRepository } from '../../../src/repositories/provider';
import { testProvider } from '../../fixtures/providers';
import { CreditStatus } from '../../../src/types';

describe('CreditRepository', () => {
  let creditRepo: CreditRepository;
  let providerRepo: ProviderRepository;
  let providerId: string;

  beforeEach(() => {
    creditRepo = new CreditRepository();
    providerRepo = new ProviderRepository();
    const provider = providerRepo.create(testProvider);
    providerId = provider.id;
  });

  const createTestCredit = (overrides = {}) => ({
    creditId: 123,
    providerId,
    buyerAddress: '0xBuyer12345678901234567890123456789012345678',
    totalDiemAmount: 5000,
    actualUsage: null,
    durationDays: 7,
    status: CreditStatus.CREATED,
    apiKey: null,
    apiKeyHash: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides
  });

  describe('create', () => {
    it('should create a credit request', () => {
      const credit = creditRepo.create(createTestCredit());
      
      expect(credit).toBeDefined();
      expect(credit.id).toBeDefined();
      expect(credit.providerId).toBe(providerId);
      expect(credit.status).toBe(CreditStatus.CREATED);
      expect(credit.createdAt).toBeDefined();
      expect(credit.confirmedAt).toBeNull();
    });

    it('should handle credit without creditId (before blockchain)', () => {
      const credit = creditRepo.create(createTestCredit({ creditId: undefined as any }));
      expect(credit.creditId).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should find credit by ID', () => {
      const created = creditRepo.create(createTestCredit());
      const found = creditRepo.findById(created.id);
      
      expect(found?.id).toBe(created.id);
      expect(found?.buyerAddress).toBe('0xBuyer12345678901234567890123456789012345678');
    });

    it('should return null for non-existent ID', () => {
      const found = creditRepo.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findByCreditId', () => {
    it('should find credit by on-chain creditId', () => {
      creditRepo.create(createTestCredit({ creditId: 456 }));
      const found = creditRepo.findByCreditId(456);
      
      expect(found).toBeDefined();
      expect(found?.creditId).toBe(456);
    });
  });

  describe('findByStatus', () => {
    it('should filter by status', () => {
      creditRepo.create(createTestCredit({ creditId: 101, status: CreditStatus.CREATED }));
      creditRepo.create(createTestCredit({ 
        creditId: 102,
        status: CreditStatus.CONFIRMED,
        buyerAddress: '0xAnotherBuyer56789012345678901234567890123456'
      }));
      
      const created = creditRepo.findByStatus(CreditStatus.CREATED);
      expect(created).toHaveLength(1);
      expect(created[0].status).toBe(CreditStatus.CREATED);
    });
  });

  describe('findByProvider', () => {
    it('should find all credits for provider', () => {
      // Create second provider
      const provider2 = providerRepo.create({
        ...testProvider,
        address: '0xAnotherProvider1234567890123456789012345678'
      });
      
      creditRepo.create(createTestCredit({ creditId: 201 }));
      creditRepo.create(createTestCredit({ 
        creditId: 202,
        providerId: provider2.id,
        buyerAddress: '0xDifferentBuyer7890123456789012345678901234567'
      }));
      
      const provider1Credits = creditRepo.findByProvider(providerId);
      expect(provider1Credits).toHaveLength(1);
    });
  });

  describe('findByBuyer', () => {
    it('should find all credits for buyer', () => {
      const buyer1 = '0xBuyerOne234567890123456789012345678901234567';
      const buyer2 = '0xBuyerTwo345678901234567890123456789012345678';
      
      creditRepo.create(createTestCredit({ creditId: 301, buyerAddress: buyer1 }));
      creditRepo.create(createTestCredit({ creditId: 302, buyerAddress: buyer1 }));
      creditRepo.create(createTestCredit({ creditId: 303, buyerAddress: buyer2 }));
      
      const buyer1Credits = creditRepo.findByBuyer(buyer1);
      expect(buyer1Credits).toHaveLength(2);
    });
  });

  describe('updateStatus', () => {
    it('should update status', () => {
      const created = creditRepo.create(createTestCredit());
      
      const updated = creditRepo.updateStatus(created.id, CreditStatus.KEY_DELIVERED);
      expect(updated?.status).toBe(CreditStatus.KEY_DELIVERED);
    });

    it('should update status with actualUsage', () => {
      const created = creditRepo.create(createTestCredit());
      
      const updated = creditRepo.updateStatus(created.id, CreditStatus.USAGE_REPORTED, {
        actualUsage: 3500
      });
      
      expect(updated?.status).toBe(CreditStatus.USAGE_REPORTED);
      expect(updated?.actualUsage).toBe(3500);
    });

    it('should update with apiKeyHash and apiKey', () => {
      const created = creditRepo.create(createTestCredit());
      
      const updated = creditRepo.updateStatus(created.id, CreditStatus.KEY_DELIVERED, {
        apiKey: 'secret_key_123',
        apiKeyHash: '0xhash123'
      });
      
      expect(updated?.apiKey).toBe('secret_key_123');
      expect(updated?.apiKeyHash).toBe('0xhash123');
    });

    it('should return null for non-existent credit', () => {
      const result = creditRepo.updateStatus('non-existent', CreditStatus.COMPLETED);
      expect(result).toBeNull();
    });
  });

  describe('updateCreditId', () => {
    it('should update on-chain creditId', () => {
      const created = creditRepo.create(createTestCredit({ creditId: undefined as any }));
      
      const updated = creditRepo.updateCreditId(created.id, 999);
      expect(updated?.creditId).toBe(999);
    });
  });
});
