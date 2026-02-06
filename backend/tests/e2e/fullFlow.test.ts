/**
 * E2E Test: Full DACN Escrow Flow
 * 
 * Flow:
 * 1. Provider registers
 * 2. Consumer requests credit (creates escrow)
 * 3. Consumer funds escrow  
 * 4. Provider delivers API key hash
 * 5. Consumer confirms receipt
 * 6. Consumer reports usage
 * 7. Provider confirms usage (auto-completes)
 */

import request from 'supertest';
import express from 'express';
import providerRoutes from '../../src/routes/providers';
import creditRoutes from '../../src/routes/credits';

const mockEscrowId = '0xe2e1234567890abcdef1234567890abcdef1234567890abcdef1234567890abc';
let mockEscrowStatus = 1; // Funded

jest.mock('../../src/services/blockchain', () => ({
  blockchainService: {
    createEscrow: jest.fn().mockImplementation(() => Promise.resolve(mockEscrowId)),
    fundEscrow: jest.fn().mockImplementation(() => Promise.resolve({ hash: '0xe2efundtx' })),
    deliverKey: jest.fn().mockImplementation(() => Promise.resolve({ hash: '0xe2edelivertx' })),
    reportUsage: jest.fn().mockImplementation(() => Promise.resolve({ hash: '0xe2eusagetx' })),
    getEscrow: jest.fn().mockImplementation(() => Promise.resolve({
      provider: '0xProviderE2E12345678901234567890123456789012',
      consumer: '0xBuyerE2E1234567890123456789012345678901234',
      amount: BigInt(4750000),
      diemLimit: BigInt(10),
      status: mockEscrowStatus,
      apiKeyHash: '0xe2ekeyhash',
      reportedUsage: BigInt(3500),
      providerConfirmed: mockEscrowStatus === 3,
      consumerConfirmed: true
    })),
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
      id: 'venice_e2e_key',
      key: 'venice_sk_e2e_abc123xyz'
    }),
  }
}));

jest.mock('../../src/routes/webhooks', () => ({
  notifyWebhook: jest.fn()
}));

describe('E2E: Full Escrow Flow', () => {
  let app: express.Application;
  let providerId: string;
  let creditId: string;

  const provider = {
    address: '0xE2E1234567890123456789012345678901234567',
    name: 'E2E Test Provider',
    maxDiemCapacity: 100000,
    ratePerDiem: 950,
    isActive: true,
  };

  const buyer = {
    address: '0xB2eE2E1234567890123456789012345678901234'
  };

  beforeEach(async () => {
    mockEscrowStatus = 1; // Reset to funded
    app = express();
    app.use(express.json());
    app.use('/api/providers', providerRoutes);
    app.use('/api/credits', creditRoutes);
  });

  it('Complete escrow lifecycle', async () => {
    // Step 1: Provider registers
    console.log('Step 1: Provider registration');
    
    const providerRes = await request(app)
      .post('/api/providers')
      .send(provider)
      .expect(201);

    expect(providerRes.body.provider).toBeDefined();
    providerId = providerRes.body.provider.id;
    console.log(`  ✓ Provider registered: ${providerId}`);

    // Step 2: Get quote
    console.log('Step 2: Getting price quote');

    const quoteRes = await request(app)
      .get(`/api/credits/quote?providerId=${providerId}&diemAmount=0.1&durationDays=7`)
      .expect(200);

    expect(quoteRes.body.quote).toBeDefined();
    console.log(`  ✓ Quote: ${quoteRes.body.quote.totalCost} USDC wei`);

    // Step 3: Create escrow
    console.log('Step 3: Creating escrow');

    const requestRes = await request(app)
      .post('/api/credits/request')
      .send({
        providerId,
        buyerAddress: buyer.address,
        diemAmount: 0.1,
        durationDays: 7
      })
      .expect(201);

    expect(requestRes.body.credit.status).toBe('created');
    expect(requestRes.body.escrowId).toBe(mockEscrowId);
    expect(requestRes.body.nextStep).toContain('deliver');
    creditId = requestRes.body.credit.id;
    console.log(`  ✓ Escrow created and funded: ${mockEscrowId}`);

    // Step 4: Provider delivers key (backend creates key, then mark-delivered)
    console.log('Step 4: Delivering API key');

    const deliverRes = await request(app)
      .post(`/api/credits/${creditId}/deliver`)
      .send({ escrowId: mockEscrowId })
      .expect(200);

    expect(deliverRes.body.apiKey).toBeDefined();
    expect(deliverRes.body.keyHash).toBeDefined();

    await request(app)
      .post(`/api/credits/${creditId}/mark-delivered`)
      .expect(200);
    console.log('  ✓ API key delivered');

    // Step 6: Consumer confirms receipt
    console.log('Step 6: Confirming receipt');

    const confirmRes = await request(app)
      .post(`/api/credits/${creditId}/confirm`)
      .send({ escrowId: mockEscrowId })
      .expect(200);

    expect(confirmRes.body.credit.status).toBe('confirmed');
    console.log('  ✓ Consumer confirmed');

    // Step 7: Report usage (both parties match = auto-complete)
    console.log('Step 7: Reporting usage');
    
    // Set mock to completed state for auto-complete simulation
    mockEscrowStatus = 3;

    const usageRes = await request(app)
      .post(`/api/credits/${creditId}/usage`)
      .send({ escrowId: mockEscrowId, usageAmount: 10 })
      .expect(200);

    expect(usageRes.body.credit.actualUsage).toBe(10);
    expect(usageRes.body.status).toBe('completed');
    console.log('  ✓ Usage reported, escrow completed');

    console.log('\n✅ E2E Escrow Flow Complete!');
  }, 30000);

  it('Cancellation before funding', async () => {
    const { blockchainService } = await import('../../src/services/blockchain');
    (blockchainService.fundEscrow as jest.Mock).mockRejectedValueOnce(new Error('fund failed'));

    const providerRes = await request(app)
      .post('/api/providers')
      .send(provider);
    const pid = providerRes.body.provider.id;

    const requestRes = await request(app)
      .post('/api/credits/request')
      .send({
        providerId: pid,
        buyerAddress: buyer.address,
        diemAmount: 0.1,
        durationDays: 7
      });

    expect(requestRes.body.credit.status).toBe('requested');
    const cid = requestRes.body.credit.id;

    const cancelRes = await request(app)
      .post(`/api/credits/${cid}/cancel`)
      .expect(200);

    expect(cancelRes.body.credit.status).toBe('cancelled');
  });

  it('Cannot cancel after funding', async () => {
    const providerRes = await request(app)
      .post('/api/providers')
      .send(provider);
    const pid = providerRes.body.provider.id;

    const requestRes = await request(app)
      .post('/api/credits/request')
      .send({
        providerId: pid,
        buyerAddress: buyer.address,
        diemAmount: 0.1,
        durationDays: 7
      });

    expect(requestRes.body.credit.status).toBe('created');
    const cid = requestRes.body.credit.id;

    const cancelRes = await request(app)
      .post(`/api/credits/${cid}/cancel`)
      .expect(400);

    expect(cancelRes.body.error).toContain('Cannot cancel');
  });
});
