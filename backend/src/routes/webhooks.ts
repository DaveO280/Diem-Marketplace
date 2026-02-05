import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { creditRepo } from '../repositories/credit';
import { db } from '../db/connection';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Store webhook subscriptions (in production, move to DB table)
interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: string[];
  buyerAddress?: string;
  providerId?: string;
  createdAt: string;
}

const subscriptions: Map<string, WebhookSubscription> = new Map();

const subscribeSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).optional(), // ['credit.created', 'credit.delivered', etc.]
  secret: z.string().min(16).optional(), // For HMAC verification
});

// Subscribe to webhooks
router.post('/subscribe', (req, res) => {
  const parseResult = subscribeSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.format() });
  }

  const { url, events, secret } = parseResult.data;
  
  const subscription: WebhookSubscription = {
    id: uuidv4(),
    url,
    secret: secret || crypto.randomUUID(),
    events: events || ['*'], // Default to all events
    createdAt: new Date().toISOString(),
  };

  subscriptions.set(subscription.id, subscription);

  res.status(201).json({
    subscription: {
      id: subscription.id,
      url: subscription.url,
      events: subscription.events,
      secret: subscription.secret, // Return once, won't be shown again
      createdAt: subscription.createdAt,
    }
  });
});

// List subscriptions — if WEBHOOK_ADMIN_SECRET is set, require Authorization: Bearer <secret> or X-API-Key: <secret>
router.get('/subscriptions', (req, res) => {
  const adminSecret = config.webhook?.adminSecret;
  if (adminSecret) {
    const auth = (req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || (req.headers['x-api-key'] as string) || '').trim();
    if (auth !== adminSecret) {
      return res.status(401).json({ error: 'Missing or invalid webhook admin auth' });
    }
  }
  const subs = Array.from(subscriptions.values()).map(s => ({
    id: s.id,
    url: s.url,
    events: s.events,
    createdAt: s.createdAt,
  }));
  res.json({ subscriptions: subs });
});

// Unsubscribe — same admin auth as GET /subscriptions when WEBHOOK_ADMIN_SECRET is set
router.delete('/subscriptions/:id', (req, res) => {
  const adminSecret = config.webhook?.adminSecret;
  if (adminSecret) {
    const auth = (req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || (req.headers['x-api-key'] as string) || '').trim();
    if (auth !== adminSecret) {
      return res.status(401).json({ error: 'Missing or invalid webhook admin auth' });
    }
  }
  const deleted = subscriptions.delete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Subscription not found' });
  }
  res.json({ success: true });
});

// Manual trigger for testing
router.post('/test', async (req, res) => {
  const { url, event, payload } = req.body;
  
  try {
    const result = await sendWebhook(url, event, payload);
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Export for use by credit service
export async function notifyWebhook(
  event: string,
  payload: any,
  filter?: { buyerAddress?: string; providerId?: string }
): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const sub of subscriptions.values()) {
    // Check if subscriber cares about this event
    if (!sub.events.includes('*') && !sub.events.includes(event)) {
      continue;
    }

    // Check filters if provided
    if (filter?.buyerAddress && sub.buyerAddress !== filter.buyerAddress) {
      continue;
    }
    if (filter?.providerId && sub.providerId !== filter.providerId) {
      continue;
    }

    promises.push(sendWebhook(sub.url, event, payload, sub.secret));
  }

  // Fire and forget - don't block the request
  Promise.allSettled(promises).then(results => {
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.error(`Webhook failures for ${event}:`, failures.length);
    }
  });
}

async function sendWebhook(
  url: string,
  event: string,
  payload: any,
  secret?: string
): Promise<void> {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-DACN-Event': event,
    'X-DACN-Timestamp': Date.now().toString(),
  };

  // Add signature if secret provided
  if (secret) {
    const signature = require('crypto')
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    headers['X-DACN-Signature'] = `sha256=${signature}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
  }
}

// Store webhook delivery attempts
export function logWebhookDelivery(
  subscriptionId: string,
  event: string,
  success: boolean,
  response?: string
): void {
  const stmt = db.prepare(`
    INSERT INTO webhook_deliveries (id, subscription_id, event, success, response, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    uuidv4(),
    subscriptionId,
    event,
    success ? 1 : 0,
    response || null,
    new Date().toISOString()
  );
}

export default router;
