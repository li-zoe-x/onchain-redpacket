import express from 'express';
import cors from 'cors';
import path from 'path';
import { createPacket, getPacketInfo, listPackets, claimPacket, activatePacket } from './redpacket';
import { getAgentAddress, getTokenBalance } from './onchainos';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));

  // ─── Wallet Info ───────────────────────────────────────────────────────────
  app.get('/api/wallet', async (_req, res) => {
    try {
      const evmAddress = await getAgentAddress('xlayer');
      const solAddress = await getAgentAddress('solana');
      const balances: Record<string, string> = {};

      const checks: Array<{ chain: string; token: string; addr: string }> = [
        { chain: 'xlayer',  token: 'OKB',  addr: evmAddress },
        { chain: 'xlayer',  token: 'USDC', addr: evmAddress },
        { chain: 'solana',  token: 'SOL',  addr: solAddress },
        { chain: 'solana',  token: 'USDC', addr: solAddress },
      ];

      await Promise.all(checks.map(async ({ chain, token, addr }) => {
        try {
          balances[`${chain}:${token}`] = await getTokenBalance(chain, addr, token);
        } catch {
          balances[`${chain}:${token}`] = 'unavailable';
        }
      }));

      res.json({
        xlayer: { address: evmAddress },
        solana: { address: solAddress },
        balances,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Create Red Packet ─────────────────────────────────────────────────────
  app.post('/api/packets', async (req, res) => {
    try {
      const { token, chain, totalAmount, count, splitType, message } = req.body;
      if (!token || !chain || !totalAmount || !count || !splitType) {
        return res.status(400).json({ error: 'Missing required fields: token, chain, totalAmount, count, splitType' });
      }
      const result = await createPacket({ token, chain, totalAmount, count, splitType, message });
      res.json({
        packetId: result.packet.id,
        agentWallet: result.agentWallet,
        claimUrl: result.claimUrl,
        packet: result.packet,
        instructions: `Please send ${totalAmount} ${token} to ${result.agentWallet} on ${chain} to activate this red packet.`,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── List Packets ──────────────────────────────────────────────────────────
  app.get('/api/packets', async (_req, res) => {
    try {
      const packets = await listPackets();
      res.json({ packets });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Get Packet ────────────────────────────────────────────────────────────
  app.get('/api/packets/:id', async (req, res) => {
    try {
      // Try to auto-activate if pending
      await activatePacket(req.params.id).catch(() => {});
      const { packet, claims } = await getPacketInfo(req.params.id);
      res.json({ packet, claims });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // ─── Activate (check funding) ──────────────────────────────────────────────
  app.post('/api/packets/:id/activate', async (req, res) => {
    try {
      await activatePacket(req.params.id);
      const { packet } = await getPacketInfo(req.params.id);
      res.json({ status: packet.status, message: packet.status === 'active' ? 'Funded and active!' : 'Not yet funded.' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Claim ─────────────────────────────────────────────────────────────────
  app.post('/api/packets/:id/claim', async (req, res) => {
    try {
      const { recipientAddress } = req.body;
      if (!recipientAddress) {
        return res.status(400).json({ error: 'recipientAddress is required' });
      }
      const result = await claimPacket(req.params.id, recipientAddress);
      res.json({
        success: true,
        amount: result.claim.amount,
        token: 'see packet',
        txHash: result.txHash,
        message: `Congratulations! You received ${result.claim.amount} tokens. TX: ${result.txHash}`,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Create page ───────────────────────────────────────────────────────────
  app.get('/create', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../public/create.html'));
  });

  // ─── Claim page ─────────────────────────────────────────────────────────────
  app.get('/claim/:id', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../public/claim.html'));
  });

  return app;
}
