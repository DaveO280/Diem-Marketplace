# DECAN API Server

Backend API for the DIEM Agent Credit Network (DECAN) — an API marketplace where Venice.ai DIEM token holders can monetize spare API capacity.

## Features

- **Provider Management**: Register, update, and manage DIEM providers
- **Credit Lifecycle**: Full escrow flow — quote, request, deliver, confirm, report, complete
- **Venice Integration**: Automatic generation of limited API keys with spend caps
- **Blockchain Sync**: Keeps local SQLite state in sync with on-chain escrow contract
- **Health Monitoring**: Built-in health check with blockchain connectivity status

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your keys and contract address

# Run database migrations
npm run db:migrate

# Start development server
npm run dev

# Or build and run production
npm run build
npm start
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3000) | No |
| `DATABASE_PATH` | SQLite database file path | No |
| `RPC_URL` | Base Sepolia RPC endpoint | Yes |
| `CONTRACT_ADDRESS` | Deployed DiemCreditEscrow address | Yes |
| `PRIVATE_KEY` | Server wallet private key | Yes |
| `VENICE_API_KEY` | Your Venice.ai API key | Yes |

## API Endpoints

### Health
- `GET /health` — Check server and blockchain connectivity

### Providers
- `GET /api/providers` — List active providers
- `GET /api/providers/:id` — Get provider details
- `POST /api/providers` — Register new provider
- `PATCH /api/providers/:id` — Update provider
- `GET /api/providers/:id/credits` — List provider's credits

### Credits
- `GET /api/credits/quote?providerId=...&diemAmount=...&durationDays=...` — Get quote
- `GET /api/credits?buyer=...` — List credits (filter by buyer, provider, or status)
- `GET /api/credits/:id` — Get credit details
- `POST /api/credits/request` — Create new credit (on-chain)
- `POST /api/credits/:id/deliver` — Deliver API key to buyer
- `POST /api/credits/:id/confirm` — Buyer confirms receipt
- `POST /api/credits/:id/usage` — Report actual usage
- `POST /api/credits/:id/complete` — Confirm usage, release funds
- `POST /api/credits/:id/cancel` — Cancel before delivery

## Credit Lifecycle

```
1. REQUEST → Buyer requests credit with diem amount + duration
2. CREATED → On-chain credit created, USDC held in escrow
3. KEY_DELIVERED → Provider creates Venice key, delivers hash on-chain
4. CONFIRMED → Buyer confirms receipt, can now use API key
5. USAGE_REPORTED → Actual consumption reported (both parties can report)
6. COMPLETED → Both confirm usage, escrow releases funds
```

## Architecture

- **Express.js** — HTTP server
- **Better-SQLite3** — Local database for providers and credit state
- **Ethers.js v6** — Blockchain interaction
- **Zod** — Input validation
- **Helmet + CORS + Rate Limiting** — Security

## Testing End-to-End

Once the server is running:

```bash
# 1. Create a provider
curl -X POST http://localhost:3000/api/providers \
  -H "Content-Type: application/json" \
  -d '{"address":"0x...","name":"Test Provider","maxDiemCapacity":100000,"ratePerDiem":1000}'

# 2. Get a quote
curl "http://localhost:3000/api/credits/quote?providerId=...&diemAmount=1000&durationDays=7"

# 3. Request credit (on-chain transaction)
curl -X POST http://localhost:3000/api/credits/request \
  -H "Content-Type: application/json" \
  -d '{"providerId":"...","buyerAddress":"0x...","diemAmount":1000,"durationDays":7}'

# 4. Provider delivers key
curl -X POST http://localhost:3000/api/credits/:id/deliver

# 5. Buyer confirms
curl -X POST http://localhost:3000/api/credits/:id/confirm

# 6. Report usage
curl -X POST http://localhost:3000/api/credits/:id/usage \
  -H "Content-Type: application/json" \
  -d '{"usageAmount":850,"reporter":"provider"}'

# 7. Complete (confirm usage)
curl -X POST http://localhost:3000/api/credits/:id/complete
```

## Notes

- The server wallet must have Sepolia ETH for gas
- USDC approval is handled automatically when creating credits
- Venice API keys are created with spend limits and expiration dates
- On-chain events are logged but not actively monitored in this version

## License

MIT
