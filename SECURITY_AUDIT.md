# Security Vulnerability Audit Report

**Project:** Diem-Marketplace (DACN - DIEM Agent Credit Network)
**Audit Date:** 2026-02-03
**Auditor:** Automated Security Scan
**Scope:** Smart contracts, CLI, SDK, and configuration files

---

## Executive Summary

This security audit identified **16 vulnerabilities** across the codebase:
- **Critical:** 3
- **High:** 4
- **Medium:** 5
- **Low:** 4

The most critical issues involve plaintext storage of private keys and incomplete implementations that could lead to fund loss.

---

## Critical Vulnerabilities

### CRIT-01: Plaintext Private Key Storage (CLI)

**Location:** `cli/provider-cli.js:127-133`

**Description:**
The CLI stores wallet private keys in plaintext on disk despite claiming they are "encrypted". The prompt message states "(encrypted)" but the actual implementation uses plain JSON:

```javascript
await saveConfig({
  apiKey: answers.apiKey,
  veniceApiKey: answers.veniceApiKey,
  walletPrivateKey: answers.walletPrivateKey,  // PLAINTEXT!
  providerAddress: new ethers.Wallet(answers.walletPrivateKey).address
});
```

**Impact:** Any local file system access (malware, shared machine, backup exposure) would expose wallet private keys, leading to complete fund theft.

**Recommendation:**
- Use system keychain (macOS Keychain, Windows Credential Manager, libsecret on Linux)
- Implement AES-256 encryption with user-provided password
- Never store private keys; use hardware wallets or signing services

**CVSS Score:** 9.1 (Critical)

---

### CRIT-02: Unimplemented Platform Fee Withdrawal

**Location:** `contracts/DiemCreditEscrow.sol:375-378`

**Description:**
The `withdrawPlatformFees()` function has no implementation:

```solidity
function withdrawPlatformFees() external onlyOwner {
    // This would track platform fees separately in production
    // For now, owner can withdraw any excess USDC
}
```

Platform fees are calculated in `_completeEscrow()` but never tracked or stored. The contract has no mechanism to track or withdraw platform revenue.

**Impact:** Platform fees are calculated but permanently lost/stuck in the contract. Additionally, the comment suggests owner could "withdraw any excess USDC" which is also not implemented, potentially locking funds forever.

**Recommendation:**
- Add `uint256 public platformFeeBalance` state variable
- Track fees in `_completeEscrow()`: `platformFeeBalance += platformFee`
- Implement actual withdrawal logic

**CVSS Score:** 8.5 (Critical)

---

### CRIT-03: Incomplete Withdrawal Implementation (CLI)

**Location:** `cli/provider-cli.js:421-427`

**Description:**
The withdraw command has the actual transaction call commented out:

```javascript
// Call withdraw on contract
console.log('Submitting withdrawal...');
// const tx = await escrowContract.withdrawProviderBalance();
// await tx.wait();

console.log('Withdrawal submitted!');
```

**Impact:** Users attempting to withdraw will see success messages but no funds will be transferred. This could lead to users believing their funds are secure when they are not.

**Recommendation:**
- Implement the contract interaction
- Add proper error handling
- Add transaction confirmation display

**CVSS Score:** 8.2 (Critical)

---

## High Severity Vulnerabilities

### HIGH-01: API Keys Stored in Plaintext Configuration

**Location:** `cli/provider-cli.js:127-133`

**Description:**
Venice Admin API keys and DACN API keys are stored in plaintext in `~/.dacn/config.json`. Venice Admin keys have elevated privileges including the ability to create and manage API keys.

**Impact:** Compromised Venice Admin key could allow attacker to:
- Create unlimited API keys
- Access billing information
- Potentially exhaust DIEM balances

**Recommendation:**
- Use OS-level secure credential storage
- Implement token refresh mechanisms
- Consider short-lived tokens with refresh capability

**CVSS Score:** 7.8 (High)

---

### HIGH-02: Centralized Dispute Resolution

**Location:** `contracts/DiemCreditEscrow.sol:293-316`

**Description:**
Disputes are resolved entirely by the contract owner with no constraints:

```solidity
function resolveDispute(
    bytes32 _escrowId,
    uint256 _providerAmount,
    uint256 _consumerAmount
) external onlyOwner inStatus(_escrowId, Status.Disputed) {
    // Owner can arbitrarily distribute funds
}
```

**Impact:**
- Single point of trust/failure
- Owner could act maliciously or be compromised
- No transparency or accountability in dispute resolution

**Recommendation:**
- Implement multi-sig requirement for disputes
- Add time-locked dispute resolution
- Consider decentralized arbitration (Kleros, UMA)
- Add event logs for dispute reasoning

**CVSS Score:** 7.5 (High)

---

### HIGH-03: Honest Oracle Model Vulnerability

**Location:** `contracts/DiemCreditEscrow.sol:195-221`

**Description:**
The usage reporting system relies on both parties honestly reporting the same usage. If they disagree, there's no automatic resolution:

```solidity
require(escrow.reportedUsage == _usage, "Usage mismatch");
```

A disagreement forces a dispute, but consumers could simply never report usage, forcing providers to wait for `autoComplete()`.

**Impact:**
- Providers must wait 2+ hours even for dishonest consumers
- No penalty for consumers who ghost
- Creates griefing opportunity

**Recommendation:**
- Integrate with Venice API for verifiable usage data
- Add consumer deposit/stake that's slashed for non-reporting
- Implement cryptographic proofs of usage

**CVSS Score:** 7.2 (High)

---

### HIGH-04: Missing Rate Limiting for Venice API Key Creation

**Location:** `cli/provider-cli.js:336-358`

**Description:**
Venice has a 20 keys/minute rate limit (per PROJECT.md), but the CLI has no rate limiting implemented. Rapid escrow acceptance could trigger Venice API failures.

**Impact:**
- Denial of service for providers
- Failed key deliveries could leave escrows in limbo
- Potential reputation damage from failed deliveries

**Recommendation:**
- Implement client-side rate limiting
- Add retry logic with exponential backoff
- Queue key creation requests

**CVSS Score:** 7.0 (High)

---

## Medium Severity Vulnerabilities

### MED-01: No Input Validation on Duration

**Location:** `contracts/DiemCreditEscrow.sol:104-144`

**Description:**
The `createEscrow()` function accepts any duration value without maximum bounds:

```solidity
uint256 duration = _duration == 0 ? defaultDuration : _duration;
```

**Impact:** Extremely long durations could lock funds indefinitely or create unreasonable escrow terms.

**Recommendation:**
```solidity
require(_duration <= 30 days, "Duration too long");
```

**CVSS Score:** 5.5 (Medium)

---

### MED-02: Missing Nonce Validation

**Location:** `contracts/DiemCreditEscrow.sol:117-123`

**Description:**
Escrow IDs are generated using `block.timestamp` and nonces. While nonces prevent simple collisions, the timestamp is manipulable by miners within bounds.

```solidity
escrowId = keccak256(abi.encodePacked(
    msg.sender,
    _provider,
    _diemLimit,
    block.timestamp,  // Manipulable
    consumerNonces[msg.sender]++
));
```

**Impact:** Low probability ID collision or manipulation, but theoretically possible.

**Recommendation:**
- Remove `block.timestamp` from ID generation
- Use `blockhash(block.number - 1)` or chainlink VRF for additional entropy

**CVSS Score:** 5.3 (Medium)

---

### MED-03: SDK Undefined Constants

**Location:** `sdk/consumer.js:92-108`

**Description:**
The SDK references undefined constants that would cause runtime failures:

```javascript
const usdcContract = new ethers.Contract(
  USDC_ADDRESS,      // UNDEFINED
  ERC20_ABI,         // UNDEFINED
  this.wallet
);
// ...
const escrowContract = new ethers.Contract(
  ESCROW_CONTRACT_ADDRESS,  // UNDEFINED
  ESCROW_ABI,               // UNDEFINED
  this.wallet
);
```

**Impact:** SDK is non-functional without proper initialization. Users integrating this would experience cryptic errors.

**Recommendation:**
- Add configuration validation in constructor
- Throw descriptive errors for missing configuration
- Document required configuration

**CVSS Score:** 5.0 (Medium)

---

### MED-04: No Response Status Validation

**Location:** `sdk/consumer.js:41-46, 62-76`

**Description:**
API responses are consumed without checking HTTP status codes:

```javascript
const response = await fetch(`${this.apiUrl}/listings?${params}`, {
  headers: { 'Authorization': `Bearer ${this.apiKey}` }
});
return response.json();  // No status check!
```

**Impact:** Error responses would be parsed as valid data, potentially causing downstream failures or security issues.

**Recommendation:**
```javascript
if (!response.ok) {
  throw new Error(`API error: ${response.status}`);
}
```

**CVSS Score:** 4.8 (Medium)

---

### MED-05: API Key Hash Never Verified

**Location:** `contracts/DiemCreditEscrow.sol:176-188`

**Description:**
The contract stores `apiKeyHash` but never uses it for verification:

```solidity
escrow.apiKeyHash = _apiKeyHash;
```

The hash is stored but there's no mechanism to verify the delivered key matches this hash during dispute resolution.

**Impact:** The hash provides no actual security benefit in its current form.

**Recommendation:**
- Add verification function for dispute resolution
- Document the intended use case
- Consider removing if not needed (gas savings)

**CVSS Score:** 4.5 (Medium)

---

## Low Severity Vulnerabilities

### LOW-01: Overlapping Timeout Windows

**Location:** `contracts/DiemCreditEscrow.sol:322-356`

**Description:**
Multiple timeout windows overlap in confusing ways:
- Key delivery: 1 hour after funding
- Usage reporting: 1 hour after end time
- Dispute window: 24 hours after end time
- Auto-complete: 2 hours after end time

**Impact:** User confusion about which actions are available when.

**Recommendation:**
- Document timeout behavior clearly
- Consider simplifying to non-overlapping windows
- Add view functions to check available actions

**CVSS Score:** 3.5 (Low)

---

### LOW-02: Non-upgradeable Contract

**Location:** `contracts/DiemCreditEscrow.sol` (entire file)

**Description:**
The contract has no upgrade mechanism. Any bugs or policy changes require redeployment.

**Impact:**
- Active escrows would be affected by migration
- Emergency fixes cannot be deployed quickly

**Recommendation:**
- Consider proxy pattern (UUPS or Transparent Proxy)
- Implement emergency pause functionality
- Add migration functions for future upgrades

**CVSS Score:** 3.3 (Low)

---

### LOW-03: Hardcoded RPC URL in CLI

**Location:** `cli/provider-cli.js:392`

**Description:**
The withdraw command uses hardcoded RPC endpoint:

```javascript
const provider = new ethers.providers.JsonRpcProvider('https://sepolia.base.org');
```

**Impact:**
- Will break on mainnet deployment
- No fallback for RPC failures
- Inconsistent with environment variable pattern used elsewhere

**Recommendation:**
- Use `process.env.RPC_URL` or configuration
- Add RPC URL to config file
- Implement fallback RPC providers

**CVSS Score:** 3.0 (Low)

---

### LOW-04: Missing File Permission Restrictions

**Location:** `cli/provider-cli.js:39-42`

**Description:**
Config file is written without restrictive permissions:

```javascript
await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
```

**Impact:** Other users on shared systems could potentially read the config file.

**Recommendation:**
```javascript
await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
```

**CVSS Score:** 2.8 (Low)

---

## Informational Issues

### INFO-01: Test Coverage Gaps

**Location:** `test/DiemCreditEscrow.test.js`

**Description:**
The test suite doesn't cover:
- Dispute resolution flow
- `refundExpired()` function
- `autoComplete()` function
- Fee configuration updates
- Edge cases with zero values

**Recommendation:**
Add comprehensive test coverage for all functions and edge cases.

---

### INFO-02: Missing Events for Configuration Changes

**Location:** `contracts/DiemCreditEscrow.sol:383-392`

**Description:**
The `updateFees()` function doesn't emit events:

```solidity
function updateFees(uint256 _platformFeeBps, uint256 _unusedPenaltyBps)
    external
    onlyOwner
{
    require(_platformFeeBps <= 500, "Platform fee max 5%");
    require(_unusedPenaltyBps <= 2000, "Penalty max 20%");

    platformFeeBps = _platformFeeBps;
    unusedPenaltyBps = _unusedPenaltyBps;
    // No event emitted!
}
```

**Recommendation:**
Add `event FeesUpdated(uint256 platformFeeBps, uint256 unusedPenaltyBps)`.

---

### INFO-03: Solidity Version Considerations

**Location:** `contracts/DiemCreditEscrow.sol:2`

**Description:**
Using `pragma solidity ^0.8.19` allows floating version which could introduce inconsistencies.

**Recommendation:**
Lock to specific version: `pragma solidity 0.8.19;`

---

## Dependency Analysis

### contracts/package.json

| Dependency | Version | Status |
|------------|---------|--------|
| @openzeppelin/contracts | ^5.0.0 | Review for latest patches |
| hardhat | ^2.19.0 | Development only |
| dotenv | ^16.3.1 | Development only |

### cli/package.json

| Dependency | Version | Notes |
|------------|---------|-------|
| ethers | ^5.7.0 | Consider upgrading to v6 |
| axios | ^1.6.0 | Check for security advisories |
| commander | ^11.0.0 | No known issues |
| inquirer | ^9.0.0 | No known issues |

**Recommendation:** Run `npm audit` regularly and update dependencies.

---

## Configuration Security

### Positive Findings

1. `.gitignore` properly excludes `.env` files
2. `.env.example` uses placeholder values
3. Private keys are read from environment variables in deployment scripts

### Issues Found

1. Config file permissions not restricted (see LOW-04)
2. No validation of environment variables before use
3. Hardcoded testnet USDC addresses could be confusing for mainnet deployment

---

## Summary of Recommendations

### Immediate Actions (Critical)

1. **Implement proper credential encryption** in the CLI
2. **Complete the `withdrawPlatformFees()` implementation** or document the intended behavior
3. **Implement the withdraw command** properly in the CLI

### Short-term Actions (High)

4. Add multi-sig or time-lock for dispute resolution
5. Implement rate limiting for Venice API key creation
6. Add verifiable usage reporting mechanism

### Medium-term Actions

7. Add comprehensive input validation
8. Fix SDK configuration issues
9. Add response validation in SDK
10. Consider contract upgradeability

### Ongoing

11. Regular dependency audits
12. Comprehensive test coverage
13. Security-focused code review for all changes

---

## Conclusion

This codebase is in **early development/MVP stage** and should **not be deployed to mainnet** without addressing at least all Critical and High severity issues. The fundamental architecture is sound, but several implementation gaps create significant security risks.

The most urgent issue is the plaintext storage of private keys in the CLI, which could lead to immediate fund loss if exploited.

---

*This report was generated as part of an automated security scan. A professional audit by a specialized smart contract security firm is recommended before any mainnet deployment.*
