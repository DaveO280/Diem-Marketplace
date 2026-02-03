# DIEM Agent Credit Network (DACN)

> A peer-to-peer API credit marketplace for AI agents on Venice.ai

[![Base](https://img.shields.io/badge/Base-0052FF?style=flat&logo=base&logoColor=white)](https://base.org)
[![Venice](https://img.shields.io/badge/Venice-AI-orange)](https://venice.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What is DACN?

DACN lets AI agents rent Venice.ai API capacity from DIEM token holders. It's like "Airbnb for API credits" — designed specifically for autonomous agents, not humans.

### Why Agents?

- **Precise tracking**: Agents self-report exact usage via API headers
- **No disputes**: Code doesn't lie
- **Automated**: Everything happens programmatically
- **Lower trust**: Honest oracle model works because agents are deterministic

## Quick Start

### For Consumers (Agents)

```bash
npm install dacn-sdk
```

```javascript
import { DACNConsumer } from 'dacn-sdk';

const dacn = new DACNConsumer({
  apiKey: 'your_api_key',
  wallet: yourEvmWallet
});

// Request $0.50 of API credit
const credit = await dacn.requestCredit({
  diemAmount: 0.5,
  maxPrice: 0.95  // USDC per DIEM
});

// Get Venice API key
const veniceKey = await credit.getVeniceApiKey();

// Use it
const response = await credit.veniceRequest('/chat/completions', {
  method: 'POST',
  body: JSON.stringify({
    model: 'llama-3.3-70b',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});

// Report usage when done
await credit.reportUsage(0.32);  // Used $0.32
```

### For Providers (DIEM Holders)

```bash
npm install -g dacn-cli

dacn login
dacn provider init
dacn provider list --diem 5.0 --price 0.95
```

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Provider   │────▶│    DACN     │◀────│  Consumer   │
│ (DIEM +   ) │     │  Platform   │     │   (Agent)   │
│   API key)  │◀────│             │────▶│             │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │  1. List capacity │                   │
       │──────────────────▶│                   │
       │                   │  2. Request & pay │
       │                   │◀──────────────────│
       │  3. Create key    │                   │
       │◀──────────────────│                   │
       │                   │  4. Use API       │
       │───────────────────────────────────────▶│
       │                   │  5. Report usage  │
       │◀───────────────────────────────────────│
       │  6. Get paid      │                   │
       │◀──────────────────│                   │
```

## Architecture

### Smart Contracts (Base Network)

- **DiemCreditEscrow.sol**: Handles USDC escrow, fee distribution, and dispute resolution
- **1% platform fee**, **5% unused penalty**
- Honest oracle model with automated settlement

See [contracts/](contracts/) for full implementation.

### API

RESTful API for:
- Listing discovery
- Escrow creation/management
- Key delivery
- Usage reporting

See [PROJECT.md](PROJECT.md) for full API spec.

### SDK

- **Consumer SDK**: For agents requesting credit
- **Provider SDK**: For automating key creation

See [sdk/](sdk/) for implementations.

## Fees

| Type | Amount | Notes |
|------|--------|-------|
| Platform fee | 1% | Taken from used portion only |
| Unused penalty | 5% | Consumer pays if they don't use credit |
| Gas | Variable | Base network, typically <$0.01 |

## Project Status

**Phase**: Design & Research

- [x] Architecture design
- [x] Smart contract draft
- [x] API specification
- [x] SDK mockup
- [ ] Venice ToS verification
- [ ] Testnet deployment
- [ ] Security audit
- [ ] Beta launch

## Requirements

- Venice.ai account with API access
- Base network wallet (for USDC)
- DIEM tokens (for providers)

## Documentation

- [PROJECT.md](PROJECT.md) - Full technical specification
- [contracts/DiemCreditEscrow.sol](contracts/DiemCreditEscrow.sol) - Smart contract
- [sdk/consumer.js](sdk/consumer.js) - Consumer SDK

## Contributing

This is early-stage research. Feedback welcome via issues.

## License

MIT

## Disclaimer

This is experimental software. Use at your own risk. Not affiliated with Venice.ai.
