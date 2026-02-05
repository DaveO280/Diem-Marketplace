import { db } from '../db/connection';
import { Credit, CreditStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class CreditRepository {
  create(credit: Omit<Credit, 'id' | 'createdAt' | 'confirmedAt'>): Credit {
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO credits 
      (id, credit_id, provider_id, buyer_address, total_diem_amount, actual_usage, 
       duration_days, status, escrow_id, api_key, api_key_hash, created_at, expires_at, confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      credit.creditId && credit.creditId !== 0 ? credit.creditId : null,
      credit.providerId,
      credit.buyerAddress,
      credit.totalDiemAmount,
      credit.actualUsage ?? null,
      credit.durationDays,
      credit.status,
      credit.escrowId ?? null,
      credit.apiKey ?? null,
      credit.apiKeyHash ?? null,
      now,
      credit.expiresAt,
      null
    );

    return {
      ...credit,
      id,
      createdAt: now,
      confirmedAt: null,
    };
  }

  findById(id: string): Credit | null {
    const row = db.prepare('SELECT * FROM credits WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  findByCreditId(creditId: number): Credit | null {
    const row = db.prepare('SELECT * FROM credits WHERE credit_id = ?').get(creditId) as any;
    return row ? this.mapRow(row) : null;
  }

  findByBuyer(buyerAddress: string): Credit[] {
    const rows = db.prepare('SELECT * FROM credits WHERE buyer_address = ? ORDER BY created_at DESC').all(buyerAddress) as any[];
    return rows.map(this.mapRow);
  }

  findByProvider(providerId: string): Credit[] {
    const rows = db.prepare('SELECT * FROM credits WHERE provider_id = ? ORDER BY created_at DESC').all(providerId) as any[];
    return rows.map(this.mapRow);
  }

  findByStatus(status: CreditStatus): Credit[] {
    const rows = db.prepare('SELECT * FROM credits WHERE status = ? ORDER BY created_at DESC').all(status) as any[];
    return rows.map(this.mapRow);
  }

  updateStatus(id: string, status: CreditStatus, updates?: Partial<Credit>): Credit | null {
    const sets = ['status = ?'];
    const values: any[] = [status];

    if (updates?.actualUsage !== undefined) {
      sets.push('actual_usage = ?');
      values.push(updates.actualUsage);
    }
    if (updates?.apiKey !== undefined) {
      sets.push('api_key = ?');
      values.push(updates.apiKey);
    }
    if (updates?.apiKeyHash !== undefined) {
      sets.push('api_key_hash = ?');
      values.push(updates.apiKeyHash);
    }
    if (updates?.confirmedAt !== undefined) {
      sets.push('confirmed_at = ?');
      values.push(updates.confirmedAt);
    }
    if (updates?.escrowId !== undefined) {
      sets.push('escrow_id = ?');
      values.push(updates.escrowId);
    }

    values.push(id);

    const stmt = db.prepare(`UPDATE credits SET ${sets.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.findById(id);
  }

  updateCreditId(id: string, creditId: number): Credit | null {
    const stmt = db.prepare('UPDATE credits SET credit_id = ? WHERE id = ?');
    stmt.run(creditId, id);
    return this.findById(id);
  }

  private mapRow(row: any): Credit {
    return {
      id: row.id,
      creditId: row.credit_id ?? 0,
      providerId: row.provider_id,
      buyerAddress: row.buyer_address,
      totalDiemAmount: row.total_diem_amount,
      actualUsage: row.actual_usage,
      durationDays: row.duration_days,
      status: row.status as CreditStatus,
      escrowId: row.escrow_id ?? null,
      apiKey: row.api_key,
      apiKeyHash: row.api_key_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      confirmedAt: row.confirmed_at,
    };
  }
}

export const creditRepo = new CreditRepository();
