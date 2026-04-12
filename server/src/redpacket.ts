import { nanoid } from 'nanoid';
import {
  savePacket, getPacket, getAllPackets, updatePacketStatus,
  saveClaim, getClaimsByPacket, hasRecipientClaimed,
} from './store';
import {
  getChainId, getAgentAddress, getTokenBalance,
  transferToken, parseTokenAmount, formatTokenAmount, getChainConfig,
} from './onchainos';
import { RedPacket, Claim, CreatePacketRequest } from './types';

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Pre-calculate envelope amounts (random or equal split)
 */
function generateEnvelopes(totalAmountWei: string, count: number, splitType: 'equal' | 'random'): string[] {
  const total = BigInt(totalAmountWei);
  const envelopes: bigint[] = [];

  if (splitType === 'equal') {
    const each = total / BigInt(count);
    const remainder = total - each * BigInt(count);
    for (let i = 0; i < count; i++) {
      envelopes.push(i === 0 ? each + remainder : each);
    }
  } else {
    // Random: divide total into `count` random parts using break-point method
    const breakpoints = Array.from({ length: count - 1 }, () =>
      BigInt(Math.floor(Math.random() * Number(total - BigInt(count)) + 1))
    ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const points = [0n, ...breakpoints, total - BigInt(count - 1)];
    for (let i = 0; i < count; i++) {
      // Ensure minimum 1 wei (+ 1 per slot to avoid zero envelopes)
      envelopes.push(points[i + 1] - points[i] + 1n);
    }
    // Adjust for the +1 additions
    const excess = envelopes.reduce((a, b) => a + b, 0n) - total;
    envelopes[0] -= excess;
  }

  // Shuffle envelopes so recipients get random order
  for (let i = envelopes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [envelopes[i], envelopes[j]] = [envelopes[j], envelopes[i]];
  }

  return envelopes.map(String);
}

export async function createPacket(req: CreatePacketRequest): Promise<{
  packet: RedPacket;
  claimUrl: string;
  agentWallet: string;
}> {
  const { token, chain, totalAmount, count, splitType, message = '' } = req;

  if (count < 1 || count > 200) throw new Error('Count must be between 1 and 200');
  if (parseFloat(totalAmount) < 0.000000001) throw new Error('Total amount must be at least 0.000000001');

  const chainId = getChainId(chain);
  const agentWallet = await getAgentAddress(chain);
  const { amountWei } = await parseTokenAmount(chain, token, totalAmount);
  const envelopes = generateEnvelopes(amountWei, count, splitType);

  const id = nanoid(10);
  const now = Date.now();

  const packet: RedPacket & { envelopes: string[] } = {
    id,
    token,
    chain: chain.toLowerCase(),
    chainId,
    totalAmount,
    totalAmountWei: amountWei,
    count,
    splitType,
    message,
    agentWallet,
    status: 'pending_funding',
    createdAt: now,
    expiresAt: now + EXPIRY_MS,
    claimedCount: 0,
    distributedAmount: '0',
    envelopes,
  };

  savePacket(packet);

  const port = process.env.PORT ?? 3000;
  const claimUrl = `http://localhost:${port}/claim/${id}`;

  return { packet, claimUrl, agentWallet };
}

export async function getPacketInfo(id: string) {
  const packet = getPacket(id);
  if (!packet) throw new Error(`Red packet ${id} not found`);

  const claims = getClaimsByPacket(id);

  // Auto-expire
  if (packet.status === 'active' && Date.now() > packet.expiresAt) {
    updatePacketStatus(id, 'expired', packet.claimedCount, packet.distributedAmount);
    packet.status = 'expired';
  }

  return { packet, claims };
}

export async function listPackets() {
  return getAllPackets();
}

export async function claimPacket(
  packetId: string,
  recipientAddress: string
): Promise<{ claim: Claim; txHash: string }> {
  const packet = getPacket(packetId);
  if (!packet) throw new Error('Red packet not found');

  // Address validation: based on chain type
  // XLayer uses XKO<40hex> format — convert to standard 0x<40hex> for onchainos
  const chainCfg = getChainConfig(packet.chain);
  if (chainCfg.type === 'evm') {
    if (/^XKO[a-fA-F0-9]{40}$/.test(recipientAddress)) {
      recipientAddress = '0x' + recipientAddress.slice(3);
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipientAddress)) {
      throw new Error('请输入有效的钱包地址（0x... 或 XKO... 格式）');
    }
  } else {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipientAddress)) {
      throw new Error('请输入有效的 Solana 钱包地址');
    }
  }

  if (packet.status === 'pending_funding') {
    throw new Error('Red packet not yet funded. Please ask the creator to send tokens to the agent wallet.');
  }
  if (packet.status === 'exhausted') throw new Error('This red packet is fully claimed!');
  if (packet.status === 'expired') throw new Error('This red packet has expired.');

  // Check expiry
  if (Date.now() > packet.expiresAt) {
    updatePacketStatus(packetId, 'expired', packet.claimedCount, packet.distributedAmount);
    throw new Error('This red packet has expired.');
  }

  const normalizedAddress = recipientAddress.toLowerCase();
  if (hasRecipientClaimed(packetId, normalizedAddress)) {
    throw new Error('You have already claimed this red packet!');
  }

  if (packet.claimedCount >= packet.count) {
    updatePacketStatus(packetId, 'exhausted', packet.claimedCount, packet.distributedAmount);
    throw new Error('No more red packets available!');
  }

  // Pick next envelope
  const envelopeWei = packet.envelopes[packet.claimedCount];
  const { amountWei: _, ...rest } = await parseTokenAmount(packet.chain, packet.token, '0')
    .then(({ decimals }) => ({
      amountWei: envelopeWei,
      decimals,
      amount: formatTokenAmount(envelopeWei, decimals),
    }));

  const decimals = rest.decimals;
  const amountHuman = formatTokenAmount(envelopeWei, decimals);

  // Execute on-chain transfer
  const txHash = await transferToken(packet.chain, packet.token, recipientAddress, amountHuman);

  const newClaimedCount = packet.claimedCount + 1;
  const newDistributed = (
    BigInt(packet.distributedAmount === '0' ? '0' : packet.distributedAmount) +
    BigInt(envelopeWei)
  ).toString();

  const newStatus = newClaimedCount >= packet.count ? 'exhausted' : 'active';
  updatePacketStatus(packetId, newStatus, newClaimedCount, newDistributed);

  const claim: Claim = {
    id: nanoid(12),
    packetId,
    recipientAddress: normalizedAddress,
    amount: amountHuman,
    amountWei: envelopeWei,
    txHash,
    claimedAt: Date.now(),
  };
  saveClaim(claim);

  return { claim, txHash };
}

export async function activatePacket(packetId: string): Promise<void> {
  const packet = getPacket(packetId);
  if (!packet) throw new Error('Red packet not found');
  if (packet.status !== 'pending_funding') return;

  // Check if funded
  const balance = await getTokenBalance(packet.chain, packet.agentWallet, packet.token);
  const balanceNum = parseFloat(balance);
  const totalNum = parseFloat(packet.totalAmount);

  if (balanceNum >= totalNum) {
    updatePacketStatus(packetId, 'active', 0, '0');
  }
}
