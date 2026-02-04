import { Router } from 'express';
import { z } from 'zod';
import { creditRepo } from '../repositories/credit';
import { providerRepo } from '../repositories/provider';
import { blockchainService, EscrowStatus } from '../services/blockchain';
import { veniceService } from '../services/venice';
import { notifyWebhook } from './webhooks';
import { CreditStatus } from '../types';
import { ethers } from 'ethers';

const router = Router();

const requestCreditSchema = z.object({
  providerId: z.string().uuid(),
  buyerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  diemAmount: z.number().int().positive(), // in cents (100 = $1.00 DIEM)
  durationDays: z.number().int().positive().max(365),
});

const reportUsageSchema = z.object({
  usageAmount: z.number().int().nonnegative(),
});

// Get credit quote (no blockchain interaction)
router.get('/quote', async (req, res) => {
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
  const rate = provider.ratePerDiem; // USDC wei per DIEM cent
  
  // Calculate: diem cents * rate = total USDC needed
  const subtotal = BigInt(diem) * BigInt(rate);
  const platformFeeBps = await blockchainService.getPlatformFeeBps();
  const fee = (subtotal * BigInt(platformFeeBps)) / BigInt(10000);
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

// Request credit - Step 1: Create escrow on-chain
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

  try {
    // Calculate amounts
    const rate = BigInt(provider.ratePerDiem);
    const subtotal = BigInt(diemAmount) * rate;
    const platformFeeBps = await blockchainService.getPlatformFeeBps();
    const platformFee = (subtotal * BigInt(platformFeeBps)) / BigInt(10000);
    const totalAmount = subtotal + platformFee;
    const durationSeconds = durationDays * 24 * 60 * 60;

    // Create on-chain escrow
    // Note: In production, this would be signed by the consumer's wallet
    // For the API, we're simulating with the backend wallet
    const escrowId = await blockchainService.createEscrow(
      provider.address,
      diemAmount,
      totalAmount,
      durationSeconds
    );

    // Create local record
    const credit = creditRepo.create({
      creditId: 0, // Will be set when funded (we store escrowId in separate field)
      providerId,
      buyerAddress,
      totalDiemAmount: diemAmount,
      actualUsage: null,
      durationDays,
      status: CreditStatus.REQUESTED,
      apiKey: null,
      apiKeyHash: null,
      expiresAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Store the escrowId separately (could add to DB schema)
    // For now, we'll use the credit's id as reference and store escrowId in a map
    // In production, add escrowId column to credits table

    // Notify webhooks
    notifyWebhook('credit.created', { credit, escrowId }, { buyerAddress });

    res.status(201).json({ 
      credit,
      escrowId,
      nextStep: 'fundEscrow',
      fundAmount: totalAmount.toString()
    });
  } catch (error: any) {
    console.error('Failed to create credit:', error);
    res.status(500).json({ error: error.message || 'Failed to create credit' });
  }
});

// Fund escrow - Step 2: Consumer funds the escrow
router.post('/:id/fund', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  if (credit.status !== CreditStatus.REQUESTED) {
    return res.status(400).json({ error: 'Credit already funded or invalid status' });
  }

  const { escrowId } = req.body;
  if (!escrowId) {
    return res.status(400).json({ error: 'escrowId required' });
  }

  try {
    // Fund the escrow on-chain
    const receipt = await blockchainService.fundEscrow(escrowId);
    
    // Update local record
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.CREATED, {
      apiKeyHash: escrowId // Store escrowId for reference
    });

    // Notify webhooks
    notifyWebhook('credit.funded', { credit: updated, escrowId }, { buyerAddress: credit.buyerAddress });

    res.json({ 
      credit: updated,
      escrowId,
      txHash: receipt.hash
    });
  } catch (error: any) {
    console.error('Failed to fund escrow:', error);
    res.status(500).json({ error: error.message || 'Failed to fund escrow' });
  }
});

// Deliver API key - Step 3: Provider delivers key hash
router.post('/:id/deliver', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  const { escrowId, apiKey } = req.body;
  if (!escrowId || !apiKey) {
    return res.status(400).json({ error: 'escrowId and apiKey required' });
  }

  try {
    // Create Venice limited key
    const veniceKey = await veniceService.createLimitedKey(
      `DACN-${credit.id.slice(0, 8)}`,
      credit.totalDiemAmount,
      credit.durationDays
    );

    // Hash the key for on-chain storage
    const keyHash = ethers.keccak256(ethers.toUtf8Bytes(veniceKey.key));

    // Deliver on-chain
    const receipt = await blockchainService.deliverKey(escrowId, keyHash);

    // Update local record
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.KEY_DELIVERED, {
      apiKey: veniceKey.key,
      apiKeyHash: keyHash,
    });

    // Notify webhooks
    notifyWebhook('credit.key_delivered', { 
      credit: updated, 
      escrowId,
      apiKeyHash: keyHash 
    }, { buyerAddress: credit.buyerAddress });

    res.json({ 
      credit: updated,
      escrowId,
      apiKey: veniceKey.key, // Return actual key to caller (provider gives to consumer)
      txHash: receipt.hash
    });
  } catch (error: any) {
    console.error('Failed to deliver key:', error);
    res.status(500).json({ error: error.message || 'Failed to deliver key' });
  }
});

// Confirm receipt - Step 4: Consumer confirms key received
router.post('/:id/confirm', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  if (credit.status !== CreditStatus.KEY_DELIVERED) {
    return res.status(400).json({ error: 'Key not yet delivered' });
  }

  const { escrowId } = req.body;
  if (!escrowId) {
    return res.status(400).json({ error: 'escrowId required' });
  }

  try {
    // Update local record
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.CONFIRMED, {
      confirmedAt: new Date().toISOString(),
    });

    // Note: On-chain verification happens when consumer calls verifyApiKey
    // but doesn't change status. The backend tracks this locally.

    // Notify webhooks
    notifyWebhook('credit.confirmed', { credit: updated, escrowId }, { buyerAddress: credit.buyerAddress });

    res.json({ credit: updated, escrowId });
  } catch (error: any) {
    console.error('Failed to confirm receipt:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm receipt' });
  }
});

// Report usage - Step 5: Report actual DIEM usage
router.post('/:id/usage', async (req, res) => {
  const parseResult = reportUsageSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  if (credit.status !== CreditStatus.CONFIRMED && credit.status !== CreditStatus.KEY_DELIVERED) {
    return res.status(400).json({ error: 'Credit not active' });
  }

  const { escrowId, usageAmount } = req.body;
  if (!escrowId) {
    return res.status(400).json({ error: 'escrowId required' });
  }

  if (usageAmount > credit.totalDiemAmount) {
    return res.status(400).json({ error: 'Usage exceeds credit limit' });
  }

  try {
    // Report usage on-chain
    const receipt = await blockchainService.reportUsage(escrowId, usageAmount);
    
    // Update local record
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.USAGE_REPORTED, {
      actualUsage: usageAmount,
    });

    // Check escrow status - if both confirmed, it auto-completed
    const escrow = await blockchainService.getEscrow(escrowId);
    if (escrow.status === EscrowStatus.Completed) {
      const completed = creditRepo.updateStatus(credit.id, CreditStatus.COMPLETED);
      
      notifyWebhook('credit.completed', { credit: completed, escrowId }, { 
        buyerAddress: credit.buyerAddress 
      });
      
      return res.json({ 
        credit: completed, 
        escrowId,
        status: 'completed',
        txHash: receipt.hash
      });
    }

    notifyWebhook('credit.usage_reported', { credit: updated, usageAmount, escrowId }, 
      { buyerAddress: credit.buyerAddress });

    res.json({ 
      credit: updated, 
      escrowId,
      status: 'pending_confirmation',
      txHash: receipt.hash
    });
  } catch (error: any) {
    console.error('Failed to report usage:', error);
    res.status(500).json({ error: error.message || 'Failed to report usage' });
  }
});

// Complete credit (manual trigger to check chain status)
router.post('/:id/complete', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  const { escrowId } = req.body;
  if (!escrowId) {
    return res.status(400).json({ error: 'escrowId required' });
  }

  try {
    // Check on-chain status
    const escrow = await blockchainService.getEscrow(escrowId);
    
    if (escrow.status === EscrowStatus.Completed) {
      const updated = creditRepo.updateStatus(credit.id, CreditStatus.COMPLETED);
      
      notifyWebhook('credit.completed', { credit: updated, escrowId }, 
        { buyerAddress: credit.buyerAddress });
      
      return res.json({ credit: updated, escrowId, status: 'completed' });
    }

    res.json({ 
      credit, 
      escrowId, 
      status: 'pending',
      chainStatus: EscrowStatus[escrow.status]
    });
  } catch (error: any) {
    console.error('Failed to check completion:', error);
    res.status(500).json({ error: error.message || 'Failed to check completion' });
  }
});

// Cancel credit (before funding)
router.post('/:id/cancel', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  // Can only cancel before funding
  if (credit.status !== CreditStatus.REQUESTED) {
    return res.status(400).json({ error: 'Cannot cancel after funding' });
  }

  try {
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.CANCELLED);

    notifyWebhook('credit.cancelled', { credit: updated }, { buyerAddress: credit.buyerAddress });

    res.json({ credit: updated, message: 'Credit cancelled (no escrow was funded)' });
  } catch (error: any) {
    console.error('Failed to cancel credit:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel credit' });
  }
});

// Dispute credit
router.post('/:id/dispute', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  if (credit.status !== CreditStatus.USAGE_REPORTED) {
    return res.status(400).json({ error: 'Can only dispute after usage is reported' });
  }

  const updated = creditRepo.updateStatus(credit.id, CreditStatus.DISPUTED);

  notifyWebhook('credit.disputed', { credit: updated }, { buyerAddress: credit.buyerAddress });

  res.json({ 
    credit: updated, 
    message: 'Dispute raised. Manual resolution required.' 
  });
});

export default router;
