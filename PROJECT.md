# DIEM Agent Credit Network (DACN)

**A peer-to-peer API credit marketplace for AI agents on Venice.ai**

---

## Overview

DACN enables AI agents (like OpenClaw agents) to rent Venice.ai API capacity from DIEM token holders. Think of it as "Airbnb for API credits" — but designed specifically for autonomous agents.

### Why Agents?

- **Precise usage tracking**: Agents can self-report exact consumption via API headers
- **No disputes**: Code doesn't lie about usage
- **Automated confirmation**: Both parties can verify transactions programmatically
- **Lower trust requirements**: Honest oracle model works because agents are deterministic

---

## Architecture

### Core Components

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Provider      │     │   DACN Platform  │     │   Consumer      │
│   (DIEM Holder) │     │                  │     │   (Agent)       │
└────────┬────────┘     └────────┬─────────┘     └────────┬────────┘
         │                       │                        │
         │ 1. List capacity      │                        │
         │──────────────────────>│                        │
         │                       │                        │
         │                       │ 2. Request credit      │
         │                       │<───────────────────────│
         │                       │                        │
         │ 3. Create limited key │                        │
         │<──────────────────────│                        │
         │                       │                        │
         │ 4. Fund escrow        │                        │
         │                       │───────────────────────>│
         │                       │                        │
         │ 5. Use API            │                        │
         │───────────────────────────────────────────────>│
         │                       │                        │
         │ 6. Report usage       │                        │
         │<───────────────────────────────────────────────│
         │                       │                        │
         │ 7. Confirm release    │                        │
         │──────────────────────>│                        │
         │                       │ 8. Release payment     │
         │                       │───────────────────────>│
```

### Smart Contract Architecture (Base Network)

**Escrow Contract:** `DiemCreditEscrow.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract DiemCreditEscrow is ReentrancyGuard, Ownable {
    IERC20 public usdc;
    
    uint256 public constant PLATFORM_FEE_BPS = 100; // 1%
    uint256 public constant UNUSED_PENALTY_BPS = 500; // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    enum Status { Pending, Active, Completed, Disputed, Refunded }
    
    struct Escrow {
        address provider;
        address consumer;
        uint256 amount;           // Total USDC amount
        uint256 diemLimit;        // DIEM credit limit (in cents)
        uint256 platformFee;      // 1% of amount
        uint256 startTime;
        uint256 endTime;
        Status status;
        bytes32 apiKeyHash;       // Hash of the API key (not the key itself)
        uint256 reportedUsage;    // Amount actually used (in cents)
    }
    
    mapping(bytes32 => Escrow) public escrows;
    mapping(address => uint256) public providerBalances;
    
    event EscrowCreated(bytes32 indexed escrowId, address provider, address consumer, uint256 amount);
    event EscrowFunded(bytes32 indexed escrowId);
    event UsageReported(bytes32 indexed escrowId, uint256 usage);
    event EscrowReleased(bytes32 indexed escrowId, uint256 providerAmount, uint256 platformFee);
    event EscrowDisputed(bytes32 indexed escrowId);
    
    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }
    
    // Consumer initiates escrow
    function createEscrow(
        address _provider,
        uint256 _diemLimit,
        uint256 _duration
    ) external returns (bytes32 escrowId) {
        // Implementation
    }
    
    // Consumer funds the escrow
    function fundEscrow(bytes32 _escrowId) external nonReentrant {
        // Implementation
    }
    
    // Honest oracle: both parties report usage
    function reportUsage(bytes32 _escrowId, uint256 _usage) external {
        // Implementation
    }
    
    // Release funds after usage confirmed
    function releaseEscrow(bytes32 _escrowId) external nonReentrant {
        // Implementation
    }
}
```

**Key Design Decisions:**
- USDC on Base (fast, cheap, DIEM is already on Base)
- 1% platform fee
- 5% penalty for unused credit (goes to provider)
- API key hash stored, not the key itself
- 24-hour default escrow duration (matches DIEM epoch)

---

## API Specification

### Base URL
```
https://api.diemcredit.network/v1
```

### Authentication
API keys via `Authorization: Bearer <token>`

### Endpoints

#### 1. List Capacity
```http
POST /listings
Authorization: Bearer <provider_token>

{
  "diem_available": 5.0,        // DIEM tokens available
  "price_per_diem": 0.95,       // USDC per DIEM (slight discount)
  "min_purchase": 0.1,          // Minimum DIEM per transaction
  "max_purchase": 2.0,          // Maximum DIEM per transaction
  "duration_hours": 24          // Default duration
}

Response:
{
  "listing_id": "list_abc123",
  "status": "active",
  "expires_at": "2025-02-04T16:00:00Z"
}
```

#### 2. Request Credit
```http
POST /escrows
Authorization: Bearer <consumer_token>

{
  "listing_id": "list_abc123",
  "diem_amount": 0.5,           // Requesting $0.50 of credit
  "consumer_address": "0x...",
  "webhook_url": "https://agent.example.com/webhook"
}

Response:
{
  "escrow_id": "esc_xyz789",
  "status": "pending_provider",
  "deposit_address": "0x...",
  "amount_usdc": 475000,        // $0.475 (0.50 * 0.95)
  "platform_fee": 4750,         // $0.00475 (1%)
  "total_required": 479750      // $0.47975
}
```

#### 3. Provider Confirms & Creates Key
```http
POST /escrows/{escrow_id}/confirm
Authorization: Bearer <provider_token>

{
  "venice_api_key": "venice_..."  // Stored encrypted, never logged
}

Response:
{
  "status": "funded",
  "api_key_id": "key_123",
  "api_key_preview": "venice_...abc",  // Last 3 chars only
  "expires_at": "2025-02-04T16:00:00Z"
}
```

#### 4. Consumer Reports Usage
```http
POST /escrows/{escrow_id}/report
Authorization: Bearer <consumer_token>

{
  "usage_diem": 0.32,           // Actually used $0.32
  "request_logs": [
    {
      "timestamp": "2025-02-03T16:30:00Z",
      "model": "llama-3.3-70b",
      "tokens_input": 150,
      "tokens_output": 450,
      "cost_diem": 0.05,
      "cf_ray": "8a3b2c..."
    }
  ]
}

Response:
{
  "status": "reported",
  "provider_share": 316800,     // $0.3168 (0.32 * 0.95 * 0.99)
  "platform_fee": 3200,         // $0.0032 (1% of usage)
  "unused_penalty": 8500,       // $0.085 (5% of $0.18 unused)
  "consumer_refund": 142500     // $0.1425 (remaining - penalty)
}
```

#### 5. Provider Confirms & Release
```http
POST /escrows/{escrow_id}/confirm-release
Authorization: Bearer <provider_token>

{
  "confirmed_usage": 0.32       // Agrees with consumer report
}

Response:
{
  "status": "completed",
  "tx_hash": "0x...",           // On-chain release transaction
  "provider_payout": 316800,
  "platform_fee": 3200,
  "penalty_to_provider": 8500
}
```

#### 6. Query Escrow Status
```http
GET /escrows/{escrow_id}
Authorization: Bearer <token>

Response:
{
  "escrow_id": "esc_xyz789",
  "status": "completed",
  "provider": "0x...",
  "consumer": "0x...",
  "total_amount": 479750,
  "usage_reported": 320000,
  "created_at": "2025-02-03T16:00:00Z",
  "completed_at": "2025-02-04T16:05:00Z"
}
```

---

## Venice API Integration

### Creating Limited Keys

```javascript
// Provider backend creates limited keys via Venice API
async function createLimitedKey(diemAmount, description) {
  const response = await fetch('https://api.venice.ai/api/v1/api_keys', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ADMIN_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      apiKeyType: 'INFERENCE',
      description: description,
      consumptionLimit: {
        diem: diemAmount,
        usd: 0,
        vcu: 0
      },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    })
  });
  
  const data = await response.json();
  return data.data.apiKey;  // Store securely, return to consumer
}
```

### Verifying Usage

Consumer agents verify usage via response headers:

```javascript
// After each API call
const remainingDiem = response.headers.get('x-venice-balance-diem');
const requestId = response.headers.get('CF-RAY');

// Log for final report
usageLog.push({
  cfRay: requestId,
  remainingDiem: remainingDiem,
  timestamp: new Date().toISOString()
});
```

---

## Project Roadmap

### Phase 1: MVP (Weeks 1-4)
- [ ] Smart contract development & testing (Base Sepolia)
- [ ] Basic API server (listing, escrow creation)
- [ ] Simple CLI for providers
- [ ] Test with 2-3 agents

**Deliverable**: Working prototype on testnet

### Phase 2: Beta (Weeks 5-8)
- [ ] Web UI for human oversight
- [ ] Agent SDK (npm package)
- [ ] Reputation system (on-chain scores)
- [ ] Dispute resolution mechanism
- [ ] Security audit (basic)

**Deliverable**: Beta on Base mainnet (limited users)

### Phase 3: Production (Weeks 9-16)
- [ ] Full security audit
- [ ] Venice ToS compliance verification
- [ ] Open source contracts
- [ ] Documentation & examples
- [ ] Community launch

**Deliverable**: Public release

### Phase 4: Scale (Ongoing)
- [ ] Multi-provider aggregation
- [ ] Dynamic pricing
- [ ] Cross-chain support
- [ ] Advanced analytics

---

## Security Considerations

### Provider Risks
- **API key theft**: Keys encrypted at rest, only decrypted for consumer
- **Burn attacks**: Daily limits enforce natural caps
- **Chargebacks**: Crypto-only eliminates traditional chargebacks

### Consumer Risks
- **Key doesn't work**: Escrow holds funds until verified
- **Provider disappears**: Automatic refund after timeout
- **Overcharging**: Precise usage reporting prevents this

### Platform Risks
- **Smart contract bugs**: Audits, bug bounties, insurance fund
- **Rate limiting**: Venice's 20/min key creation limit
- **Regulatory**: Crypto payments, no fiat on/off ramps

---

## Revenue Model

| Metric | Value |
|--------|-------|
| Platform fee | 1% of all transactions |
| Unused penalty | 5% (goes to provider, platform takes 1% of that) |
| Estimated first month | $1,000 volume = $10 revenue |
| Break-even estimate | ~$50K/month volume |

---

## Open Questions

1. **Venice ToS**: Need explicit confirmation that API key marketplace is allowed
2. **Penalty %**: Is 5% unused fee fair? Should it scale with time?
3. **Dispute resolution**: Manual or automated? Time limits?
4. **Key storage**: HSM? AWS KMS? Self-hosted?

---

## Related Links

- Venice API Docs: https://docs.venice.ai
- DIEM Calculator: https://diem-calculator.venice.ai
- Base Network: https://base.org
- OpenClaw: https://openclaw.ai

---

**Last Updated**: 2026-02-03
**Status**: Design Phase
