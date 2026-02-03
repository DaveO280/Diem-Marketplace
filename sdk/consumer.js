/**
 * DIEM Agent Credit Network - Consumer SDK
 * 
 * For AI agents to rent Venice API capacity programmatically
 * 
 * @example
 * const dacn = new DACNConsumer({
 *   apiKey: 'your_dacn_api_key',
 *   wallet: walletProvider,
 *   escrowContract: '0x...',  // Required: deployed contract address
 *   usdcContract: '0x...'     // Optional: defaults to Base Sepolia USDC
 * });
 */

// Constants - must be configured
const DEFAULTS = {
  API_URL: 'https://api.diemcredit.network/v1',
  BASE_SEPOLIA_USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  BASE_MAINNET_USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  REQUEST_TIMEOUT: 30000,  // 30 seconds
  MAX_RETRIES: 3
};

// ABI fragments for contract interaction
const ESCROW_ABI = [
  "function createEscrow(address _provider, uint256 _diemLimit, uint256 _amount, uint256 _duration) external returns (bytes32)",
  "function fundEscrow(bytes32 _escrowId) external",
  "function reportUsage(bytes32 _escrowId, uint256 _usage) external",
  "function getEscrow(bytes32 _escrowId) external view returns (tuple(address provider, address consumer, uint256 amount, uint256 diemLimit, uint256 startTime, uint256 endTime, uint8 status, bytes32 apiKeyHash, uint256 reportedUsage, bool providerConfirmed, bool consumerConfirmed))",
  "event EscrowCreated(bytes32 indexed escrowId, address indexed provider, address indexed consumer, uint256 amount, uint256 diemLimit)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)"
];

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
    if (!config.apiKey) {
      throw new DACNError('API key is required', 'MISSING_API_KEY');
    }
    if (!config.wallet) {
      throw new DACNError('Wallet provider is required', 'MISSING_WALLET');
    }
    if (!config.escrowContract) {
      throw new DACNError('Escrow contract address is required', 'MISSING_CONTRACT');
    }
    
    this.apiUrl = config.apiUrl || DEFAULTS.API_URL;
    this.apiKey = config.apiKey;
    this.wallet = config.wallet;
    this.escrowContract = config.escrowContract;
    this.usdcContract = config.usdcContract || DEFAULTS.BASE_SEPOLIA_USDC;
    this.escrows = new Map();
    
    // Validate contract addresses
    if (!this.isValidAddress(this.escrowContract)) {
      throw new DACNError(`Invalid escrow contract address: ${this.escrowContract}`, 'INVALID_ADDRESS');
    }
    if (!this.isValidAddress(this.usdcContract)) {
      throw new DACNError(`Invalid USDC contract address: ${this.usdcContract}`, 'INVALID_ADDRESS');
    }
  }
  
  isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /**
   * Make authenticated API request with timeout and retry
   * @private
   */
  async _apiRequest(endpoint, options = {}) {
    const url = `${this.apiUrl}${endpoint}`;
    const fetchOptions = {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    };
    
    let lastError;
    for (let attempt = 1; attempt <= DEFAULTS.MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULTS.REQUEST_TIMEOUT);
        
        const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        clearTimeout(timeoutId);
        
        // Validate HTTP status
        if (!response.ok) {
          const errorBody = await response.text();
          throw new DACNError(
            `HTTP ${response.status}: ${response.statusText}`,
            'HTTP_ERROR',
            { status: response.status, body: errorBody }
          );
        }
        
        // Parse JSON response
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return await response.json();
        }
        
        return await response.text();
        
      } catch (err) {
        lastError = err;
        
        // Don't retry on client errors (4xx)
        if (err.code === 'HTTP_ERROR' && err.details?.status >= 400 && err.details?.status < 500) {
          throw err;
        }
        
        // Wait before retry (exponential backoff)
        if (attempt < DEFAULTS.MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
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
   * Browse available credit listings
   */
  async browseListings(filters = {}) {
    const params = new URLSearchParams({
      minAmount: filters.minAmount || 0.1,
      maxPrice: filters.maxPrice || 1.0,
      ...filters
    });

    return await this._apiRequest(`/listings?${params}`);
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

    if (!listingId) {
      throw new DACNError('listingId is required', 'MISSING_LISTING_ID');
    }
    if (!diemAmount || diemAmount <= 0) {
      throw new DACNError('diemAmount must be > 0', 'INVALID_DIEM_AMOUNT');
    }

    // Get consumer address from wallet
    let consumerAddress;
    try {
      consumerAddress = await this.wallet.getAddress();
    } catch (err) {
      throw new DACNError('Failed to get wallet address', 'WALLET_ERROR', { originalError: err.message });
    }

    // Create escrow request
    const escrow = await this._apiRequest('/escrows', {
      method: 'POST',
      body: JSON.stringify({
        listing_id: listingId,
        diem_amount: diemAmount,
        consumer_address: consumerAddress,
        webhook_url: webhookUrl
      })
    });
    
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
    if (!window.ethers && !this.wallet.provider) {
      throw new DACNError('Ethers library required for blockchain operations', 'MISSING_ETHERS');
    }
    
    try {
      const ethers = window.ethers || require('ethers');
      
      const usdcContract = new ethers.Contract(
        this.usdcContract,
        ERC20_ABI,
        this.wallet
      );
      
      const escrowContract = new ethers.Contract(
        this.escrowContract,
        ESCROW_ABI,
        this.wallet
      );

      // Check USDC balance
      const address = await this.wallet.getAddress();
      const balance = await usdcContract.balanceOf(address);
      if (balance.lt(escrow.total_required)) {
        throw new DACNError(
          `Insufficient USDC balance. Have: ${ethers.utils.formatUnits(balance, 6)}, Need: ${ethers.utils.formatUnits(escrow.total_required, 6)}`,
          'INSUFFICIENT_BALANCE'
        );
      }

      // Approve escrow contract to spend USDC
      const approveTx = await usdcContract.approve(
        this.escrowContract,
        escrow.total_required
      );
      await approveTx.wait();

      // Call fundEscrow on contract
      const fundTx = await escrowContract.fundEscrow(escrow.escrow_id);
      await fundTx.wait();

      // Notify platform
      await this._apiRequest(`/escrows/${escrow.escrow_id}/funded`, { method: 'POST' });
      
    } catch (err) {
      if (err.code) throw err; // Already a DACNError
      throw new DACNError('Failed to fund escrow', 'FUNDING_FAILED', { originalError: err.message });
    }
  }

  /**
   * Get all active escrows for this consumer
   */
  async getActiveEscrows() {
    return await this._apiRequest('/escrows?consumer=true&status=active');
  }
}

/**
 * Represents an active escrow / credit line
 */
class DACNEscrow {
  constructor(escrowData, client) {
    if (!escrowData.escrow_id) {
      throw new DACNError('Invalid escrow data: missing escrow_id', 'INVALID_ESCROW_DATA');
    }
    
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
      try {
        const response = await this.client._apiRequest(`/escrows/${this.id}/key`);
        
        if (response.api_key) {
          this.veniceKey = response.api_key;
          return response.api_key;
        }
      } catch (err) {
        if (err.code === 'HTTP_ERROR' && err.details?.status === 404) {
          // Key not ready yet, continue polling
        } else {
          throw err;
        }
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    throw new DACNError('Timeout waiting for API key', 'KEY_TIMEOUT');
  }

  /**
   * Make an authenticated Venice API call with usage tracking
   */
  async veniceRequest(endpoint, options = {}) {
    if (!this.veniceKey) {
      throw new DACNError('API key not available. Call getVeniceApiKey() first.', 'NO_API_KEY');
    }

    const url = `https://api.venice.ai/api/v1${endpoint}`;
    
    try {
      const response = await fetch(url, {
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
        cfRay,
        status: response.status
      });

      // Validate response
      if (!response.ok) {
        const errorText = await response.text();
        throw new DACNError(
          `Venice API error: ${response.status}`,
          'VENICE_API_ERROR',
          { status: response.status, body: errorText }
        );
      }

      return response;
      
    } catch (err) {
      if (err.code) throw err;
      throw new DACNError('Venice request failed', 'REQUEST_FAILED', { originalError: err.message });
    }
  }

  /**
   * Report final usage and release escrow
   */
  async reportUsage(actualDiemUsed) {
    if (actualDiemUsed < 0 || actualDiemUsed > this.data.diem_limit) {
      throw new DACNError(
        `Usage must be between 0 and ${this.data.diem_limit}`,
        'INVALID_USAGE'
      );
    }

    // Submit usage report to platform
    return await this.client._apiRequest(`/escrows/${this.id}/report`, {
      method: 'POST',
      body: JSON.stringify({
        usage_diem: actualDiemUsed,
        request_logs: this.usageLog
      })
    });
  }

  /**
   * Get current status
   */
  async getStatus() {
    return await this.client._apiRequest(`/escrows/${this.id}`);
  }
}

// Example usage with proper error handling
async function example() {
  try {
    // Initialize
    const dacn = new DACNConsumer({
      apiKey: process.env.DACN_API_KEY,
      wallet: new ethers.Wallet(process.env.PRIVATE_KEY, provider),
      escrowContract: '0x...',  // Required!
      usdcContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e'  // Base Sepolia
    });

    // Browse listings
    const listings = await dacn.browseListings({
      maxPrice: 0.95,
      minAmount: 0.5
    });

    if (!listings || listings.length === 0) {
      console.log('No listings available');
      return;
    }

    // Select best offer
    const best = listings[0];

    // Request credit
    const credit = await dacn.requestCredit({
      listingId: best.listing_id,
      diemAmount: 0.5,
      webhookUrl: 'https://my-agent.com/webhooks/dacn'
    });

    // Wait for key
    console.log('Waiting for API key...');
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
    const finalStatus = await credit.reportUsage(0.05);
    console.log('Escrow completed:', finalStatus);
    
  } catch (err) {
    if (err instanceof DACNError) {
      console.error(`DACN Error [${err.code}]:`, err.message);
      console.error('Details:', err.details);
    } else {
      console.error('Unexpected error:', err);
    }
    process.exit(1);
  }
}

module.exports = { DACNConsumer, DACNEscrow, DACNError, DEFAULTS };
