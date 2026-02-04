import request from 'supertest';
import express from 'express';
import creditRoutes from '../../src/routes/credits';
import providerRoutes from '../../src/routes/providers';
import { testProvider } from '../fixtures/providers';

// Mock external services
const mockCreateEscrow = jest.fn().mockResolvedValue('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
const mockFundEscrow = jest.fn().mockResolvedValue({ hash: '0xfundtx123' });
const mockDeliverKey = jest.fn().mockResolvedValue({ hash: '0xdelivertx123' });
const mockReportUsage = jest.fn().mockResolvedValue({ hash: '0xusagetx123' });
const mockGetEscrow = jest.fn().mockResolvedValue({
  provider: '0xProvider12345678901234567890123456789012',
  consumer: '0xConsumer1234567890123456789012345678901234',
  amount: BigInt(4750000),
  diemLimit: BigInt(5000),
  status: 2, // Active
  apiKeyHash: '0xkeyhash123',
  reportedUsage: BigInt(0),
  providerConfirmed: false,
  consumerConfirmed: false
});

jest.mock('../../src/services/blockchain', () => ({
  blockchainService: {
    createEscrow: (...args: any[]) => mockCreateEscrow(...args),
    fundEscrow: (...args: any[]) => mockFundEscrow(...args),
    deliverKey: (...args: any[]) => mockDeliverKey(...args),
    reportUsage: (...args: any[]) => mockReportUsage(...args),
    getEscrow: (...args: any[]) => mockGetEscrow(...args),
    getPlatformFeeBps: jest.fn().mockResolvedValue(100),
  },
  EscrowStatus: {
    Pending: 0,
    Funded: 1,
    Active: 2,
    Completed: 3,
    Disputed: 4,
    Refunded: 5
  }
}));

jest.mock('../../src/services/venice', () => ({
  veniceService: {
    createLimitedKey: jest.fn().mockResolvedValue({
      id: 'key_123',
      key: 'venice_sk_test_123456'
    }),
  }
}));

jest.mock('../../src/routes/webhooks', () => ({
  notifyWebhook: jest.fn()
}));

describe('Credits API Integration (Escrow Flow)', () => {
  let app: express.Application;
  let providerId: string;
  let escrowId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/providers', providerRoutes);
    app.use('/api/credits', creditRoutes);

    // Create a test provider
    const providerRes = await request(app)
      .post('/api/providers')
      .send(testProvider)
      .expect(201);
    
    providerId = providerRes.body.provider.id;
    if (!providerId) {
      throw new Error('Provider creation did not return id. Body: ' + JSON.stringify(providerRes.body));
    }
    
    jest.clearAllMocks();
  });

  describe('GET /api/credits/quote', () => {
    it('should return price quote with fees', async () => {
      const response = await request(app)
        .get(`/api/credits/quote?providerId=${providerId}&diemAmount=5000&durationDays=7`)
        .expect(200);

      expect(response.body.quote).toBeDefined();
      expect(response.body.quote.diemAmount).toBe(5000);
      expect(response.body.quote.platformFee).toBeDefined();
      expect(response.body.quote.totalCost).toBeDefined();
    });
  });

  describe('POST /api/credits/request (Step 1: Create Escrow)', () => {
    it('should create escrow request', async () => {
      const response = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 5000,
          durationDays: 7
        })
        .expect(201);

      expect(response.body.credit).toBeDefined();
      expect(response.body.credit.status).toBe('requested');
      expect(response.body.escrowId).toBeDefined();
      expect(response.body.escrowId).toBe(escrowId);
      expect(response.body.nextStep).toBe('fundEscrow');
      
      expect(mockCreateEscrow).toHaveBeenCalledWith(
        testProvider.address,
        5000,
        expect.any(BigInt),
        7 * 24 * 60 * 60
      );
    });
  });

  describe('POST /api/credits/:id/fund (Step 2: Fund Escrow)', () => {
    it('should fund escrow', async () => {
      // First create
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 5000,
          durationDays: 7
        });

      const creditId = createRes.body.credit.id;

      // Now fund
      const response = await request(app)
        .post(`/api/credits/${creditId}/fund`)
        .send({ escrowId })
        .expect(200);

      expect(response.body.credit.status).toBe('created');
      expect(response.body.txHash).toBeDefined();
      
      expect(mockFundEscrow).toHaveBeenCalledWith(escrowId);
    });

    it('should reject funding without escrowId', async () => {
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 5000,
          durationDays: 7
        });

      const creditId = createRes.body.credit.id;

      await request(app)
        .post(`/api/credits/${creditId}/fund`)
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/credits/:id/deliver (Step 3: Deliver Key)', () => {
    it('should deliver API key', async () => {
      // Create and fund first
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 5000,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      await request(app)
        .post(`/api/credits/${creditId}/fund`)
        .send({ escrowId });

      // Deliver
      const response = await request(app)
        .post(`/api/credits/${creditId}/deliver`)
        .send({ escrowId, apiKey: 'test-api-key-123' })
        .expect(200);

      expect(response.body.credit.status).toBe('key_delivered');
      expect(response.body.apiKey).toBeDefined();
      expect(response.body.txHash).toBeDefined();
      
      expect(mockDeliverKey).toHaveBeenCalled();
    });
  });

  describe('POST /api/credits/:id/confirm (Step 4: Confirm Receipt)', () => {
    it('should confirm key receipt', async () => {
      // Setup through deliver
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 5000,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      await request(app)
        .post(`/api/credits/${creditId}/fund`)
        .send({ escrowId });

      await request(app)
        .post(`/api/credits/${creditId}/deliver`)
        .send({ escrowId, apiKey: 'test-api-key-123' });

      // Confirm
      const response = await request(app)
        .post(`/api/credits/${creditId}/confirm`)
        .send({ escrowId })
        .expect(200);

      expect(response.body.credit.status).toBe('confirmed');
    });
  });

  describe('POST /api/credits/:id/usage (Step 5: Report Usage)', () => {
    it('should report usage', async () => {
      // Full setup
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 5000,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      await request(app).post(`/api/credits/${creditId}/fund`).send({ escrowId });
      await request(app).post(`/api/credits/${creditId}/deliver`).send({ escrowId, apiKey: 'key123' });
      await request(app).post(`/api/credits/${creditId}/confirm`).send({ escrowId });

      // Report usage
      const response = await request(app)
        .post(`/api/credits/${creditId}/usage`)
        .send({ escrowId, usageAmount: 3500 })
        .expect(200);

      expect(response.body.credit.actualUsage).toBe(3500);
      expect(response.body.txHash).toBeDefined();
      
      expect(mockReportUsage).toHaveBeenCalledWith(escrowId, 3500);
    });

    it('should auto-complete if both parties confirmed', async () => {
      mockGetEscrow.mockResolvedValueOnce({
        status: 3, // Completed
        providerConfirmed: true,
        consumerConfirmed: true
      });

      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 5000,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      await request(app).post(`/api/credits/${creditId}/fund`).send({ escrowId });
      await request(app).post(`/api/credits/${creditId}/deliver`).send({ escrowId, apiKey: 'key123' });
      await request(app).post(`/api/credits/${creditId}/confirm`).send({ escrowId });

      const response = await request(app)
        .post(`/api/credits/${creditId}/usage`)
        .send({ escrowId, usageAmount: 3500 });

      expect(response.body.status).toBe('completed');
    });
  });

  describe('POST /api/credits/:id/cancel', () => {
    it('should cancel before funding', async () => {
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 5000,
          durationDays: 7
        });

      const response = await request(app)
        .post(`/api/credits/${createRes.body.credit.id}/cancel`)
        .expect(200);

      expect(response.body.credit.status).toBe('cancelled');
    });

    it('should reject cancel after funding', async () => {
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 5000,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      await request(app).post(`/api/credits/${creditId}/fund`).send({ escrowId });

      const response = await request(app)
        .post(`/api/credits/${creditId}/cancel`);

      expect(response.status).toBe(400);
    });
  });
});
