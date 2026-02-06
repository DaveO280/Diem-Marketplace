/**
 * E2E buyer flow – full lifecycle.
 * 1. Health → providers → quote → request credit
 * 2. Deliver key: if PROVIDER_PRIVATE_KEY set, call deliver + sign deliverKey on-chain + mark-delivered; else poll for key (manual deliver)
 * 3. Get key → confirm → report usage → complete
 *
 * Run: cd backend && node scripts/e2e-buyer-flow.js
 * Env:
 *   API_URL (default http://localhost:3000)
 *   BUYER_ADDRESS (default 0x00...01)
 *   PROVIDER_ID (optional; else first provider)
 *   PROVIDER_PRIVATE_KEY (optional; if set, script signs deliverKey and marks delivered)
 *   RPC_URL, CONTRACT_ADDRESS (required if PROVIDER_PRIVATE_KEY set)
 *   DIEM_AMOUNT, DURATION_DAYS (default 0.1, 1)
 *   USAGE_AMOUNT (hundredths of DIEM, e.g. 50 = 0.5; default 50)
 *   KEY_POLL_INTERVAL_MS, KEY_POLL_ATTEMPTS (default 5000, 24 = 2 min)
 */
const path = require('path');
const API_BASE = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
const BUYER_ADDRESS = process.env.BUYER_ADDRESS || '0x0000000000000000000000000000000000000001';
const PROVIDER_ID = process.env.PROVIDER_ID;
const DIEM_AMOUNT = parseFloat(process.env.DIEM_AMOUNT || '0.1');
const DURATION_DAYS = parseInt(process.env.DURATION_DAYS || '1', 10);
const USAGE_AMOUNT = parseInt(process.env.USAGE_AMOUNT || '50', 10); // hundredths
const KEY_POLL_INTERVAL_MS = parseInt(process.env.KEY_POLL_INTERVAL_MS || '5000', 10);
const KEY_POLL_ATTEMPTS = parseInt(process.env.KEY_POLL_ATTEMPTS || '24', 10);

function api(pathStr) {
  return `${API_BASE}${pathStr.startsWith('/') ? pathStr : '/' + pathStr}`;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || data.error || res.statusText);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function deliverKeyOnChain(escrowId, keyHash) {
  const { ethers } = require('ethers');
  const ABI = require(path.join(__dirname, '../src/abis/DiemCreditEscrow.json'));
  const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org';
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const providerPk = process.env.PROVIDER_PRIVATE_KEY;
  if (!contractAddress || !providerPk) {
    throw new Error('CONTRACT_ADDRESS and PROVIDER_PRIVATE_KEY are required for auto-deliver');
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(providerPk, provider);
  const contract = new ethers.Contract(contractAddress, ABI, wallet);
  const tx = await contract.deliverKey(escrowId, keyHash);
  await tx.wait();
  return tx.hash;
}

async function run() {
  console.log('E2E Buyer – full flow\n');
  console.log('API_BASE:', API_BASE);
  console.log('BUYER_ADDRESS:', BUYER_ADDRESS);
  console.log('DIEM_AMOUNT:', DIEM_AMOUNT, 'DURATION_DAYS:', DURATION_DAYS, 'USAGE_AMOUNT (hundredths):', USAGE_AMOUNT);
  console.log('');

  // 1. Health
  const healthRes = await fetch(api('/health'));
  if (!healthRes.ok) {
    throw new Error(`Health check failed: ${healthRes.status} ${await healthRes.text()}`);
  }
  const health = await healthRes.json();
  console.log('1. Health:', health.status);

  // 2. Providers
  const { providers } = await fetchJson(api('/api/providers'));
  const list = Array.isArray(providers) ? providers : [];
  if (list.length === 0) {
    throw new Error('No providers. Register a provider first.');
  }
  const providerId = PROVIDER_ID || list[0].id;
  const provider = list.find((p) => p.id === providerId) || list[0];
  console.log('2. Provider:', provider.id);

  // 3. Quote
  const { quote } = await fetchJson(
    api(`/api/credits/quote?providerId=${providerId}&diemAmount=${DIEM_AMOUNT}&durationDays=${DURATION_DAYS}`)
  );
  console.log('3. Quote: totalCost', quote.totalCost, 'USDC (wei)');

  // 4. Request credit
  const requestData = await fetchJson(api('/api/credits/request'), {
    method: 'POST',
    body: JSON.stringify({
      providerId,
      buyerAddress: BUYER_ADDRESS,
      diemAmount: DIEM_AMOUNT,
      durationDays: DURATION_DAYS,
    }),
  });
  const creditId = requestData.credit?.id;
  let escrowId = requestData.escrowId;
  if (!creditId || !escrowId) {
    throw new Error('Missing credit.id or escrowId: ' + JSON.stringify(requestData));
  }
  console.log('4. Credit requested:', creditId, 'escrowId:', escrowId);
  if (requestData.fundingError) {
    console.log('   fundingError:', requestData.fundingError);
  }

  // 5. Deliver key (auto or poll)
  const providerPk = process.env.PROVIDER_PRIVATE_KEY;
  if (providerPk) {
    console.log('5. Delivering key (provider signs on-chain)...');
    const deliverRes = await fetch(api(`/api/credits/${creditId}/deliver`), {
      method: 'POST',
      body: JSON.stringify({ escrowId }),
    });
    const deliverData = await deliverRes.json();
    if (deliverRes.ok && deliverData.keyHash) {
      await deliverKeyOnChain(escrowId, deliverData.keyHash);
      await fetch(api(`/api/credits/${creditId}/mark-delivered`), { method: 'POST' });
      console.log('   Key delivered and marked.');
    } else {
      throw new Error('Deliver failed: ' + JSON.stringify(deliverData));
    }
  } else {
    console.log('5. Polling for key (deliver via dashboard or set PROVIDER_PRIVATE_KEY)...');
    let key;
    for (let i = 0; i < KEY_POLL_ATTEMPTS; i++) {
      const keyRes = await fetch(api(`/api/credits/${creditId}/key`), {
        headers: { 'X-Buyer-Address': BUYER_ADDRESS },
      });
      if (keyRes.ok) {
        const keyData = await keyRes.json();
        if (keyData.apiKey) {
          key = keyData.apiKey;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, KEY_POLL_INTERVAL_MS));
    }
    if (!key) {
      throw new Error('Timeout waiting for API key. Deliver key via dashboard or set PROVIDER_PRIVATE_KEY.');
    }
    console.log('   Key received.');
  }

  // 6. Get key (if we didn't have it yet – auto path already has it stored; we need escrowId for confirm)
  const creditGet = await fetchJson(api(`/api/credits/${creditId}`));
  const credit = creditGet.credit || creditGet;
  if (credit.escrowId) escrowId = credit.escrowId;

  // 7. Confirm receipt
  await fetchJson(api(`/api/credits/${creditId}/confirm`), {
    method: 'POST',
    body: JSON.stringify({ escrowId }),
  });
  console.log('7. Confirmed receipt.');

  // 8. Report usage
  const usageRes = await fetchJson(api(`/api/credits/${creditId}/usage`), {
    method: 'POST',
    body: JSON.stringify({ usageAmount: USAGE_AMOUNT }),
  });
  console.log('8. Usage reported:', usageRes.credit?.actualUsage, 'status:', usageRes.status);

  // 9. Complete (if not already completed by reportUsage)
  const currentStatus = usageRes.credit?.status || usageRes.status;
  if (currentStatus !== 'completed') {
    const completeRes = await fetchJson(api(`/api/credits/${creditId}/complete`), {
      method: 'POST',
      body: JSON.stringify({ escrowId }),
    });
    console.log('9. Complete:', completeRes.status || completeRes.credit?.status);
  } else {
    console.log('9. Already completed.');
  }

  console.log('\nDone. Buyer E2E flow completed.');
}

run().catch((e) => {
  console.error(e.message || e);
  if (e.body) console.error(e.body);
  process.exit(1);
});
