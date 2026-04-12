export type SplitType = 'equal' | 'random';
export type PacketStatus = 'pending_funding' | 'active' | 'exhausted' | 'expired';

export interface RedPacket {
  id: string;
  token: string;           // "USDC" | "USDT" | "OKB" | "SOL"
  chain: string;           // "xlayer" | "xlayer-testnet" | "solana" | "solana-devnet"
  chainId: number;
  totalAmount: string;     // in human-readable units e.g. "100"
  totalAmountWei: string;  // in smallest unit
  count: number;
  splitType: SplitType;
  message: string;
  agentWallet: string;     // agent wallet address that holds funds
  creatorNote?: string;
  status: PacketStatus;
  createdAt: number;
  expiresAt: number;       // createdAt + 24h
  claimedCount: number;
  distributedAmount: string;
}

export interface Claim {
  id: string;
  packetId: string;
  recipientAddress: string;
  amount: string;          // human-readable
  amountWei: string;
  txHash?: string;
  claimedAt: number;
}

export interface WalletInfo {
  address: string;
  balances: Record<string, string>; // token symbol -> human-readable balance
}

export interface CreatePacketRequest {
  token: string;
  chain: string;
  totalAmount: string;
  count: number;
  splitType: SplitType;
  message?: string;
}

export interface ClaimRequest {
  recipientAddress: string;
}
