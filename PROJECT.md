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

**Escrow contract:** `contracts/DiemCreditEscrow.sol`

- **Token:** USDC (testnet: `0x6Ac3aB54Dc5019A2e57eCcb214337FF5bbD52897` on Base Sepolia; mainnet uses a different USDC address.)
- **States:** `Pending` → consumer funds → `Funded` → provider delivers key hash → `Active` → usage reported & confirmed → `Completed`. Also `Disputed`, `Refunded`.
- **Key functions:** `createEscrow(provider, diemLimit, amount, duration)`, `fundEscrow(escrowId)`, `deliverKey(escrowId, apiKeyHash)` (provider-only), `reportUsage(escrowId, usage)` (honest oracle), `confirmKeyReceipt(escrowId)` (consumer), `withdrawProviderBalance()` / owner fee withdrawal. Timelock on fee changes; emergency pause.
- **Design:** 1% platform fee, configurable unused penalty (max 20%); API key stored as hash only; 24h default duration.

---

## API (Backend)

Real implementation lives in `backend/`. Main surface:

- **Credits:** `POST /api/credits/request` (create escrow, optional auto-fund), `GET /api/credits`, `GET /api/credits/:id`, `GET /api/credits/:id/key` (buyer gets key once delivered).
- **Delivery:** `POST /api/credits/:id/deliver` (backend returns key + keyHash; provider signs `deliverKey(escrowId, keyHash)` on-chain from their wallet), then `POST /api/credits/:id/mark-delivered`.
- **Lifecycle:** `POST /api/credits/:id/confirm`, `POST /api/credits/:id/usage`, completion via contract + backend.
- **Config:** `GET /api/config` (contract address, RPC for frontend), `GET /health`.
- **Webhooks:** `POST /api/webhooks/subscribe`, `GET/DELETE /api/webhooks/subscriptions` (optional `WEBHOOK_ADMIN_SECRET` for auth). Outbound payloads are signed with `X-DACN-Signature` when a secret is set on subscribe.

See `backend/README.md` and `SECURITY.md` (webhook auth) for details.

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

**Last Updated**: 2026-02-04
**Status**: Testnet-ready (Base Sepolia)
