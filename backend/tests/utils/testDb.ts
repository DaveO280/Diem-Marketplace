import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

let testDb: Database.Database | null = null;

export function getTestDb(): Database.Database {
  if (!testDb) {
    testDb = new Database(':memory:');
    
    // Run migrations
    const migrationPath = path.join(__dirname, '../../src/db/migrations');
    if (fs.existsSync(migrationPath)) {
      const files = fs.readdirSync(migrationPath).sort();
      for (const file of files) {
        if (file.endsWith('.sql')) {
          const sql = fs.readFileSync(path.join(migrationPath, file), 'utf8');
          testDb.exec(sql);
        }
      }
    }
  }
  return testDb;
}

export function resetTestDb(): void {
  if (testDb) {
    // Clear all tables
    const tables = testDb.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as { name: string }[];
    
    for (const { name } of tables) {
      testDb.prepare(`DELETE FROM ${name}`).run();
    }
    
    // Reset auto-increment counters
    for (const { name } of tables) {
      try {
        testDb.prepare(`DELETE FROM sqlite_sequence WHERE name='${name}'`).run();
      } catch {
        // Table might not have auto-increment
      }
    }
  }
}

export function closeTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}
