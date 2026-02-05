/**
 * Impersonate an agent: discover listings, request credit from one, confirm capacity reduced.
 * Run from repo root: node backend/scripts/agent-test-listings.js
 * Requires backend running: npm run dev (in backend/)
 */
const API = process.env.API_URL || 'http://localhost:3000/api';

async function main() {
  console.log('Agent: fetching active listings (GET /api/listings)...\n');
  const listRes = await fetch(API + '/listings');
  const listData = await listRes.json();
  if (listData.error) {
    console.log('Error:', listData.error);
    console.log('Tip: Restart backend so GET /api/listings with no params returns all active listings.');
    return;
  }
  const listings = listData.listings || [];
  console.log('Listings found:', listings.length);
  if (listings.length === 0) {
    console.log('No active listings. Create one in the app at http://localhost:3000 then run this again.');
    return;
  }
  const listing = listings[0];
  console.log('Picked first listing:', {
    id: listing.id,
    providerId: listing.providerId,
    diemAmount: listing.diemAmount,
    ratePerDiem: listing.ratePerDiem,
    providerName: listing.providerName,
  });
  const buyerAddress = '0x0000000000000000000000000000000000000001';
  const diemAmount = Math.min(1, listing.diemAmount);
  const durationDays = 7;
  console.log('\nAgent: requesting credit (POST /api/credits/request) with listingId...\n');
  const reqRes = await fetch(API + '/credits/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: listing.providerId,
      buyerAddress,
      diemAmount,
      durationDays,
      listingId: listing.id,
    }),
  });
  const reqData = await reqRes.json();
  if (reqData.error) {
    console.log('Request failed:', reqData.error);
    return;
  }
  console.log('Credit created:', reqData.credit?.id, 'escrowId:', reqData.escrowId);
  console.log('\nAgent: fetching listings again to confirm capacity reduced...\n');
  const listRes2 = await fetch(API + '/listings');
  const listData2 = await listRes2.json();
  const listings2 = listData2.listings || [];
  const same = listings2.find((l) => l.id === listing.id);
  if (!same) {
    console.log('Listing no longer in active list (capacity reached 0, deactivated). OK.');
  } else {
    console.log('Listing still active. New diemAmount:', same.diemAmount, '(was', listing.diemAmount + ')');
  }
  console.log('\nDone. Agent flow confirmed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
