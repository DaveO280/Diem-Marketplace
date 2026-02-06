#!/usr/bin/env node
/**
 * DACN buyer flow test script.
 *
 * This uses the DACN backend + SDK (credits, not raw escrows) to simulate a full buyer journey:
 * 1. Use a fixed buyer address
 * 2. Browse listings from /api/listings
 * 3. Pick a listing/provider and request a credit via /api/credits/request
 * 4. Poll for the API key via /api/credits/:id/key (buyer-only, X-Buyer-Address header)
 * 5. (Optional) Hit Venice with the key and report usage back to DACN
 *
 * Run (example):
 *   API_URL=http://localhost:3000 LISTING_INDEX=0 node sdk/buyer-flow-test.js
 *
 * Use an existing credit (skip create, just get key + report usage):
 *   API_URL=http://localhost:3000 CREDIT_ID=<uuid> node sdk/buyer-flow-test.js
 *
 * NOTES:
 * - Without CREDIT_ID: assumes at least one listing; creates a new credit then polls for key.
 * - With CREDIT_ID: uses that credit for key retrieval and usage only.
 */

const { DACNConsumer, DACNCredit, DACNError } = require('./consumer');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const LISTING_INDEX = process.env.LISTING_INDEX || '0';
const CREDIT_ID = process.env.CREDIT_ID;
const BUYER_ADDRESS = '0xC9fFD981932FA4F91A0f31184264Ce079d196c48';
/** Usage to report per buy, in hundredths of DIEM (100 = 1 DIEM; 10 = 0.1 DIEM). Dollar amount depends on provider's rate. */
const USAGE_PER_BUY = 10;

async function main() {
  console.log('Buyer address:', BUYER_ADDRESS);

  const walletAdapter = {
    async getAddress() {
      return BUYER_ADDRESS;
    },
  };

  const client = new DACNConsumer({
    apiUrl: API_URL,
    wallet: walletAdapter,
  });

  let credit;
  let diemAmount;

  if (CREDIT_ID) {
    console.log('\n=== Using existing credit ===');
    console.log('Credit id:', CREDIT_ID);
    const result = await client._apiRequest(`/api/credits/${CREDIT_ID}`);
    const creditData = result.credit || result;
    if (!creditData.id) {
      console.error('Credit not found or invalid response');
      process.exit(1);
    }
    credit = new DACNCredit(creditData, client);
    diemAmount = credit.data.totalDiemAmount || 1;
  } else {
    console.log('\n=== Step 1: Browse listings ===');
    const listings = await client.browseListings();
    console.log('Found listings:', listings.length);
    if (!listings.length) {
      console.error('No listings available. Create a listing first.');
      process.exit(1);
    }

    const idx = parseInt(LISTING_INDEX, 10) || 0;
    if (idx < 0 || idx >= listings.length) {
      console.error(`LISTING_INDEX ${idx} out of range (0..${listings.length - 1})`);
      process.exit(1);
    }

    const listing = listings[idx];
    console.log('Using listing index', idx, '->', listing.id || '(no id)', 'providerId:', listing.providerId);

    diemAmount = listing.diemAmount;
    const durationDays = listing.defaultDurationDays || 1;

    console.log('\n=== Step 2: Request credit ===');
    credit = await client.requestCredit({
      providerId: listing.providerId,
      diemAmount,
      durationDays,
      listingId: listing.id,
    });
    console.log('Created credit id:', credit.id);
  }

  console.log('\n=== Step 3: Poll for API key (provider must deliver) ===');
  try {
    const apiKey = await credit.getVeniceApiKey(5000, 120); // poll up to ~10 min
    console.log('Got Venice API key:', apiKey.slice(0, 10) + '...');
  } catch (err) {
    if (err instanceof DACNError) {
      console.error('Error waiting for key:', err.code, err.message);
    } else {
      console.error('Unexpected error waiting for key:', err);
    }
    process.exit(1);
  }

  console.log('\n=== Step 4: (Optional) Report usage ===');
  try {
    const usageAmount = USAGE_PER_BUY; // 0.1 DIEM per buy
    const usageResult = await credit.reportUsage(usageAmount);
    console.log('Reported usage:', usageAmount, 'result:', usageResult);
  } catch (err) {
    if (err instanceof DACNError) {
      console.error('Error reporting usage:', err.code, err.message);
    } else {
      console.error('Unexpected error reporting usage:', err);
    }
  }

  console.log('\nBuyer flow test complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

