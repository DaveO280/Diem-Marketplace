# DACN Test Plan

Comprehensive testing strategy for DIEM Agent Credit Network before any mainnet deployment.

## Test Environments

| Environment | Network | Purpose | Status |
|-------------|---------|---------|--------|
| Local | Hardhat | Unit tests, fast iteration | Ready |
| Testnet | Base Sepolia | Integration tests, real transactions | Ready (have ETH) |
| Staging | Base Sepolia | End-to-end with real agents | Pending |
| Production | Base Mainnet | Live deployment | Not started |

---

## Phase 1: Smart Contract Tests

### 1.1 Unit Tests (Hardhat)

```bash
cd contracts
npm install
npm test
```

**Test Coverage Required:**

| Test | Status | Notes |
|------|--------|-------|
| Escrow creation | ✅ | Valid inputs, invalid provider, self-escrow (`test/DiemCreditEscrow.test.js`) |
| Funding | ✅ | Fund escrow, consumer-only, status → Funded |
| Key delivery | ✅ | Provider-only (deliverKey in flow), status checks |
| Usage reporting | ✅ | Consumer then provider reportUsage, usage exceeds limit |
| Settlement math | ✅ | Partial/full usage, provider balance, fee math |
| Withdrawals | ✅ | Provider withdraw, no balance reverts |
| Disputes | ⬜ | Raise dispute, resolve dispute, timeout behavior |
| Auto-complete | ⬜ | Timeout triggers, no report = full usage |
| Auto-refund | ⬜ | Provider no-show = consumer refund |
| Fee limits | ⬜ | Max 5% platform, max 20% penalty enforcement |

**Edge Cases:**
- [ ] Zero DIEM limit
- [ ] Zero amount
- [ ] Max uint256 values
- [ ] Escrow with 1 second duration
- [ ] Escrow with 1 year duration
- [x] Partial usage (1% used) — covered as partial usage
- [x] Full usage (100% used) — covered
- [ ] Zero usage (consumer never uses)

### 1.2 Integration Tests (Base Sepolia)

**Prerequisites:**
- [ ] Contract deployed to Sepolia
- [ ] Test USDC obtained
- [ ] Test wallets funded

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Full escrow flow | 1. Create escrow<br>2. Fund with USDC<br>3. Deliver key (provider signs)<br>4. Mark delivered<br>5. Report usage / confirm / complete | ✅ Implemented (dashboard + API); funds distributed, platform fee accumulated |
| No-show provider | 1. Create & fund<br>2. Wait 1+ hours<br>3. Call refundExpired | Consumer gets full refund |
| No-show consumer | 1. Create, fund, deliver<br>2. Wait 26+ hours<br>3. Call autoComplete | Provider gets full amount |
| Dispute flow | 1. Complete escrow<br>2. Raise dispute<br>3. Owner resolves | Funds split per owner decision |
| Fee withdrawal | 1. Complete multiple escrows<br>2. Owner calls withdrawPlatformFees | Owner receives accumulated fees |
| Provider withdrawal | 1. Complete escrow<br>2. Provider calls withdrawProviderBalance | Provider receives earnings |

---

## Phase 2: CLI Tests

### 2.1 Authentication

| Test | Command | Expected |
|------|---------|----------|
| Login | `dacn-provider login` | Saves config with restricted permissions |
| Logout | `dacn-provider logout` | Removes config file |
| No auth | `dacn-provider list` (without login) | Error: "Not logged in" |
| Invalid API key | Login with bad key | Error: "API key invalid" |
| Invalid Venice key | Login with bad key | Error: "Venice API key invalid" |

### 2.2 Listing Management

| Test | Command | Expected |
|------|---------|----------|
| Create listing | `dacn-provider list --diem 5.0 --price 0.95` | Listing created, ID returned |
| Insufficient DIEM | Try to list more than you have | Error with available balance |
| View listings | `dacn-provider listings` | Shows all active listings |
| View escrows | `dacn-provider orders` | Shows orders needing keys |

### 2.3 Key Delivery

| Test | Command | Expected |
|------|---------|----------|
| Deliver key | `dacn-provider deliver <escrow_id>` | Venice key created, delivered to platform |
| Wrong escrow | Try to deliver to non-existent escrow | Error |
| Already delivered | Try to deliver twice | Error |
| Wrong provider | Different provider tries to deliver | Error |

### 2.4 Withdrawal

| Test | Command | Expected |
|------|---------|----------|
| Withdraw earnings | `dacn-provider withdraw` | Transaction submitted, confirmed on-chain |
| No balance | Withdraw with zero balance | Error: "No balance to withdraw" |
| Double withdraw | Try to withdraw twice | Second call fails (balance already 0) |

---

## Phase 3: SDK Tests

### 3.1 Consumer SDK

```javascript
const { DACNConsumer } = require('dacn-sdk');
```

| Test | Code | Expected |
|------|------|----------|
| Browse listings | `dacn.browseListings()` | Returns array of listings |
| Request credit | `dacn.requestCredit({...})` | Creates escrow, returns escrow object |
| Poll for key | `credit.getVeniceApiKey()` | Returns Venice API key after provider delivers |
| Make API call | `credit.veniceRequest('/chat/completions')` | Successful Venice API call, usage tracked |
| Report usage | `credit.reportUsage(0.32)` | Usage reported, escrow settles |
| Get status | `credit.getStatus()` | Returns current escrow status |

### 3.2 Error Handling

| Test | Scenario | Expected |
|------|----------|----------|
| Invalid listing | Request from non-existent listing | Clear error message |
| Key timeout | Provider never delivers | Timeout error after polling limit |
| API failure | Venice API returns error | Error propagated, usage not counted |
| Network failure | Connection drops mid-request | Graceful retry or clear error |

---

## Phase 4: Frontend Tests

### 4.1 Wallet Connection

| Test | Action | Expected |
|------|--------|----------|
| Connect MetaMask | Click "Connect" button | Wallet connects, address displayed |
| Wrong network | Connect on Ethereum mainnet | Prompt to switch to Base Sepolia |
| Disconnect | Click "Disconnect" | Wallet disconnected, back to connect screen |

### 4.2 Dashboard

| Test | Action | Expected |
|------|--------|----------|
| View DIEM balance | Load dashboard | Shows accurate DIEM from Venice API |
| Create listing | Fill form, click create | Listing appears in "Your Listings" |
| View earnings | Complete an escrow | Earnings updated in real-time |

### 4.3 Settings

| Test | Action | Expected |
|------|--------|----------|
| Save Venice key | Enter key, save | Stored in localStorage |
| Change API URL | Update backend URL | SDK uses new URL |

---

## Phase 5: End-to-End Tests

### 5.1 Happy Path (Full Flow)

**Actors:**
- Provider: Dave (you)
- Consumer: Test agent

**Steps:**
1. Provider creates listing (5 DIEM @ 0.95 USDC)
2. Consumer browses and selects listing
3. Consumer funds escrow (4.75 USDC)
4. Provider delivers Venice API key
5. Consumer makes 3-4 API calls
6. Consumer reports usage (e.g., 0.42 DIEM used)
7. Provider confirms usage
8. Funds distributed:
   - Provider: ~$0.40 USDC
   - Platform: ~$0.004 USDC fee
   - Consumer refund: ~$0.35 USDC (minus 5% penalty on unused)

**Verification:**
- [ ] All transactions confirmed on Base Sepolia
- [ ] Provider balance updated correctly
- [ ] Platform fees accumulated
- [ ] Consumer received refund

### 5.2 Griefing Scenarios

| Scenario | Actor | Action | Expected Result |
|----------|-------|--------|-----------------|
| Consumer ghosts | Consumer | Funds but never uses | Auto-complete after timeout, provider gets full amount |
| Provider ghosts | Provider | Never delivers key | Auto-refund after timeout, consumer gets full refund |
| False reporting | Consumer | Reports less than actual | Provider can dispute or accept |
| Fee griefing | Either | Create many small escrows | Gas costs make it uneconomical |

### 5.3 Stress Tests

| Test | Load | Expected |
|------|------|----------|
| Many concurrent escrows | 50 simultaneous | All settle correctly, no race conditions |
| Maximum key creation | 20 keys/min (Venice limit) | Queue works, no errors |
| Large DIEM amounts | 100+ DIEM per escrow | Math correct, no overflow |
| Long duration | 30 day escrows | Time calculations correct |

---

## Phase 6: Security Tests

### 6.1 Access Control

| Test | Attempt | Expected |
|------|---------|----------|
| Non-owner withdraw fees | Random address calls `withdrawPlatformFees` | Reverts: "Ownable: caller is not the owner" |
| Non-provider withdraw | Consumer tries to call `withdrawProviderBalance` | Gets 0 (no balance) |
| Double fund | Consumer calls `fundEscrow` twice | Reverts: wrong status |
| Early release | Try to complete before funded | Reverts: wrong status |

### 6.2 Input Validation

| Test | Input | Expected |
|------|-------|----------|
| Overflow | Max uint256 values | Reverts or handles gracefully |
| Zero address | provider = address(0) | ✅ Reverts: "Invalid provider" (unit test) |
| Self escrow | provider = consumer | ✅ Reverts: "Cannot escrow with self" (unit test) |
| Excessive fees | Set platform fee to 50% | Reverts: exceeds max |

### 6.3 Reentrancy

| Test | Attack | Expected |
|------|--------|----------|
| Reentrancy on withdraw | Malicious provider contract | Blocked by `nonReentrant` modifier |

---

## Test Data

### Test Accounts

| Role | Address | Private Key | Funding |
|------|---------|-------------|---------|
| Deployer/Owner | Generate fresh | Save securely | 0.5 ETH + 100 USDC |
| Provider (Dave) | Your wallet | Already have | 0.1 ETH + DIEM staked |
| Consumer 1 | Generate fresh | For testing | 0.1 ETH + 50 USDC |
| Consumer 2 | Generate fresh | For testing | 0.1 ETH + 50 USDC |
| Attacker | Generate fresh | For testing | 0.1 ETH |

### Test USDC

On Base Sepolia, get test USDC from:
- [Base USDC Faucet](https://faucet.circle.com/) (if available)
- Or use the MockERC20 for initial testing

---

## Bug Reporting Template

When you find issues, document:

```markdown
**Test ID:** [from this doc]
**Severity:** Critical/High/Medium/Low
**Environment:** Local/Testnet
**Steps to Reproduce:**
1. Step one
2. Step two

**Expected:** What should happen
**Actual:** What actually happened
**Logs:** Relevant error messages, tx hashes
**Fix:** [if you know it]
```

---

## Sign-Off Checklist

Before mainnet deployment:

- [ ] All Phase 1 tests pass
- [ ] All Phase 2 tests pass
- [ ] All Phase 3 tests pass
- [ ] At least 10 end-to-end flows completed
- [ ] No Critical or High bugs open
- [ ] Gas optimization review complete
- [ ] Professional audit scheduled or complete
- [ ] Insurance/bug bounty considered

---

## Quick Test Commands

```bash
# 1. Run contract tests
cd contracts && npm test

# 2. Deploy to Sepolia
cd contracts && npm run deploy:testnet

# 3. Test CLI (after contract deployed)
cd cli && npm install
node provider-cli.js login
node provider-cli.js list --diem 1.0 --price 0.95

# 4. Test SDK
node -e "const {DACNConsumer} = require('./sdk/consumer'); console.log('SDK loads')"

# 5. Open frontend
cd frontend && python3 -m http.server 8080
# Then open http://localhost:8080
```

---

**Ready to start testing?** Grab your Sepolia ETH and let's run Phase 1!
