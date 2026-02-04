import request from 'supertest';
import express from 'express';
import providerRoutes from '../../src/routes/providers';
import { testProvider, testProvider2, invalidProvider } from '../fixtures/providers';

describe('Provider API Integration', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/providers', providerRoutes);
  });

  describe('POST /api/providers', () => {
    it('should create a provider', async () => {
      const response = await request(app)
        .post('/api/providers')
        .send(testProvider)
        .expect(201);

      expect(response.body.provider).toBeDefined();
      expect(response.body.provider.id).toBeDefined();
      expect(response.body.provider.address).toBe(testProvider.address);
      expect(response.body.provider.name).toBe(testProvider.name);
    });

    it('should reject invalid address', async () => {
      const response = await request(app)
        .post('/api/providers')
        .send(invalidProvider)
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should reject duplicate addresses', async () => {
      await request(app)
        .post('/api/providers')
        .send(testProvider)
        .expect(201);

      const response = await request(app)
        .post('/api/providers')
        .send(testProvider)
        .expect(409);

      expect(response.body.error).toContain('already exists');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/providers')
        .send({ address: testProvider.address })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/providers', () => {
    it('should return active providers', async () => {
      await request(app)
        .post('/api/providers')
        .send(testProvider);

      await request(app)
        .post('/api/providers')
        .send(testProvider2);

      const response = await request(app)
        .get('/api/providers')
        .expect(200);

      expect(response.body.providers).toHaveLength(2);
    });

    it('should only return active providers', async () => {
      const createRes = await request(app)
        .post('/api/providers')
        .send(testProvider);

      // Deactivate one
      await request(app)
        .patch(`/api/providers/${createRes.body.provider.id}`)
        .send({ isActive: false });

      const response = await request(app)
        .get('/api/providers')
        .expect(200);

      expect(response.body.providers).toHaveLength(0);
    });
  });

  describe('GET /api/providers/:id', () => {
    it('should return provider by ID', async () => {
      const createRes = await request(app)
        .post('/api/providers')
        .send(testProvider);

      const response = await request(app)
        .get(`/api/providers/${createRes.body.provider.id}`)
        .expect(200);

      expect(response.body.provider.address).toBe(testProvider.address);
    });

    it('should return 404 for non-existent provider', async () => {
      const response = await request(app)
        .get('/api/providers/non-existent-id')
        .expect(404);

      expect(response.body.error).toBe('Provider not found');
    });
  });

  describe('PATCH /api/providers/:id', () => {
    it('should update provider', async () => {
      const createRes = await request(app)
        .post('/api/providers')
        .send(testProvider);

      const response = await request(app)
        .patch(`/api/providers/${createRes.body.provider.id}`)
        .send({ ratePerDiem: 980 })
        .expect(200);

      expect(response.body.provider.ratePerDiem).toBe(980);
    });

    it('should return 404 for non-existent provider', async () => {
      const response = await request(app)
        .patch('/api/providers/non-existent')
        .send({ ratePerDiem: 900 })
        .expect(404);

      expect(response.body.error).toBe('Provider not found');
    });
  });
});
