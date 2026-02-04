# DACN Security Checklist

## ✅ Fixed Issues

### 1. Backend CORS Restricted
**Before:** `app.use(cors())` - Open to any origin
**After:** Restricted to localhost in development, env-controlled in production
**File:** `backend/src/index.ts`, `backend/src/security.ts`

### 2. Backend Private Key Warning
**Before:** Silent use of PRIVATE_KEY from .env
**After:** Startup warning showing wallet address, testnet/mainnet detection
**File:** `backend/src/security.ts`

### 3. Database Path Validation
**Before:** Any path accepted via DATABASE_PATH
**After:** Validates path doesn't contain '..' or system directories
**File:** `backend/src/security.ts`

### 4. Deploy Script Safety
**Before:** Could accidentally deploy to mainnet with loaded key
**After:** Pre-deploy check blocks mainnet without CONFIRM_MAINNET_DEPLOY=true
**File:** `contracts/scripts/deploy-warning.js`

---

## ⏳ Manual Steps Required

### 5. CLI Security Notice (provider-cli.js)
**To add manually:** Insert at line 35 (after `const program = new Command();`):
```javascript
// Security warning on first run
console.log(`
╔═══════════════════════════════════════════════════════════╗
║  DACN Provider CLI - Security Notice                      ║
╠═══════════════════════════════════════════════════════════╣
║  • Keys are encrypted but stored on your machine          ║
║  • Use a TEST wallet - never your mainnet hoard wallet    ║
║  • Config stored at: ~/.dacn/config.json                  ║
║  • Encryption is obfuscation - other processes can read   ║
╚═══════════════════════════════════════════════════════════╝
`);
```

### 6. Frontend localStorage Warning (dashboard.html)
**To add manually:** In `ConnectWallet()` function, add after the button:
```html
<div class="mt-6 p-4 bg-yellow-50 rounded-lg text-left">
  <p class="text-xs text-yellow-800">
    <strong>⚠️ Security Notice:</strong> This app stores your Venice API key in browser localStorage. 
    Use a test/low-value key only. Any script on this domain could access it.
  </p>
</div>
```

---

## 📋 Running Securely

### Environment Setup
```bash
# .env for DEVELOPMENT (safe)
NODE_ENV=development
PRIVATE_KEY=<testnet_wallet_with_no_real_funds>
RPC_URL=https://sepolia.base.org
CONTRACT_ADDRESS=0x648877Fcc28536e37BDb10c702156d8C2F0d0159

# .env for PRODUCTION (DANGER - use dedicated wallet only)
NODE_ENV=production
PRIVATE_KEY=<dedicated_backend_wallet_never_personal>
RPC_URL=https://mainnet.base.org
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

### Before Any Deployment
```bash
# 1. Double-check network
npm run deploy:testnet  # ✅ Safe

# To deploy mainnet (requires explicit confirmation):
export CONFIRM_MAINNET_DEPLOY=true
npm run deploy:mainnet  # 🚨 Uses real funds
```

### CLI Usage
```bash
# Always use a test wallet
dacn-provider login
# Enter: test wallet private key (not your main wallet!)

# Config stored at ~/.dacn/config.json
# - Encrypted but not bulletproof
# - Treat as readable by any process on your machine
```

### Frontend Usage
```
When connecting wallet:
- Use a test/low-value Venice API key
- Key is stored in localStorage (any XSS/extension can read it)
- Don't use a key that can incur large DIEM costs
```

---

## 🔒 Security Summary

| Risk Level | Issue | Mitigation |
|------------|-------|------------|
| **HIGH** | Wallet private key in backend | ✅ Startup warnings, testnet checks |
| **HIGH** | Accidental mainnet deploy | ✅ Deploy script blocks without confirmation |
| **HIGH** | Open CORS | ✅ Restricted to localhost |
| **MEDIUM** | CLI key storage | ⚠️ Manual: Add warning, use test wallet |
| **MEDIUM** | DB path traversal | ✅ Path validation in security.ts |
| **MEDIUM** | Frontend localStorage | ⚠️ Manual: Add warning banner |
| **LOW** | Secrets in repo | ✅ Already in .gitignore |
| **LOW** | Port 3000 exposure | N/A - Standard development port |

---

## 🚨 Emergency Contacts

If you accidentally:
- Deploy to mainnet with wrong contract
- Expose a private key
- Fund the wrong wallet

1. **Revoke key immediately** if possible
2. **Move funds** from exposed wallet
3. **Rotate all API keys**
4. **Review Git history** for accidental commits
