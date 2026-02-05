import { Router } from 'express';
import { z } from 'zod';
import { listingRepo } from '../repositories/listing';
import { providerRepo } from '../repositories/provider';

const router = Router();

const createListingSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().max(100).optional(),
  diemAmount: z.number().positive(),
  ratePerDiem: z.number().positive(),
  minPurchase: z.number().nonnegative().optional(),
  maxPurchase: z.number().positive().optional(),
});

// List listings: no params = browse all (for agents); ?provider=:id or ?address=0x... = filter by provider/wallet
router.get('/', (req, res) => {
  const { provider: providerId, address } = req.query;

  if (providerId && typeof providerId === 'string') {
    const listings = listingRepo.findByProvider(providerId);
    return res.json({ listings });
  }

  if (address && typeof address === 'string') {
    const provider = providerRepo.findByAddress(address);
    if (!provider) {
      return res.json({ listings: [] });
    }
    const listings = listingRepo.findByProvider(provider.id);
    return res.json({ listings });
  }

  // No params: return all active listings with provider info so agents can discover and request credit
  const listings = listingRepo.findAllActive();
  const enriched = listings.map((l) => {
    const provider = providerRepo.findById(l.providerId);
    return {
      ...l,
      providerAddress: provider?.address ?? null,
      providerName: provider?.name ?? null,
    };
  });
  return res.json({ listings: enriched });
});

// Get one listing
router.get('/:id', (req, res) => {
  const listing = listingRepo.findById(req.params.id);
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }
  res.json({ listing });
});

// Create listing (ensures provider exists, then creates listing)
router.post('/', (req, res) => {
  const parseResult = createListingSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const { address, name, diemAmount, ratePerDiem, minPurchase, maxPurchase } = parseResult.data;

  let provider = providerRepo.findByAddress(address);
  if (!provider) {
    try {
      provider = providerRepo.create({
        address,
        name: name || 'My Listing',
        maxDiemCapacity: Math.round(diemAmount),
        ratePerDiem: Math.round(ratePerDiem),
        isActive: true,
      });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) {
        provider = providerRepo.findByAddress(address)!;
      } else {
        throw e;
      }
    }
  }

  try {
    const listing = listingRepo.create({
      providerId: provider.id,
      diemAmount: Math.round(diemAmount),
      ratePerDiem: Math.round(ratePerDiem),
      minPurchase: minPurchase != null ? Math.round(minPurchase) : null,
      maxPurchase: maxPurchase != null ? Math.round(maxPurchase) : null,
      isActive: true,
    });
    res.status(201).json({ listing });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create listing' });
  }
});

// Update listing
router.patch('/:id', (req, res) => {
  const listing = listingRepo.update(req.params.id, req.body);
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }
  res.json({ listing });
});

// Deactivate or delete (soft: isActive false, or hard delete)
router.delete('/:id', (req, res) => {
  const deleted = listingRepo.delete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Listing not found' });
  }
  res.status(204).send();
});

export default router;
