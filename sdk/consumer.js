/**
 * DIEM Agent Credit Network - Consumer SDK
 *
 * Two flows:
 * 1) Backend-funded: requestCredit() — backend creates and funds escrow; agent retrieves key.
 * 2) Agent-funded: browseListings() → getQuote() → purchaseCreditWithDeposit() — agent creates
 *    escrow, approves USDC, funds escrow, registers with API; then retrieves key when provider delivers.
 *
 * @example (agent-funded)
 * const dacn = new DACNConsumer({ apiUrl: 'http://localhost:3000', wallet: signer });
 * const listings = await dacn.browseListings();
 * const credit = await dacn.purchaseCreditWithDeposit({ providerId: listings[0].providerId, diemAmount: 1, durationDays: 1 });
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
   * Browse available listings (from /api/listings). Use for agent discovery.
   */
  async browseListings(filters = {}) {
    const params = new URLSearchParams();
    if (filters.address) params.set('address', filters.address);
    if (filters.provider) params.set('provider', filters.provider);
    const result = await this._apiRequest(`/api/listings${params.toString() ? '?' + params : ''}`);
    return result.listings || [];
  }

  /**
   * Get a price quote and escrow params for creating/funding an escrow on-chain.
   * @returns {Promise<{ quote: object, escrowParams: { providerAddress, diemLimitCents, amountWei, durationSeconds } }>}
   */
  async getQuote(providerId, diemAmount, durationDays = 1) {
    if (!providerId || !diemAmount || diemAmount <= 0) {
      throw new DACNError('providerId and diemAmount (positive) are required', 'INVALID_QUOTE_PARAMS');
    }
    const params = new URLSearchParams({
      providerId: String(providerId),
      diemAmount: String(Math.floor(diemAmount)),
      durationDays: String(Math.floor(durationDays)),
    });
    const result = await this._apiRequest(`/api/credits/quote?${params}`);
    if (!result.quote || !result.quote.escrowParams) {
      throw new DACNError('Invalid quote response: missing escrowParams', 'INVALID_RESPONSE', { body: result });
    }
    return result;
  }

  /**
   * Get API config (contract address, RPC, USDC address) for on-chain transactions.
   */
  async getConfig() {
    return this._apiRequest('/api/config');
  }

  /**
   * Register an escrow that the agent already created and funded on-chain. Creates a credit record so the provider can deliver the key.
   * @param {Object} params - escrowId, providerId, buyerAddress, totalDiemAmount, durationDays
   * @returns {Promise<DACNCredit>}
   */
  async registerEscrow(params) {
    const { escrowId, providerId, buyerAddress, totalDiemAmount, durationDays } = params;
    if (!escrowId || !providerId || !buyerAddress || !totalDiemAmount || !durationDays) {
      throw new DACNError('escrowId, providerId, buyerAddress, totalDiemAmount, durationDays are required', 'MISSING_PARAMS');
    }
    const result = await this._apiRequest('/api/credits/register', {
      method: 'POST',
      body: { escrowId, providerId, buyerAddress, totalDiemAmount, durationDays },
    });
    const credit = result.credit;
    if (!credit || !credit.id) {
      throw new DACNError('Invalid register response: missing credit', 'INVALID_RESPONSE', { body: result });
    }
    this.credits.set(credit.id, credit);
    return new DACNCredit(credit, this);
  }

  /**
   * Create escrow on-chain, approve USDC, fund escrow, then register with the API. Requires ethers (npm install ethers) and a signer that can send transactions.
   * @param {Object} options - providerId, diemAmount, durationDays, listingId (optional), signer (optional; defaults to this.wallet)
   * @returns {Promise<DACNCredit>}
   */
  async purchaseCreditWithDeposit(options) {
    const { providerId, diemAmount, durationDays = 1, listingId, signer } = options;
    if (!providerId || !diemAmount || diemAmount <= 0) {
      throw new DACNError('providerId and diemAmount (positive) are required', 'INVALID_PARAMS');
    }
    const wallet = signer || this.wallet;
    let buyerAddress;
    try {
      buyerAddress = await wallet.getAddress();
    } catch (err) {
      throw new DACNError('Wallet must expose getAddress()', 'WALLET_ERROR', { originalError: err.message });
    }

    const { quote } = await this.getQuote(providerId, diemAmount, durationDays);
    const { escrowParams } = quote;
    const config = await this.getConfig();
    if (!config.contractAddress || !config.rpcUrl) {
      throw new DACNError('API config missing contractAddress or rpcUrl', 'CONFIG_ERROR');
    }

    let ethers;
    try {
      ethers = typeof require !== 'undefined' ? require('ethers') : (typeof window !== 'undefined' && window.ethers);
    } catch (_) {
      // ignore
    }
    if (!ethers) {
      throw new DACNError(
        'purchaseCreditWithDeposit requires ethers. Install: npm install ethers',
        'MISSING_ETHERS'
      );
    }

    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const connectedWallet = wallet.connect ? wallet.connect(provider) : wallet;
    const usdcAddress = config.usdcAddress || '0x6Ac3aB54Dc5019A2e57eCcb214337FF5bbD52897';

    const escrowAbi = [
      'function createEscrow(address _provider, uint256 _diemLimit, uint256 _amount, uint256 _duration) returns (bytes32)',
      'function fundEscrow(bytes32 _escrowId)',
      'event EscrowCreated(bytes32 indexed escrowId, address indexed provider, address indexed consumer, uint256 amount, uint256 diemLimit)',
    ];
    const erc20Abi = [
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)',
    ];

    const escrowContract = new ethers.Contract(config.contractAddress, escrowAbi, connectedWallet);
    const usdc = new ethers.Contract(usdcAddress, erc20Abi, connectedWallet);

    const diemLimitCents = Number(escrowParams.diemLimitCents);
    const amountWei = BigInt(escrowParams.amountWei);
    const durationSeconds = Number(escrowParams.durationSeconds);

    const txCreate = await escrowContract.createEscrow(
      escrowParams.providerAddress,
      diemLimitCents,
      amountWei,
      durationSeconds
    );
    const receipt = await txCreate.wait();
    const iface = new ethers.Interface(escrowAbi);
    let escrowId = null;
    for (const log of receipt.logs || []) {
      if (log.address.toLowerCase() !== config.contractAddress.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'EscrowCreated') {
          escrowId = parsed.args[0];
          break;
        }
      } catch (_) {}
    }
    if (!escrowId) {
      throw new DACNError('Could not read escrowId from EscrowCreated event', 'TX_ERROR', { receipt });
    }
    escrowId = typeof escrowId === 'string' ? escrowId : escrowId.toString();

    const allowance = await usdc.allowance(buyerAddress, config.contractAddress);
    if (allowance < amountWei) {
      const approveTx = await usdc.approve(config.contractAddress, ethers.MaxUint256);
      await approveTx.wait();
    }

    const fundTx = await escrowContract.fundEscrow(escrowId);
    await fundTx.wait();

    const totalDiemAmount = Math.floor(diemAmount);
    const credit = await this.registerEscrow({
      escrowId,
      providerId,
      buyerAddress,
      totalDiemAmount,
      durationDays: Math.floor(durationDays),
    });
    return credit;
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
