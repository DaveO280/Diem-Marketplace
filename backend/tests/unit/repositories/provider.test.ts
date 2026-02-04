import { ProviderRepository } from '../../../src/repositories/provider';
import { resetTestDb, getTestDb } from '../../utils/testDb';
import { testProvider, testProvider2 } from '../../fixtures/providers';

describe('ProviderRepository', () => {
  let repo: ProviderRepository;

  beforeEach(() => {
    resetTestDb();
    repo = new ProviderRepository(getTestDb());
  });

  describe('create', () => {
    it('should create a provider with valid data', () => {
      const result = repo.create(testProvider);
      
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.address).toBe(testProvider.address);
      expect(result.name).toBe(testProvider.name);
      expect(result.ratePerDiem).toBe(testProvider.ratePerDiem);
      expect(result.isActive).toBe(true);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should fail to create provider with duplicate address', () => {
      repo.create(testProvider);
      
      expect(() => repo.create(testProvider)).toThrow();
    });

    it('should create provider with isActive default', () => {
      const providerWithoutActive = {
        ...testProvider,
        address: '0xNewAddress12345678901234567890123456789012',
        isActive: undefined as any
      };
      
      const result = repo.create(providerWithoutActive);
      expect(result.isActive).toBe(true);
    });
  });

  describe('findById', () => {
    it('should find provider by ID', () => {
      const created = repo.create(testProvider);
      const found = repo.findById(created.id);
      
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.address).toBe(testProvider.address);
    });

    it('should return null for non-existent ID', () => {
      const found = repo.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findByAddress', () => {
    it('should find provider by address', () => {
      repo.create(testProvider);
      const found = repo.findByAddress(testProvider.address);
      
      expect(found).toBeDefined();
      expect(found?.address).toBe(testProvider.address);
    });

    it('should return null for non-existent address', () => {
      const found = repo.findByAddress('0xNonExistent123456789012345678901234567890');
      expect(found).toBeNull();
    });
  });

  describe('findActive', () => {
    it('should return only active providers', () => {
      repo.create(testProvider);
      repo.create(testProvider2);
      
      const active = repo.findActive();
      expect(active).toHaveLength(2);
    });

    it('should not return inactive providers', () => {
      const created = repo.create(testProvider);
      repo.create(testProvider2);
      
      // Deactivate one
      repo.update(created.id, { isActive: false });
      
      const active = repo.findActive();
      expect(active).toHaveLength(1);
    });
  });

  describe('findAll', () => {
    it('should return all providers', () => {
      repo.create(testProvider);
      repo.create(testProvider2);
      
      const all = repo.findAll();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no providers', () => {
      const all = repo.findAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update provider rate', () => {
      const created = repo.create(testProvider);
      const updated = repo.update(created.id, { ratePerDiem: 980 });
      
      expect(updated).toBeDefined();
      expect(updated?.ratePerDiem).toBe(980);
      expect(updated?.name).toBe(testProvider.name); // Unchanged
    });

    it('should update provider capacity', () => {
      const created = repo.create(testProvider);
      const updated = repo.update(created.id, { maxDiemCapacity: 200000 });
      
      expect(updated?.maxDiemCapacity).toBe(200000);
    });

    it('should return null for non-existent provider', () => {
      const result = repo.update('non-existent', { ratePerDiem: 900 });
      expect(result).toBeNull();
    });

    it('should update updatedAt timestamp', () => {
      const created = repo.create(testProvider);
      const originalUpdatedAt = created.updatedAt;
      
      // Small delay
      jest.advanceTimersByTime(1000);
      
      const updated = repo.update(created.id, { ratePerDiem: 980 });
      expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('delete', () => {
    it('should delete provider', () => {
      const created = repo.create(testProvider);
      const deleted = repo.delete(created.id);
      
      expect(deleted).toBe(true);
      expect(repo.findById(created.id)).toBeNull();
    });

    it('should return false for non-existent provider', () => {
      const deleted = repo.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });
});
