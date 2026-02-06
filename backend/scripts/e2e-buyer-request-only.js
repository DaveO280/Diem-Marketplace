/**
 * E2E buyer flow – request only (smoke test).
 * 1. Health check
 * 2. List providers (or use PROVIDER_ID env)
 * 3. Get quote
 * 4. POST /api/credits/request
 *
 * Run: cd backend && node scripts/e2e-buyer-request-only.js
 * Env: API_URL (default http://localhost:3000), BUYER_ADDRESS, PROVIDER_ID (optional)
 */
const API_BASE = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
const BUYER_ADDRESS = process.env.BUYER_ADDRESS || '0x0000000000000000000000000000000000000001';
const PROVIDER_ID = process.env.PROVIDER_ID;
const DIEM_AMOUNT = parseFloat(process.env.DIEM_AMOUNT || '0.1');
const DURATION_DAYS = parseInt(process.env.DURATION_DAYS || '1', 10);

function api(path) {
  return `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;
}

async function run() {
  console.log('E2E Buyer (request only)\n');
  console.log('API_BASE:', API_BASE);
  console.log('BUYER_ADDRESS:', BUYER_ADDRESS);
  console.log('DIEM_AMOUNT:', DIEM_AMOUNT, 'DURATION_DAYS:', DURATION_DAYS);
  console.log('');

  // 1. Health
  const healthRes = await fetch(api('/health'));
  if (!healthRes.ok) {
    throw new Error(`Health check failed: ${healthRes.status} ${await healthRes.text()}`);
  }
  const health = await healthRes.json();
  console.log('1. Health:', health.status, health.blockchain?.blockNumber != null ? '(blockchain connected)' : '');

  // 2. Providers
  const providersRes = await fetch(api('/api/providers'));
  if (!providersRes.ok) {
    throw new Error(`Providers failed: ${providersRes.status} ${await providersRes.text()}`);
  }
  const { providers } = await providersRes.json();
  const list = Array.isArray(providers) ? providers : [];
  if (list.length === 0) {
    throw new Error('No providers. Register a provider first (e.g. via dashboard).');
  }
  const providerId = PROVIDER_ID || list[0].id;
  const provider = list.find((p) => p.id === providerId) || list[0];
  console.log('2. Provider:', provider.id, provider.name || provider.address);

  // 3. Quote
  const quoteRes = await fetch(
    api(`/api/credits/quote?providerId=${providerId}&diemAmount=${DIEM_AMOUNT}&durationDays=${DURATION_DAYS}`)
  );
  if (!quoteRes.ok) {
    throw new Error(`Quote failed: ${quoteRes.status} ${await quoteRes.text()}`);
  }
  const { quote } = await quoteRes.json();
  console.log('3. Quote: totalCost', quote.totalCost, 'USDC (wei)');

  // 4. Request credit
  const body = {
    providerId,
    buyerAddress: BUYER_ADDRESS,
    diemAmount: DIEM_AMOUNT,
    durationDays: DURATION_DAYS,
  };
  const requestRes = await fetch(api('/api/credits/request'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const requestData = await requestRes.json();
  if (requestData.error) {
    throw new Error('Request failed: ' + (requestData.error?.message || JSON.stringify(requestData.error)));
  }
  if (!requestRes.ok) {
    throw new Error(`Request failed: ${requestRes.status} ${JSON.stringify(requestData)}`);
  }
  console.log('4. Credit requested:', requestData.credit?.id);
  console.log('   escrowId:', requestData.escrowId);
  console.log('   nextStep:', requestData.nextStep || 'provider delivers key');
  if (requestData.fundingError) {
    console.log('   fundingError:', requestData.fundingError);
  }
  console.log('\nDone. Run e2e-buyer-flow.js for full flow (deliver → key → confirm → usage → complete).');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
