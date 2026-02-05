import { config } from '../config';
import { VeniceApiKey } from '../types';
import crypto from 'crypto';

class VeniceService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = config.venice.apiKey || '';
    this.baseUrl = config.venice.baseUrl;
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  async createLimitedKey(
    name: string,
    spendLimit: number,
    durationDays: number
  ): Promise<VeniceApiKey> {
    if (!this.apiKey) {
      throw new Error('Venice API key not configured. Set VENICE_API_KEY in the environment.');
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const response = await fetch(`${this.baseUrl}/api/v1/api-keys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        spend_limit: spendLimit,
        expires_at: expiresAt.toISOString(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create Venice API key: ${error}`);
    }

    const data = await response.json() as {
      id: string;
      key: string;
      name: string;
      spend_limit?: number;
      expires_at?: string;
    };
    return {
      id: data.id,
      key: data.key,
      name: data.name,
      spendLimit: data.spend_limit,
      expiresAt: data.expires_at,
    };
  }

  async revokeKey(keyId: string): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Venice API key not configured. Set VENICE_API_KEY in the environment.');
    }
    const response = await fetch(`${this.baseUrl}/api/v1/api-keys/${keyId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to revoke Venice API key: ${keyId}`);
    }
  }

  hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  // Validate a key by making a test request
  async validateKey(key: string): Promise<{ valid: boolean; remaining?: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
      });

      if (response.status === 401) {
        return { valid: false };
      }

      // Check remaining balance from headers if available
      const remaining = response.headers.get('x-diem-remaining');
      
      return { 
        valid: response.ok, 
        remaining: remaining ? parseFloat(remaining) : undefined 
      };
    } catch (error) {
      return { valid: false };
    }
  }
}

export const veniceService = new VeniceService();
