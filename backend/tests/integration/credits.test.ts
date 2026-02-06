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
  amount: BigInt(95000),
  diemLimit: BigInt(10),
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
    it('should return price quote with fees and escrowParams', async () => {
      const response = await request(app)
        .get(`/api/credits/quote?providerId=${providerId}&diemAmount=0.1&durationDays=7`)
        .expect(200);

      expect(response.body.quote).toBeDefined();
      expect(response.body.quote.diemAmount).toBe(0.1);
      expect(response.body.quote.platformFee).toBeDefined();
      expect(response.body.quote.totalCost).toBeDefined();
      expect(response.body.quote.escrowParams).toBeDefined();
      expect(response.body.quote.escrowParams.providerAddress).toBeDefined();
      expect(response.body.quote.escrowParams.diemLimitCents).toBe(10);
      expect(response.body.quote.escrowParams.durationSeconds).toBe(7 * 24 * 60 * 60);
    });
  });

  describe('POST /api/credits/register', () => {
    it('should register an escrow created and funded by buyer on-chain', async () => {
      const buyerAddress = '0xB2e2123456789012345678901234567890123456';
      const regEscrowId = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      mockGetEscrow.mockResolvedValueOnce({
        provider: testProvider.address,
        consumer: buyerAddress,
        amount: BigInt(95000),
        diemLimit: BigInt(10),
        status: 1,
        apiKeyHash: '0x00',
        reportedUsage: BigInt(0),
        providerConfirmed: false,
        consumerConfirmed: false
      });

      const response = await request(app)
        .post('/api/credits/register')
        .send({
          escrowId: regEscrowId,
          providerId,
          buyerAddress,
          totalDiemAmount: 5000,
          durationDays: 7
        })
        .expect(201);

      expect(response.body.credit).toBeDefined();
      expect(response.body.credit.status).toBe('created');
      expect(response.body.credit.escrowId).toBe(regEscrowId);
      expect(response.body.credit.buyerAddress).toBe(buyerAddress);
      expect(response.body.nextStep).toContain('deliver');
    });

    it('should return existing credit when escrow already registered', async () => {
      const buyerAddress = '0xC3e3123456789012345678901234567890123456';
      const regEscrowId = '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba';
      const escrowPayload = {
        provider: testProvider.address,
        consumer: buyerAddress,
        amount: BigInt(95000),
        diemLimit: BigInt(10),
        status: 1,
        apiKeyHash: '0x00',
        reportedUsage: BigInt(0),
        providerConfirmed: false,
        consumerConfirmed: false
      };
      mockGetEscrow.mockResolvedValueOnce(escrowPayload).mockResolvedValueOnce(escrowPayload);

      const first = await request(app)
        .post('/api/credits/register')
        .send({
          escrowId: regEscrowId,
          providerId,
          buyerAddress,
          totalDiemAmount: 0.1,
          durationDays: 7
        })
        .expect(201);

      const second = await request(app)
        .post('/api/credits/register')
        .send({
          escrowId: regEscrowId,
          providerId,
          buyerAddress,
          totalDiemAmount: 0.1,
          durationDays: 7
        })
        .expect(200);

      expect(second.body.credit.id).toBe(first.body.credit.id);
      expect(second.body.message).toContain('already registered');
    });
  });

  describe('POST /api/credits/request (Step 1: Create Escrow)', () => {
    it('should create escrow and auto-fund', async () => {
      const response = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 0.1,
          durationDays: 7
        })
        .expect(201);

      expect(response.body.credit).toBeDefined();
      expect(response.body.credit.status).toBe('created');
      expect(response.body.escrowId).toBeDefined();
      expect(response.body.escrowId).toBe(escrowId);
      expect(response.body.nextStep).toContain('deliver');
      expect(mockCreateEscrow).toHaveBeenCalledWith(
        testProvider.address,
        10,
        expect.any(BigInt),
        7 * 24 * 60 * 60
      );
      expect(mockFundEscrow).toHaveBeenCalledWith(escrowId);
    });
  });

  describe('POST /api/credits/:id/fund (Step 2: Fund Escrow)', () => {
    it('should return 400 when credit already auto-funded', async () => {
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 0.1,
          durationDays: 7
        });

      const creditId = createRes.body.credit.id;

      await request(app)
        .post(`/api/credits/${creditId}/fund`)
        .send({ escrowId })
        .expect(400);
    });

    it('should reject funding without escrowId', async () => {
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 0.1,
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
    it('should deliver API key and allow mark-delivered', async () => {
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 0.1,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      const response = await request(app)
        .post(`/api/credits/${creditId}/deliver`)
        .send({ escrowId })
        .expect(200);

      expect(response.body.apiKey).toBeDefined();
      expect(response.body.keyHash).toBeDefined();

      await request(app).post(`/api/credits/${creditId}/mark-delivered`).expect(200);
    });
  });

  describe('POST /api/credits/:id/confirm (Step 4: Confirm Receipt)', () => {
    it('should confirm key receipt', async () => {
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 0.1,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      await request(app).post(`/api/credits/${creditId}/deliver`).send({ escrowId });
      await request(app).post(`/api/credits/${creditId}/mark-delivered`);

      const response = await request(app)
        .post(`/api/credits/${creditId}/confirm`)
        .send({ escrowId })
        .expect(200);

      expect(response.body.credit.status).toBe('confirmed');
    });
  });

  describe('POST /api/credits/:id/usage (Step 5: Report Usage)', () => {
    it('should report usage', async () => {
      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 0.1,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      await request(app).post(`/api/credits/${creditId}/deliver`).send({ escrowId });
      await request(app).post(`/api/credits/${creditId}/mark-delivered`);
      await request(app).post(`/api/credits/${creditId}/confirm`).send({ escrowId });

      const response = await request(app)
        .post(`/api/credits/${creditId}/usage`)
        .send({ escrowId, usageAmount: 10 })
        .expect(200);

      expect(response.body.credit.actualUsage).toBe(10);
      expect(response.body.txHash).toBeDefined();
      expect(mockReportUsage).toHaveBeenCalledWith(escrowId, 10);
    });

    it('should auto-complete if both parties confirmed', async () => {
      mockGetEscrow.mockResolvedValueOnce({
        provider: '0xProvider12345678901234567890123456789012',
        consumer: '0xConsumer1234567890123456789012345678901234',
        amount: BigInt(4750000),
        diemLimit: BigInt(5000),
        status: 3,
        apiKeyHash: '0xkeyhash123',
        reportedUsage: BigInt(3500),
        providerConfirmed: true,
        consumerConfirmed: true
      });

      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 0.1,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      await request(app).post(`/api/credits/${creditId}/deliver`).send({ escrowId });
      await request(app).post(`/api/credits/${creditId}/mark-delivered`);
      await request(app).post(`/api/credits/${creditId}/confirm`).send({ escrowId });

      const response = await request(app)
        .post(`/api/credits/${creditId}/usage`)
        .send({ escrowId, usageAmount: 10 });

      expect(response.body.status).toBe('completed');
    });
  });

  describe('POST /api/credits/:id/cancel', () => {
    it('should cancel before funding', async () => {
      mockFundEscrow.mockRejectedValueOnce(new Error('fund failed'));

      const createRes = await request(app)
        .post('/api/credits/request')
        .send({
          providerId,
          buyerAddress: '0xB2e2123456789012345678901234567890123456',
          diemAmount: 0.1,
          durationDays: 7
        });

      expect(createRes.body.credit.status).toBe('requested');
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
          diemAmount: 0.1,
          durationDays: 7
        });
      const creditId = createRes.body.credit.id;

      const response = await request(app)
        .post(`/api/credits/${creditId}/cancel`);

      expect(response.status).toBe(400);
    });
  });
});
