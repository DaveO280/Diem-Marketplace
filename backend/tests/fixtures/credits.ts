export const testCreditRequest = {
  providerId: '', // Will be set after provider creation
  buyerAddress: '0xBuyer12345678901234567890123456789012345678',
  diemAmount: 5000, // $50 in cents
  durationDays: 7
};

export const testCreditRequestLarge = {
  providerId: '',
  buyerAddress: '0xBuyerLarge12345678901234567890123456789012',
  diemAmount: 100000, // $1000
  durationDays: 30
};

export const invalidCreditRequest = {
  providerId: 'invalid-uuid',
  buyerAddress: 'not-an-address',
  diemAmount: 0,
  durationDays: 0
};

export const testCreditExceedsCapacity = {
  providerId: '',
  buyerAddress: '0xBuyer12345678901234567890123456789012345678',
  diemAmount: 200000, // $2000 - exceeds most test providers
  durationDays: 7
};
