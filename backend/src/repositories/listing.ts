import { db } from '../db/connection';
import { Listing } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class ListingRepository {
  create(listing: Omit<Listing, 'id' | 'createdAt' | 'updatedAt'>): Listing {
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO listings (id, provider_id, diem_amount, rate_per_diem, min_purchase, max_purchase, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const isActive = listing.isActive !== false;
    stmt.run(
      id,
      listing.providerId,
      listing.diemAmount,
      listing.ratePerDiem,
      listing.minPurchase ?? null,
      listing.maxPurchase ?? null,
      isActive ? 1 : 0,
      now,
      now
    );

    return {
      ...listing,
      id,
      createdAt: now,
      updatedAt: now,
      isActive,
    };
  }

  findById(id: string): Listing | null {
    const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  findByProvider(providerId: string): Listing[] {
    const rows = db.prepare('SELECT * FROM listings WHERE provider_id = ? ORDER BY created_at DESC').all(providerId) as any[];
    return rows.map(this.mapRow);
  }

  findActiveByProvider(providerId: string): Listing[] {
    const rows = db.prepare('SELECT * FROM listings WHERE provider_id = ? AND is_active = 1 ORDER BY created_at DESC').all(providerId) as any[];
    return rows.map(this.mapRow);
  }

  /** All active listings (for agent / marketplace discovery) */
  findAllActive(): Listing[] {
    const rows = db.prepare('SELECT * FROM listings WHERE is_active = 1 ORDER BY created_at DESC').all() as any[];
    return rows.map(this.mapRow);
  }

  update(id: string, updates: Partial<Omit<Listing, 'id' | 'providerId' | 'createdAt' | 'updatedAt'>>): Listing | null {
    const listing = this.findById(id);
    if (!listing) return null;

    const sets: string[] = [];
    const values: any[] = [];

    if (updates.diemAmount !== undefined) {
      sets.push('diem_amount = ?');
      values.push(updates.diemAmount);
    }
    if (updates.ratePerDiem !== undefined) {
      sets.push('rate_per_diem = ?');
      values.push(updates.ratePerDiem);
    }
    if (updates.minPurchase !== undefined) {
      sets.push('min_purchase = ?');
      values.push(updates.minPurchase);
    }
    if (updates.maxPurchase !== undefined) {
      sets.push('max_purchase = ?');
      values.push(updates.maxPurchase);
    }
    if (updates.isActive !== undefined) {
      sets.push('is_active = ?');
      values.push(updates.isActive ? 1 : 0);
    }

    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const stmt = db.prepare(`UPDATE listings SET ${sets.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.findById(id);
  }

  delete(id: string): boolean {
    const result = db.prepare('DELETE FROM listings WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private mapRow(row: any): Listing {
    return {
      id: row.id,
      providerId: row.provider_id,
      diemAmount: row.diem_amount,
      ratePerDiem: row.rate_per_diem,
      minPurchase: row.min_purchase,
      maxPurchase: row.max_purchase,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const listingRepo = new ListingRepository();
