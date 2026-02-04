export const testProvider = {
  address: '0x742d35ccC9A5f17C5C4d7B8cE5aF4b3d3B9135A6',
  name: 'Test Provider',
  maxDiemCapacity: 100000, // $1000 in cents
  ratePerDiem: 950, // $0.95 per DIEM
  webhookUrl: 'https://example.com/webhook'
};

export const testProvider2 = {
  address: '0x8ba1f109551bD432803012645Hac136c98C3f3B7',
  name: 'Second Provider',
  maxDiemCapacity: 50000,
  ratePerDiem: 900,
  webhookUrl: null
};

export const invalidProvider = {
  address: 'invalid-address',
  name: '',
  maxDiemCapacity: -100,
  ratePerDiem: 2000 // Too high
};
