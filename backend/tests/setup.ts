import { db } from '../src/db/connection';

// Global test setup
beforeAll(async () => {
  // Run migrations on test database
  const fs = require('fs');
  const path = require('path');
  
  const migrationPath = path.join(__dirname, '../src/db/migrations');
  const files = fs.readdirSync(migrationPath).sort();
  
  for (const file of files) {
    if (file.endsWith('.sql')) {
      const sql = fs.readFileSync(path.join(migrationPath, file), 'utf8');
      db.exec(sql);
    }
  }
});

// Clean up between tests
afterEach(() => {
  // Clear test data but keep schema
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all() as { name: string }[];
  
  for (const { name } of tables) {
    db.prepare(`DELETE FROM ${name}`).run();
  }
});

// Close database after all tests
afterAll(() => {
  db.close();
});
