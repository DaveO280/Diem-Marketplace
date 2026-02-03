/**
 * DIEM Agent Credit Network - Consumer SDK
 * 
 * For AI agents to rent Venice API capacity programmatically
 * 
 * @example
 * const dacn = new DACNConsumer({
 *   apiKey: 'your_dacn_api_key',
 *   wallet: walletProvider
 * });
 * 
 * const credit = await dacn.requestCredit({
 *   diemAmount: 0.5,
 *   maxPrice: 0.95  // USDC per DIEM
 * });
 * 
 * const veniceKey = await credit.getVeniceApiKey();
 * // Use veniceKey for API calls...
 * 
 * await credit.reportUsage(0.32);  // Report actual usage
 */

class DACNConsumer {
  constructor(config) {
    this.apiUrl = config.apiUrl || 'https://api.diemcredit.network/v1';
    this.apiKey = config.apiKey;
    this.wallet = config.wallet;  // EVM wallet provider
    this.escrows = new Map();
  }

  /**
   * Browse available credit listings
   */
  async browseListings(filters = {}) {
    const params = new URLSearchParams({
      minAmount: filters.minAmount || 0.1,
      maxPrice: filters.maxPrice || 1.0,
      ...filters
    });

    const response = await fetch(`${this.apiUrl}/listings?${params}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });

    return response.json();
  }

  /**
   * Request credit from a specific listing
   */
  async requestCredit(options) {
    const {
      listingId,
      diemAmount,
      webhookUrl
    } = options;

    // Get consumer address from wallet
    const consumerAddress = await this.wallet.getAddress();

    // Create escrow request
    const response = await fetch(`${this.apiUrl}/escrows`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        listing_id: listingId,
        diem_amount: diemAmount,
        consumer_address: consumerAddress,
        webhook_url: webhookUrl
      })
    });

    const escrow = await response.json();
    
    // Store for later reference
    this.escrows.set(escrow.escrow_id, escrow);

    // Fund the escrow on-chain
    await this._fundEscrow(escrow);

    return new DACNEscrow(escrow, this);
  }

  /**
   * Fund escrow with USDC
   * @private
   */
  async _fundEscrow(escrow) {
    const usdcContract = new ethers.Contract(
      USDC_ADDRESS,
      ERC20_ABI,
      this.wallet
    );

    // Approve escrow contract to spend USDC
    const approveTx = await usdcContract.approve(
      ESCROW_CONTRACT_ADDRESS,
      escrow.total_required
    );
    await approveTx.wait();

    // Call fundEscrow on contract
    const escrowContract = new ethers.Contract(
      ESCROW_CONTRACT_ADDRESS,
      ESCROW_ABI,
      this.wallet
    );

    const fundTx = await escrowContract.fundEscrow(escrow.escrow_id);
    await fundTx.wait();

    // Notify platform
    await fetch(`${this.apiUrl}/escrows/${escrow.escrow_id}/funded`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
  }

  /**
   * Get all active escrows for this consumer
   */
  async getActiveEscrows() {
    const response = await fetch(
      `${this.apiUrl}/escrows?consumer=true&status=active`,
      { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
    );
    return response.json();
  }
}

/**
 * Represents an active escrow / credit line
 */
class DACNEscrow {
  constructor(escrowData, client) {
    this.id = escrowData.escrow_id;
    this.data = escrowData;
    this.client = client;
    this.veniceKey = null;
    this.usageLog = [];
  }

  /**
   * Poll for API key availability
   */
  async getVeniceApiKey(pollInterval = 5000, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(
        `${this.client.apiUrl}/escrows/${this.id}/key`,
        { headers: { 'Authorization': `Bearer ${this.client.apiKey}` } }
      );

      if (response.status === 200) {
        const { api_key } = await response.json();
        this.veniceKey = api_key;
        return api_key;
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    throw new Error('Timeout waiting for API key');
  }

  /**
   * Make an authenticated Venice API call with usage tracking
   */
  async veniceRequest(endpoint, options = {}) {
    if (!this.veniceKey) {
      throw new Error('API key not available');
    }

    const response = await fetch(`https://api.venice.ai/api/v1${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.veniceKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    // Track usage from response headers
    const balanceDiem = response.headers.get('x-venice-balance-diem');
    const cfRay = response.headers.get('CF-RAY');

    this.usageLog.push({
      timestamp: new Date().toISOString(),
      endpoint,
      remainingDiem: balanceDiem,
      cfRay
    });

    return response;
  }

  /**
   * Report final usage and release escrow
   */
  async reportUsage(actualDiemUsed) {
    // Submit usage report to platform
    const response = await fetch(
      `${this.client.apiUrl}/escrows/${this.id}/report`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.client.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          usage_diem: actualDiemUsed,
          request_logs: this.usageLog
        })
      }
    );

    return response.json();
  }

  /**
   * Get current status
   */
  async getStatus() {
    const response = await fetch(
      `${this.client.apiUrl}/escrows/${this.id}`,
      { headers: { 'Authorization': `Bearer ${this.client.apiKey}` } }
    );
    return response.json();
  }
}

// Example usage
async function example() {
  // Initialize
  const dacn = new DACNConsumer({
    apiKey: process.env.DACN_API_KEY,
    wallet: new ethers.Wallet(process.env.PRIVATE_KEY, provider)
  });

  // Browse listings
  const listings = await dacn.browseListings({
    maxPrice: 0.95,  // USDC per DIEM (5% discount)
    minAmount: 0.5
  });

  // Select best offer
  const best = listings[0];

  // Request credit
  const credit = await dacn.requestCredit({
    listingId: best.listing_id,
    diemAmount: 0.5,
    webhookUrl: 'https://my-agent.com/webhooks/dacn'
  });

  // Wait for key
  const veniceKey = await credit.getVeniceApiKey();
  console.log('Got Venice API key:', veniceKey.slice(0, 10) + '...');

  // Make API calls
  const response = await credit.veniceRequest('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'llama-3.3-70b',
      messages: [{ role: 'user', content: 'Hello!' }]
    })
  });

  const result = await response.json();
  console.log('Response:', result.choices[0].message.content);

  // Report usage when done
  const finalStatus = await credit.reportUsage(0.05);  // Used $0.05
  console.log('Escrow completed:', finalStatus);
}

module.exports = { DACNConsumer, DACNEscrow };
