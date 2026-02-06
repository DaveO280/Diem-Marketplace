import { Router } from 'express';
import { z } from 'zod';
import { providerRepo } from '../repositories/provider';
import { blockchainService } from '../services/blockchain';

const router = Router();

// USD credited through escrow (on-chain withdrawable balance) — before /:id
router.get('/earnings', async (req, res) => {
  const address = (req.query.address as string)?.trim();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Query parameter address (0x...) required' });
  }
  try {
    const balanceWei = await blockchainService.getProviderBalance(address);
    const balanceUsdc = (Number(balanceWei) / 1e6).toFixed(2);
    res.json({ balanceWei: balanceWei.toString(), balanceUsdc });
  } catch (e: any) {
    console.error('Earnings lookup failed:', e);
    res.status(500).json({ error: e.message || 'Failed to fetch provider balance' });
  }
});

const createProviderSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().min(1).max(100),
  maxDiemCapacity: z.number().int().positive(),
  ratePerDiem: z.number().int().positive(),
});

// List all active providers
router.get('/', (req, res) => {
  const providers = providerRepo.findActive();
  res.json({ providers });
});

// Get provider by ID
router.get('/:id', (req, res) => {
  const provider = providerRepo.findById(req.params.id);
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  res.json({ provider });
});

// Create provider
router.post('/', (req, res) => {
  const parseResult = createProviderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  try {
    const provider = providerRepo.create({
      ...parseResult.data,
      isActive: true,
    });
    res.status(201).json({ provider });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Provider address already exists' });
    }
    throw error;
  }
});

// Update provider
router.patch('/:id', (req, res) => {
  const provider = providerRepo.update(req.params.id, req.body);
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  res.json({ provider });
});

// Get provider's credits
router.get('/:id/credits', (req, res) => {
  const { creditRepo } = require('../repositories/credit');
  const credits = creditRepo.findByProvider(req.params.id);
  res.json({ credits });
});

export default router;
