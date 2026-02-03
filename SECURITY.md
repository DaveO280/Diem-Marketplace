# Security Considerations

This document outlines known security issues and mitigations for the DACN protocol.

**⚠️ WARNING: This codebase has not been audited. Use at your own risk.**

## Known Issues

### Critical (Fixed or Acknowledged)

| Issue | Status | Mitigation |
|-------|--------|------------|
| **CRIT-01: Plaintext Private Key Storage** | ⚠️ Partial | CLI now sets 0600 file permissions. Full encryption requires OS keychain integration (TODO). |
| **CRIT-02: Unimplemented Fee Withdrawal** | ✅ Fixed | Contract now tracks and allows fee withdrawal |
| **CRIT-03: Incomplete Withdraw Command** | ✅ Fixed | CLI now actually submits blockchain transactions |

### High (Accepted or Mitigated)

| Issue | Status | Mitigation |
|-------|--------|------------|
| **HIGH-01: API Keys in Plaintext** | ⚠️ Accepted | Stored locally only, restrictive permissions. Use dedicated Venice keys (not admin keys). |
| **HIGH-02: Centralized Dispute Resolution** | ⚠️ Accepted | Owner can resolve disputes. Mitigation: Use timelock + multisig in production. |
| **HIGH-03: Honest Oracle Griefing** | ⚠️ Accepted | One party can grief by not confirming. Mitigation: Auto-complete after timeout. |
| **HIGH-04: No Rate Limiting** | ⚠️ Accepted | Venice API limits (20/min) are external. Monitor and queue requests. |

### Medium/Low (Accepted for MVP)

- No max duration validation (griefing vector - mitigated by economic cost)
- Non-upgradeable contract (intentional for trustlessness)
- Timestamp-based ID (minor manipulation risk - acceptable)
- Hardcoded RPC URL (can override via env var)

## Recommendations for Production

### Before Mainnet Deployment

1. **Security Audit**: Hire professional auditors (e.g., OpenZeppelin, Trail of Bits)
2. **Bug Bounty**: Run Immunefi or similar program
3. **Timelock**: Add 24-48 hour delay to owner functions
4. **Multisig**: Use Gnosis Safe for owner instead of EOA
5. **Monitoring**: Set up alerts for unusual activity
6. **Circuit Breaker**: Add pause functionality for emergencies

### Key Management

**Current (MVP):**
- Keys stored in ~/.dacn/config.json with 0600 permissions
- Acceptable for testnet/small amounts

**Production:**
- Hardware wallets (Ledger, Trezor)
- AWS KMS / HashiCorp Vault
- MPC solutions (Fireblocks, Qredo)

### Venice API Key Security

- Use **dedicated Venice accounts** (not your main)
- Create **INFERENCE-only keys** (not admin keys)
- Monitor key usage via Venice dashboard
- Revoke keys immediately if compromised

## Threat Model

### Provider Risks
| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| Key theft | Medium | High | Dedicated accounts, monitoring |
| Burn attacks | Low | Medium | Daily limits enforce natural caps |
| Chargebacks | N/A | N/A | Crypto-only, no chargebacks |

### Consumer Risks
| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| Key doesn't work | Low | Low | Escrow holds funds until verified |
| Provider disappears | Low | Medium | Automatic refund after timeout |
| Over-charging | Low | Low | Precise usage reporting |

### Platform Risks
| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| Smart contract bug | Medium | Critical | Audits, bug bounties, insurance |
| Owner key compromise | Low | Critical | Multisig, timelock |
| Venice shuts down API | Low | High | Diversify to other providers (future) |

## Incident Response

If you discover a vulnerability:

1. **Do NOT** open a public issue
2. Email: [your-security-email@example.com]
3. Allow 48-72 hours for response
4. Responsible disclosure appreciated

## Insurance

Consider:
- Nexus Mutual coverage
- Sherlock/Immunefi bug bounties
- Self-insurance fund from platform fees

## Disclaimer

This is experimental software. By using DACN, you acknowledge:

- Funds may be lost due to bugs
- Smart contracts are non-upgradeable
- No formal audit has been completed
- You use this at your own risk

**Start small. Test thoroughly. Never risk more than you can afford to lose.**

## Security Changelog

| Date | Change |
|------|--------|
| 2026-02-03 | Added file permission restrictions (0600) |
| 2026-02-03 | Implemented fee withdrawal |
| 2026-02-03 | Fixed CLI withdraw to submit transactions |
