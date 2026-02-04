# DACN Go-to-Market: Moltbot Ecosystem

## Core Value Prop

**"Never run out of Venice API credits again. Rent spare DIEM from the community."**

- **For Agents**: Pay-per-use, no Venice account needed, instant API keys
- **For DIEM Holders**: Earn USDC on idle capacity without unstaking
- **For Moltbot**: Keeps agents online when primary credits run low

---

## Target Segments

### 1. Agent Developers (Primary)
**Who**: People building AI agents on Venice (Moltbot, Claude-code alternatives, auto-coders)
**Pain**: "My agent hit the rate limit again"
**Hook**: Automatic failover when primary credits exhausted

### 2. Venice Power Users with Idle DIEM
**Who**: Stakers with >50K DIEM not fully utilized
**Pain**: "My DIEM is just sitting there earning dust"
**Hook**: 5-10% APY in USDC without unstaking

### 3. AI Agent Platforms
**Who**: Platforms hosting multiple agents (like Venice itself, agent marketplaces)
**Pain**: Managing credits across hundreds of agents
**Hook**: Decentralized credit pool, no single point of failure

---

## Distribution Strategy

### Phase 1: Moltbot Community (Week 1-2)
**Goal**: Prove the concept with friendly users

- **Discord announcement**: "Need API credits? Rent them. Have spare DIEM? Earn USDC."
- **Beta program**: First 10 providers get 0% platform fee for 30 days
- **Integration help**: Offer to wire DACN into popular Moltbot agent templates

**Tactics**:
- Post in #general, #developers, #marketplace channels
- DM active agent builders: "Want to test automatic credit failover?"
- Create a #dacn-support channel

### Phase 2: Venice Ecosystem (Week 3-4)
**Goal**: Expand beyond Moltbot to all Venice users

- **Venice Discord**: Post in their #showcase channel
- **Blog post**: "How I Built a P2P API Marketplace on Venice"
- **Twitter/X threads**: Tag Venice, Base, relevant AI accounts

**Content ideas**:
- "My agent ran 24/7 for $12 using DACN vs $45 direct"
- "I earned $200 this month on spare DIEM"
- Architecture deep-dive (smart contract + escrow)

### Phase 3: Agent Platform Integrations (Month 2-3)
**Goal**: Become the default backup credit provider

**Targets**:
- Moltbot core (suggest native integration)
- Claude Code alternatives using Venice
- Autonomous agent frameworks (AutoGPT, BabyAGI forks)
- Discord bots with AI features

**Pitch**: 
> "Add 3 lines of code for unlimited credit failover. Your agents never sleep."

---

## Product Positioning

### Against Competitors

| Approach | Cost | Setup | Trust |
|----------|------|-------|-------|
| **Direct Venice** | $0.002/1K tokens | Easy | High |
| **DACN** | $0.0015-0.0019/1K (25% discount) | Medium | Smart contract |
| **Other APIs** | Varies | Easy | Varies |
| **Buying DIEM** | Upfront capital | Hard | High |

**Key differentiator**: No upfront cost, pay-for-what-you-use, trustless escrow.

### Brand Positioning

**Not**: "Cheap API credits"
**Yes**: "Always-on AI infrastructure"

Frame it as reliability, not discounting. Agents that never stop.

---

## Technical Integration Path

### For Agent Developers

**Option A: SDK Drop-in (Easiest)**
```javascript
import { DACNConsumer } from 'dacn-sdk';

const dacn = new DACNConsumer({
  apiKey: process.env.DACN_API_KEY,
  wallet: agentWallet,
  escrowContract: '0x...'
});

// Automatic failover
const venice = new VeniceClient({
  apiKey: primaryKey,
  onRateLimit: async () => {
    // Rent credits automatically
    const credit = await dacn.requestCredit({ diemAmount: 5 });
    return credit.getVeniceApiKey();
  }
});
```

**Option B: Manual Integration**
- Browse listings → Request credit → Poll for key → Use → Report usage

**Option C: CLI Tool**
```bash
dacn-agent rent --diem 5 --duration 24h
export VENICE_API_KEY=$(dacn-agent get-key)
```

### For DIEM Holders (Providers)

**Current**: CLI tool (`dacn-provider`)
**Future**: Web dashboard (already built as `dashboard.html`)

**Onboarding flow**:
1. Visit dashboard, connect wallet
2. "List my spare DIEM" → Set price
3. Earn USDC automatically when agents rent

---

## Incentive Structure

### For Early Providers
- **0% platform fee** for first 30 days (normally 1%)
- **Featured placement** in agent SDK listing queries
- **Revenue match**: Platform matches first $100 in earnings

### For Early Consumers (Agents)
- **$50 in free credits** for beta testers
- **Priority support** in Discord
- **Founder badge** in future governance

### Referral Program
- Provider refers consumer: 10% of consumer's fees for 90 days
- Consumer refers provider: $25 credit when provider earns $100

---

## Risk Mitigation

### For Consumers
- **Escrow protection**: Funds held until usage confirmed
- **Dispute resolution**: Manual review if disagreement
- **Key validation**: Test key before confirming receipt

### For Providers
- **No upfront cost**: Only listed DIEM is available
- **Automatic expiry**: Keys expire, no ongoing liability
- **Reputation system**: Good providers get priority placement

### Platform Risks
- **Smart contract audited**: Already done (SECURITY.md)
- **Gradual rollout**: Testnet → limited mainnet → open
- **Emergency pause**: Contract can be paused if issues

---

## Success Metrics

**Month 1**:
- [ ] 5 active providers
- [ ] 20 credit requests
- [ ] $500 in volume
- [ ] 0 disputes

**Month 3**:
- [ ] 25 active providers  
- [ ] 200 credit requests
- [ ] $5K in volume
- [ ] 3+ platform integrations

**Month 6**:
- [ ] 100 active providers
- [ ] 1000 credit requests/month
- [ ] $25K monthly volume
- [ ] Self-sustaining (revenue > costs)

---

## First Week Action Plan

| Day | Action | Owner |
|-----|--------|-------|
| 1 | Test end-to-end with real wallets | You |
| 2 | Fix any bugs, deploy backend | You |
| 3 | Post in Moltbot Discord #general | You |
| 4 | DM 5 active agent developers | You |
| 5 | Create demo video (2 min) | Me |
| 6 | Twitter thread announcement | You |
| 7 | Onboard first beta users | Both |

---

## Long-term Vision

**V1**: DIEM credit marketplace ✅ (done)
**V2**: Multi-provider AI routing (load balancing across providers)
**V3**: Arbitrage bot (buy lowDIEM on Base, rent high on DACN)
**V4**: Cross-chain ( expand to other L2s, other AI APIs)

**Endgame**: The default way AI agents get compute — decentralized, always-on, community-powered.

---

Ready to execute. What's the first move?
