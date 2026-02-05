import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { creditRepo } from '../repositories/credit';
import { providerRepo } from '../repositories/provider';
import { listingRepo } from '../repositories/listing';
import { blockchainService, EscrowStatus } from '../services/blockchain';
import { veniceService } from '../services/venice';
import { notifyWebhook } from './webhooks';
import { Credit, CreditStatus } from '../types';
import { ethers } from 'ethers';

const router = Router();

/** Create a real Venice key or a placeholder key so deliver flow always completes. */
async function getOrCreateDeliveryKey(creditId: string, totalDiemAmount: number, durationDays: number): Promise<{ key: string; isPlaceholder: boolean }> {
  if (veniceService.isConfigured) {
    try {
      const veniceKey = await veniceService.createLimitedKey(
        `DACN-${creditId.slice(0, 8)}`,
        totalDiemAmount,
        durationDays
      );
      return { key: veniceKey.key, isPlaceholder: false };
    } catch (e: any) {
      console.warn('Venice key creation failed, using placeholder:', e?.message || e);
    }
  }
  const placeholder = `dacn-placeholder-${creditId}-${crypto.randomBytes(16).toString('hex')}`;
  return { key: placeholder, isPlaceholder: true };
}

const requestCreditSchema = z.object({
  providerId: z.string().uuid(),
  buyerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  diemAmount: z.number().int().positive(), // in cents (100 = $1.00 DIEM)
  durationDays: z.number().int().positive().max(365),
  listingId: z.string().uuid().optional(), // when provided, reduces listing capacity and uses listing rate
});

const reportUsageSchema = z.object({
  usageAmount: z.number().int().nonnegative(),
});

// One-time USDC approval for escrow (backend wallet = buyer)
router.post('/approve-usdc', async (req, res) => {
  try {
    const receipt = await blockchainService.approveUsdcForEscrow();
    res.json({
      txHash: receipt.hash,
      message: 'Escrow contract approved to spend USDC. Retry POST /api/credits/:id/fund.',
    });
  } catch (error: any) {
    console.error('Approve USDC failed:', error);
    res.status(500).json({ error: error.message || 'Failed to approve USDC' });
  }
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
  
  let credits: Credit[];
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

// Get API key for a credit (buyer use: once key is delivered) — must be before GET /:id
router.get('/:id/key', (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }
  if (credit.status !== CreditStatus.KEY_DELIVERED && credit.status !== CreditStatus.CONFIRMED) {
    return res.status(400).json({ error: 'Key not yet delivered for this credit' });
  }
  if (!credit.apiKey) {
    return res.status(404).json({ error: 'No key stored for this credit' });
  }
  res.json({ apiKey: credit.apiKey });
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

  const { providerId, buyerAddress, diemAmount, durationDays, listingId } = parseResult.data;

  // Validate provider
  const provider = providerRepo.findById(providerId);
  if (!provider || !provider.isActive) {
    return res.status(404).json({ error: 'Provider not found or inactive' });
  }

  const backendWallet = blockchainService.getAddress();
  if (backendWallet && backendWallet.toLowerCase() === provider.address.toLowerCase()) {
    return res.status(400).json({
      error: 'Cannot request credit from yourself. The backend wallet is the same as the listing provider. Use a different wallet as PRIVATE_KEY (the buyer) to test.',
    });
  }

  let ratePerDiem = provider.ratePerDiem;
  let listing: { id: string; providerId: string; diemAmount: number; isActive: boolean } | null = null;

  if (listingId) {
    const listingRow = listingRepo.findById(listingId);
    if (!listingRow) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (listingRow.providerId !== providerId) {
      return res.status(400).json({ error: 'Listing does not belong to this provider' });
    }
    if (!listingRow.isActive) {
      return res.status(400).json({ error: 'Listing is no longer active' });
    }
    if (listingRow.diemAmount < diemAmount) {
      return res.status(400).json({ error: 'Listing has insufficient capacity' });
    }
    listing = listingRow;
    ratePerDiem = listingRow.ratePerDiem;
  }

  try {
    // Calculate amounts (use listing rate when listingId provided)
    const rate = BigInt(ratePerDiem);
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
      creditId: 0,
      providerId,
      buyerAddress,
      totalDiemAmount: diemAmount,
      actualUsage: null,
      durationDays,
      status: CreditStatus.REQUESTED,
      escrowId: null,
      apiKey: null,
      apiKeyHash: null,
      expiresAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString(),
    });

    creditRepo.updateStatus(credit.id, credit.status, { escrowId });

    // Reduce listing capacity when created from a specific listing
    if (listing && listingId) {
      const newAmount = listing.diemAmount - diemAmount;
      listingRepo.update(listingId, {
        diemAmount: newAmount,
        isActive: newAmount > 0,
      });
    }

    // Auto-fund: backend wallet is the on-chain consumer (created the escrow), so fund now
    let updated = creditRepo.findById(credit.id)!;
    let fundingError: string | undefined;
    try {
      const receipt = await blockchainService.fundEscrow(escrowId);
      updated = creditRepo.updateStatus(credit.id, CreditStatus.CREATED, { escrowId })!;
      notifyWebhook('credit.funded', { credit: updated, escrowId }, { buyerAddress: credit.buyerAddress });
      return res.status(201).json({
        credit: updated,
        escrowId,
        txHash: receipt.hash,
        nextStep: 'Provider can deliver API key',
        fundAmount: totalAmount.toString(),
      });
    } catch (err: any) {
      fundingError = err.message || 'Failed to fund escrow';
      console.error('Auto-fund failed:', err);
    }

    notifyWebhook('credit.created', { credit: updated, escrowId }, { buyerAddress });
    res.status(201).json({
      credit: updated,
      escrowId,
      nextStep: 'fundEscrow',
      fundAmount: totalAmount.toString(),
      fundingError: fundingError ? `Escrow created but funding failed: ${fundingError}. Ensure backend wallet has USDC and retry POST /credits/:id/fund with body { "escrowId": "<escrowId>" }.` : undefined,
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
    
    // Update local record (store escrowId so deliver/prepare-deliver can use it)
    const updated = creditRepo.updateStatus(credit.id, CreditStatus.CREATED, {
      escrowId,
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

// Prepare deliver - Create Venice key and return keyHash so provider can call deliverKey on-chain from their wallet
router.post('/:id/prepare-deliver', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }
  if (credit.status !== CreditStatus.CREATED && credit.status !== CreditStatus.REQUESTED) {
    return res.status(400).json({ error: 'Credit not in CREATED state (fund escrow first)' });
  }
  const escrowId = credit.escrowId ?? req.body?.escrowId;
  if (!escrowId) {
    return res.status(400).json({ error: 'escrowId required (fund escrow first so escrowId is stored)' });
  }
  try {
    const { key: apiKey, isPlaceholder } = await getOrCreateDeliveryKey(
      credit.id,
      credit.totalDiemAmount,
      credit.durationDays
    );
    const keyHash = ethers.keccak256(ethers.toUtf8Bytes(apiKey));
    creditRepo.updateStatus(credit.id, credit.status, { apiKey, apiKeyHash: keyHash });
    res.json({
      escrowId,
      keyHash,
      apiKey,
      isPlaceholder,
      nextStep: 'Provider must call contract.deliverKey(escrowId, keyHash) from provider wallet, then give apiKey to buyer.',
    });
  } catch (error: any) {
    console.error('Failed to prepare deliver:', error);
    res.status(500).json({ error: error.message || 'Failed to prepare deliver' });
  }
});

// Mark key delivered - After provider has submitted deliverKey on-chain, call this to update DB
router.post('/:id/mark-delivered', (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }
  if (!credit.apiKeyHash) {
    return res.status(400).json({ error: 'Call prepare-deliver first' });
  }
  const updated = creditRepo.updateStatus(credit.id, CreditStatus.KEY_DELIVERED, {});
  res.json({ credit: updated });
});

// Deliver API key - Step 3a: Backend creates key and returns keyHash; provider must call contract.deliverKey from their wallet, then POST /:id/mark-delivered
router.post('/:id/deliver', async (req, res) => {
  const credit = creditRepo.findById(req.params.id);
  if (!credit) {
    return res.status(404).json({ error: 'Credit not found' });
  }

  const escrowId = credit.escrowId ?? req.body?.escrowId;
  if (!escrowId) {
    return res.status(400).json({ error: 'escrowId required (fund escrow first so escrowId is stored)' });
  }

  try {
    // Create Venice limited key or placeholder
    const { key: apiKey, isPlaceholder } = await getOrCreateDeliveryKey(
      credit.id,
      credit.totalDiemAmount,
      credit.durationDays
    );

    const keyHash = ethers.keccak256(ethers.toUtf8Bytes(apiKey));

    // Store key/hash on credit; do NOT call contract here (only provider's wallet can call deliverKey)
    creditRepo.updateStatus(credit.id, credit.status, { apiKey, apiKeyHash: keyHash });

    res.json({
      escrowId,
      keyHash,
      apiKey,
      isPlaceholder,
      nextStep: 'Sign the transaction in your wallet to deliver the key on-chain, then the dashboard will mark it delivered.',
    });
  } catch (error: any) {
    console.error('Failed to prepare deliver key:', error);
    res.status(500).json({ error: error.message || 'Failed to prepare deliver key' });
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
