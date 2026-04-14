import Database from 'better-sqlite3';
import path from 'path';
import { RedPacket, Claim } from './types';

const DB_PATH = path.join(__dirname, '../../data/redpacket.db');

// Ensure data directory exists
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS packets (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    chain TEXT NOT NULL,
    chainId INTEGER NOT NULL,
    totalAmount TEXT NOT NULL,
    totalAmountWei TEXT NOT NULL,
    count INTEGER NOT NULL,
    splitType TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    agentWallet TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_funding',
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    claimedCount INTEGER NOT NULL DEFAULT 0,
    distributedAmount TEXT NOT NULL DEFAULT '0',
    envelopes TEXT NOT NULL  -- JSON array of pre-calculated amounts
  );

  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    packetId TEXT NOT NULL,
    recipientAddress TEXT NOT NULL,
    amount TEXT NOT NULL,
    amountWei TEXT NOT NULL,
    txHash TEXT,
    claimedAt INTEGER NOT NULL,
    FOREIGN KEY (packetId) REFERENCES packets(id)
  );

  CREATE INDEX IF NOT EXISTS idx_claims_packetId ON claims(packetId);
  CREATE INDEX IF NOT EXISTS idx_claims_recipient ON claims(recipientAddress);
`);

export function savePacket(packet: RedPacket & { envelopes: string[] }): void {
  const stmt = db.prepare(`
    INSERT INTO packets (id, token, chain, chainId, totalAmount, totalAmountWei, count, splitType,
      message, agentWallet, status, createdAt, expiresAt, claimedCount, distributedAmount, envelopes)
    VALUES (@id, @token, @chain, @chainId, @totalAmount, @totalAmountWei, @count, @splitType,
      @message, @agentWallet, @status, @createdAt, @expiresAt, @claimedCount, @distributedAmount, @envelopes)
  `);
  stmt.run({ ...packet, envelopes: JSON.stringify(packet.envelopes) });
}

export function getPacket(id: string): (RedPacket & { envelopes: string[] }) | undefined {
  const row = db.prepare('SELECT * FROM packets WHERE id = ?').get(id) as any;
  if (!row) return undefined;
  return { ...row, envelopes: JSON.parse(row.envelopes) };
}

export function getAllPackets(): RedPacket[] {
  return db.prepare('SELECT * FROM packets ORDER BY createdAt DESC').all() as RedPacket[];
}

export function updatePacketStatus(
  id: string,
  status: string,
  claimedCount: number,
  distributedAmount: string
): void {
  db.prepare(`
    UPDATE packets SET status = ?, claimedCount = ?, distributedAmount = ? WHERE id = ?
  `).run(status, claimedCount, distributedAmount, id);
}

export function saveClaim(claim: Claim): void {
  db.prepare(`
    INSERT INTO claims (id, packetId, recipientAddress, amount, amountWei, txHash, claimedAt)
    VALUES (@id, @packetId, @recipientAddress, @amount, @amountWei, @txHash, @claimedAt)
  `).run(claim);
}

export function getClaimsByPacket(packetId: string): Claim[] {
  // Exclude pending claims (txHash IS NULL) — these are mid-flight reservations
  return db.prepare('SELECT * FROM claims WHERE packetId = ? AND txHash IS NOT NULL ORDER BY claimedAt ASC').all(packetId) as Claim[];
}

export function hasRecipientClaimed(packetId: string, recipientAddress: string): boolean {
  const row = db.prepare(
    'SELECT id FROM claims WHERE packetId = ? AND recipientAddress = ?'
  ).get(packetId, recipientAddress.toLowerCase());
  return !!row;
}

/**
 * Atomically reserve a claim slot.
 * Inserts a pending claim record and increments claimedCount in one transaction.
 * Returns the claim id if successful, null if already claimed or no slots left.
 */
export function reserveClaimSlot(
  packetId: string,
  recipientAddress: string,
  claimId: string,
  amount: string,
  amountWei: string,
): { envelopeIndex: number } | null {
  const result = db.transaction(() => {
    const packet = db.prepare('SELECT * FROM packets WHERE id = ?').get(packetId) as any;
    if (!packet) return null;
    if (packet.claimedCount >= packet.count) return null;

    const alreadyClaimed = db.prepare(
      'SELECT id FROM claims WHERE packetId = ? AND recipientAddress = ?'
    ).get(packetId, recipientAddress);
    if (alreadyClaimed) return null;

    const envelopeIndex = packet.claimedCount;

    // Insert pending claim (txHash null = pending)
    db.prepare(`
      INSERT INTO claims (id, packetId, recipientAddress, amount, amountWei, txHash, claimedAt)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `).run(claimId, packetId, recipientAddress, amount, amountWei, Date.now());

    // Increment claimedCount immediately to block concurrent claims
    db.prepare(`
      UPDATE packets SET claimedCount = claimedCount + 1 WHERE id = ?
    `).run(packetId);

    return { envelopeIndex };
  })();

  return result ?? null;
}

export function updateClaimRecord(claimId: string, txHash: string, amount: string, amountWei: string): void {
  db.prepare('UPDATE claims SET txHash = ?, amount = ?, amountWei = ? WHERE id = ?').run(txHash, amount, amountWei, claimId);
}

export function deleteClaim(claimId: string): void {
  db.prepare('DELETE FROM claims WHERE id = ?').run(claimId);
}
