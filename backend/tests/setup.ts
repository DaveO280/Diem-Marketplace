import { db, initializeDatabase } from '../src/db/connection';

// Global test setup: use same schema as app (no migrations folder)
beforeAll(() => {
  initializeDatabase();
});

// Clean up between tests (delete in FK order to avoid constraint failures)
const TEARDOWN_ORDER = ['usage_reports', 'api_keys', 'credits', 'providers', 'webhook_deliveries'];
afterEach(() => {
  for (const name of TEARDOWN_ORDER) {
    try {
      db.prepare(`DELETE FROM ${name}`).run();
    } catch {
      // Table may not exist in older schemas
    }
  }
});

// Close database after all tests
afterAll(() => {
  db.close();
});
