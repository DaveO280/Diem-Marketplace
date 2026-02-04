import { db } from '../db/connection';
import { Provider } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class ProviderRepository {
  create(provider: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Provider {
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO providers (id, address, name, max_diem_capacity, rate_per_diem, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const isActive = provider.isActive !== false;
    stmt.run(
      id,
      provider.address,
      provider.name,
      provider.maxDiemCapacity,
      provider.ratePerDiem,
      isActive ? 1 : 0,
      now,
      now
    );

    return {
      ...provider,
      id,
      createdAt: now,
      updatedAt: now,
      isActive,
    };
  }

  findById(id: string): Provider | null {
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  findByAddress(address: string): Provider | null {
    const row = db.prepare('SELECT * FROM providers WHERE address = ?').get(address) as any;
    return row ? this.mapRow(row) : null;
  }

  findActive(): Provider[] {
    const rows = db.prepare('SELECT * FROM providers WHERE is_active = 1').all() as any[];
    return rows.map(this.mapRow);
  }

  findAll(): Provider[] {
    const rows = db.prepare('SELECT * FROM providers').all() as any[];
    return rows.map(this.mapRow);
  }

  update(id: string, updates: Partial<Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>>): Provider | null {
    const provider = this.findById(id);
    if (!provider) return null;

    const sets: string[] = [];
    const values: any[] = [];

    if (updates.address !== undefined) {
      sets.push('address = ?');
      values.push(updates.address);
    }
    if (updates.name !== undefined) {
      sets.push('name = ?');
      values.push(updates.name);
    }
    if (updates.maxDiemCapacity !== undefined) {
      sets.push('max_diem_capacity = ?');
      values.push(updates.maxDiemCapacity);
    }
    if (updates.ratePerDiem !== undefined) {
      sets.push('rate_per_diem = ?');
      values.push(updates.ratePerDiem);
    }
    if (updates.isActive !== undefined) {
      sets.push('is_active = ?');
      values.push(updates.isActive ? 1 : 0);
    }

    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const stmt = db.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.findById(id);
  }

  delete(id: string): boolean {
    const result = db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private mapRow(row: any): Provider {
    return {
      id: row.id,
      address: row.address,
      name: row.name,
      maxDiemCapacity: row.max_diem_capacity,
      ratePerDiem: row.rate_per_diem,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const providerRepo = new ProviderRepository();
