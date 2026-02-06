/**
 * DIEM Agent Credit Network - Consumer SDK
 *
 * Uses the real DACN API: /api/credits/request, /api/credits/:id/key, /api/listings.
 * The backend creates and funds the escrow; the buyer only requests and then retrieves the key.
 *
 * @example
 * const dacn = new DACNConsumer({
 *   apiUrl: 'http://localhost:3000',
 *   wallet: walletProvider
 * });
 * const credit = await dacn.requestCredit({ providerId: '...', diemAmount: 100, durationDays: 1 });
 * const apiKey = await credit.getVeniceApiKey();
 */

const DEFAULTS = {
  API_URL: 'http://localhost:3000',
  REQUEST_TIMEOUT: 30000,
  MAX_RETRIES: 3,
};

class DACNError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'DACNError';
    this.code = code;
    this.details = details;
  }
}

class DACNConsumer {
  constructor(config) {
    if (!config.wallet) {
      throw new DACNError('Wallet provider is required', 'MISSING_WALLET');
    }
    this.apiUrl = (config.apiUrl || DEFAULTS.API_URL).replace(/\/$/, '');
    this.wallet = config.wallet;
    this.credits = new Map();
  }

  async _apiRequest(endpoint, options = {}) {
    const url = `${this.apiUrl}${endpoint}`;
    const fetchOptions = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };
    if (options.body && typeof options.body === 'string') {
      fetchOptions.body = options.body;
    } else if (options.body && typeof options.body === 'object' && !(options.body instanceof String)) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    let lastError;
    for (let attempt = 1; attempt <= DEFAULTS.MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULTS.REQUEST_TIMEOUT);
        const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text();
          throw new DACNError(
            `HTTP ${response.status}: ${response.statusText}`,
            'HTTP_ERROR',
            { status: response.status, body: errorBody }
          );
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return await response.json();
        }
        return await response.text();
      } catch (err) {
        lastError = err;
        if (err.code === 'HTTP_ERROR' && err.details?.status >= 400 && err.details?.status < 500) {
          throw err;
        }
        if (attempt < DEFAULTS.MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    throw new DACNError(
      `Failed after ${DEFAULTS.MAX_RETRIES} attempts: ${lastError.message}`,
      'MAX_RETRIES_EXCEEDED',
      { originalError: lastError }
    );
  }

  /**
   * Browse available listings (from /api/listings)
   */
  async browseListings(filters = {}) {
    const params = new URLSearchParams();
    if (filters.address) params.set('address', filters.address);
    const result = await this._apiRequest(`/api/listings${params.toString() ? '?' + params : ''}`);
    return result.listings || [];
  }

  /**
   * Request credit. Backend creates escrow and funds it; returns credit record.
   * @param {Object} options - providerId (required), diemAmount, durationDays, listingId (optional)
   */
  async requestCredit(options) {
    const { providerId, diemAmount, durationDays, listingId } = options;
    if (!providerId) {
      throw new DACNError('providerId is required', 'MISSING_PROVIDER_ID');
    }
    if (!diemAmount || diemAmount <= 0) {
      throw new DACNError('diemAmount must be > 0', 'INVALID_DIEM_AMOUNT');
    }

    let buyerAddress;
    try {
      buyerAddress = await this.wallet.getAddress();
    } catch (err) {
      throw new DACNError('Failed to get wallet address', 'WALLET_ERROR', { originalError: err.message });
    }

    const body = {
      providerId,
      buyerAddress,
      diemAmount: Number(diemAmount),
      durationDays: Number(durationDays || 1),
    };
    if (listingId) body.listingId = listingId;

    const result = await this._apiRequest('/api/credits/request', {
      method: 'POST',
      body,
    });

    const credit = result.credit || result;
    if (!credit.id) {
      throw new DACNError('Invalid response: missing credit id', 'INVALID_RESPONSE', { body: result });
    }
    this.credits.set(credit.id, credit);
    return new DACNCredit(credit, this);
  }

  /**
   * Get credits for this buyer
   */
  async getCredits() {
    let buyerAddress;
    try {
      buyerAddress = await this.wallet.getAddress();
    } catch (err) {
      throw new DACNError('Failed to get wallet address', 'WALLET_ERROR', { originalError: err.message });
    }
    const result = await this._apiRequest(`/api/credits?buyer=${encodeURIComponent(buyerAddress)}`);
    return result.credits || [];
  }
}

/**
 * Represents a credit (backend record). Key is retrieved with getVeniceApiKey().
 */
class DACNCredit {
  constructor(creditData, client) {
    if (!creditData.id) {
      throw new DACNError('Invalid credit data: missing id', 'INVALID_CREDIT_DATA');
    }
    this.id = creditData.id;
    this.data = creditData;
    this.client = client;
    this.veniceKey = null;
    this.usageLog = [];
  }

  /**
   * Poll for API key. Requires X-Buyer-Address header (buyer-only).
   */
  async getVeniceApiKey(pollInterval = 5000, maxAttempts = 60) {
    let buyerAddress;
    try {
      buyerAddress = await this.client.wallet.getAddress();
    } catch (err) {
      throw new DACNError('Failed to get wallet address', 'WALLET_ERROR', { originalError: err.message });
    }

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await this.client._apiRequest(`/api/credits/${this.id}/key`, {
          headers: { 'X-Buyer-Address': buyerAddress },
        });
        if (response.apiKey) {
          this.veniceKey = response.apiKey;
          return response.apiKey;
        }
      } catch (err) {
        if (err.code === 'HTTP_ERROR' && err.details?.status === 403) {
          throw new DACNError('Only the buyer can retrieve the key. Ensure your wallet is the credit buyer.', 'FORBIDDEN');
        }
        if (err.code === 'HTTP_ERROR' && (err.details?.status === 404 || err.details?.status === 400)) {
          // Key not ready or not yet delivered
        } else {
          throw err;
        }
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }
    throw new DACNError('Timeout waiting for API key', 'KEY_TIMEOUT');
  }

  /**
   * Make a Venice API call with the delivered key
   */
  async veniceRequest(endpoint, options = {}) {
    if (!this.veniceKey) {
      throw new DACNError('API key not available. Call getVeniceApiKey() first.', 'NO_API_KEY');
    }
    const url = `https://api.venice.ai/api/v1${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.veniceKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const balanceDiem = response.headers.get('x-venice-balance-diem');
    this.usageLog.push({
      timestamp: new Date().toISOString(),
      endpoint,
      remainingDiem: balanceDiem,
      status: response.status,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new DACNError(`Venice API error: ${response.status}`, 'VENICE_API_ERROR', {
        status: response.status,
        body: errorText,
      });
    }
    return response;
  }

  /**
   * Report usage (POST /api/credits/:id/usage)
   */
  async reportUsage(usageAmount) {
    return await this.client._apiRequest(`/api/credits/${this.id}/usage`, {
      method: 'POST',
      body: { usageAmount: Number(usageAmount) },
    });
  }

  /**
   * Get credit status
   */
  async getStatus() {
    const result = await this.client._apiRequest(`/api/credits/${this.id}`);
    return result.credit || result;
  }
}

module.exports = { DACNConsumer, DACNCredit, DACNError, DEFAULTS };
