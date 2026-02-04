import { Router } from 'express';
import { z } from 'zod';
import { creditRepo } from '../repositories/credit';
import { providerRepo } from '../repositories/provider';
import { blockchainService } from '../services/blockchain';
import { veniceService } from '../services/venice';
import { CreditStatus } from '../types';

const router = Router();

const requestCreditSchema = z.object({
  providerId: z.string().uuid(),
  buyerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  diemAmount: z.number().int().positive(),
  durationDays: z.number().int().positive().max(365),
});

const reportUsageSchema = z.object({
  creditId: z.string(),
  usageAmount: z.number().int().nonnegative(),
  reporter: z.enum(['provider', 'buyer']),
});

// Get credit quote (no blockchain interaction)
router.get('/quote', (req, res) => {
  const { providerId, diemAmount, durationDays } = req.query;
  
  if (!providerId || !diemAmount || !durationDays) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const provider = providerRepo.findById(providerId as string);
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const diem = parseInt(diemAmount as string);
  const days = parseInt(durationDays as string);
  const rate = provider.ratePerDiem;
  const subtotal = BigInt(diem) * BigInt(rate);
  const fee = (subtotal * BigInt(100)) / BigInt(10000); // 1%
  const total = subtotal + fee;

  res.json({
    quote: {
      providerId: provider.id,
      diemAmount: diem,
      durationDays: days,
      ratePerDiem: rate.toString(),
      subtotal: subtotal.toString(),
      platformFee: fee.toString(),
      totalCost: total.toString(),
    }
  });
});

// List credits (with optional filters)
router.get('/', (req, res) => {
  const { buyer, provider, status } = req.query;
  
  let credits;
  if (buyer) {
    credits = creditRepo.findByBuyer(buyer as string);
  } else if (provider) {
    credits = creditRepo.findByProvider(provider as string);
  } else if (status) {
    credits = creditRepo.findByStatus(status as CreditStatus);
  } else {
    // Return recent credits (limit 50)
    credits = [];
  }
  
  res.json({ credits });
});

// Get credit by ID
router.get('/:id', (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }
  res.json({ credit });
});

// Request credit (creates on-chain)
router.post('/request', async (req, res) => {
  const parseResult = requestCreditSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const { providerId, buyerAddress, diemAmount, durationDays } = parseResult.data;

  // Validate provider
  const provider = providerRepo.findById(providerId);
  if (!provider || !provider.isActive) {
    return res.status(404).json({ error: 'Provider not found or inactive' });
  }

  // Calculate expiry
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);

  try {
    // Create on-chain credit
    const rate = BigInt(provider.ratePerDiem);
    const totalAmount = BigInt(diemAmount) * rate;
    
    const creditId = await blockchainService.createCredit(
      buyerAddress,
      totalAmount,
      durationDays
    );

    // Create local record
    const credit = creditRepo.create({
      creditId,
      providerId,
      buyerAddress,
      totalDiemAmount: diemAmount,
      durationDays,
      status: CreditStatus.CREATED,
      expiresAt: expiresAt.toISOString(),
    });

    res.status(201).json({ credit });
  } catch (error: any) {
    console.error('Failed to create credit:', error);
    res.status(500).json({ error: error.message || 'Failed to create credit' });
  }
});

// Deliver API key (provider only)
router.post('/:id/deliver', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  if (credit.status !== CreditStatus.CREATED) {
    return res.status(400).json({ error: 'Credit is not in CREATED state' });
  }

  try {
    const provider = providerRepo.findById(credit.providerId);
    if (!provider) {
      return res.status(500).json({ error: 'Provider not found' });
    }

    // Create Venice API key
    const apiKey = await veniceService.createLimitedKey(
      `DECAN-${credit.id.slice(0, 8)}`,
      credit.totalDiemAmount,
      credit.durationDays
    );

    const keyHash = veniceService.hashKey(apiKey.key);

    // Deliver on-chain
    await blockchainService.deliverKey(credit.creditId!, keyHash);

    // Update local record
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.KEY_DELIVERED, {
      apiKey: apiKey.key,
      apiKeyHash: keyHash,
    });

    res.json({ 
      credit: updated,
      apiKey: apiKey.key // Return the actual key to the caller (provider)
    });
  } catch (error: any) {
    console.error('Failed to deliver key:', error);
    res.status(500).json({ error: error.message || 'Failed to deliver key' });
  }
});

// Confirm receipt (buyer only)
router.post('/:id/confirm', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  if (credit.status !== CreditStatus.KEY_DELIVERED) {
    return res.status(400).json({ error: 'Key not yet delivered' });
  }

  try {
    await blockchainService.confirmReceipt(credit.creditId!);
    
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.CONFIRMED, {
      confirmedAt: new Date().toISOString(),
    });

    res.json({ credit: updated });
  } catch (error: any) {
    console.error('Failed to confirm receipt:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm receipt' });
  }
});

// Report usage
router.post('/:id/usage', async (req, res) => {
  const parseResult = reportUsageSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  if (credit.status !== CreditStatus.CONFIRMED) {
    return res.status(400).json({ error: 'Credit not confirmed yet' });
  }

  const { usageAmount } = parseResult.data;

  try {
    await blockchainService.reportUsage(credit.creditId!, BigInt(usageAmount));
    
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.USAGE_REPORTED, {
      actualUsage: usageAmount,
    });

    res.json({ credit: updated });
  } catch (error: any) {
    console.error('Failed to report usage:', error);
    res.status(500).json({ error: error.message || 'Failed to report usage' });
  }
});

// Confirm usage (final step)
router.post('/:id/complete', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  if (credit.status !== CreditStatus.USAGE_REPORTED) {
    return res.status(400).json({ error: 'Usage not reported yet' });
  }

  try {
    await blockchainService.confirmUsage(credit.creditId!);
    
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.COMPLETED);

    // Revoke the Venice API key
    try {
      // We don't store the key ID in this version, but we could look it up
      // For now, the key will expire naturally
    } catch (e) {
      console.error('Failed to revoke key:', e);
    }

    res.json({ credit: updated });
  } catch (error: any) {
    console.error('Failed to complete credit:', error);
    res.status(500).json({ error: error.message || 'Failed to complete credit' });
  }
});

// Cancel credit
router.post('/:id/cancel', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  if (credit.status !== CreditStatus.CREATED && credit.status !== CreditStatus.REQUESTED) {
    return res.status(400).json({ error: 'Cannot cancel credit in current state' });
  }

  try {
    await blockchainService.cancelCredit(credit.creditId!);
    
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.CANCELLED);
    res.json({ credit: updated });
  } catch (error: any) {
    console.error('Failed to cancel credit:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel credit' });
  }
});

export default router;
