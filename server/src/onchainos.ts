/**
 * Onchain OS integration via onchainos CLI (Agentic Wallet)
 * Install: npx skills add okx/onchainos-skills
 * Auth:    onchainos wallet login
 *
 * Supports: XLayer (chainId 196) + Solana (chainId 501)
 * Docs: https://web3.okx.com/onchainos/dev-docs/wallet/agentic-wallet
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Chain registry ────────────────────────────────────────────────────────────

type ChainType = 'evm' | 'solana';

interface ChainConfig {
  type: ChainType;
  chainId: number;   // onchainos CLI uses chainId
  name: string;
  nativeToken: string;
}

const CHAIN_CONFIG: Record<string, ChainConfig> = {
  xlayer: {
    type: 'evm',
    chainId: 196,
    name: 'XLayer',
    nativeToken: 'OKB',
  },
  'xlayer-testnet': {
    type: 'evm',
    chainId: 195,
    name: 'XLayer Testnet',
    nativeToken: 'OKB',
  },
  solana: {
    type: 'solana',
    chainId: 501,
    name: 'Solana',
    nativeToken: 'SOL',
  },
  'solana-devnet': {
    type: 'solana',
    chainId: 503,
    name: 'Solana Devnet',
    nativeToken: 'SOL',
  },
};

// ─── Token addresses ───────────────────────────────────────────────────────────

const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  xlayer: {
    USDC: '0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035', // USDC.e (bridged)
    USDT: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',
    OKB:  'native',
  },
  'xlayer-testnet': {
    USDC: '0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035',
    OKB:  'native',
  },
  solana: {
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    SOL:  'native',
  },
  'solana-devnet': {
    USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    SOL:  'native',
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function getChainConfig(chain: string): ChainConfig {
  const config = CHAIN_CONFIG[chain.toLowerCase()];
  if (!config) {
    throw new Error(
      `Unsupported chain: "${chain}". Supported: ${Object.keys(CHAIN_CONFIG).join(', ')}`
    );
  }
  return config;
}

export function getChainId(chain: string): number {
  return getChainConfig(chain).chainId;
}

function getTokenAddress(chain: string, token: string): string | null {
  // Raw contract address passed directly
  if (token.startsWith('0x') || (token.length > 30 && !token.startsWith('0x'))) {
    return token;
  }
  return TOKEN_ADDRESSES[chain.toLowerCase()]?.[token.toUpperCase()] ?? null;
}

function isNativeToken(chain: string, token: string): boolean {
  const addr = getTokenAddress(chain, token);
  return addr === 'native' || addr === null;
}

// ─── onchainos CLI wrapper ─────────────────────────────────────────────────────

async function runOnchainos(args: string, force = false): Promise<string> {
  const cmd = force ? `onchainos ${args} --force` : `onchainos ${args}`;
  try {
    const { stdout, stderr } = await execAsync(cmd);
    const out = stdout.trim();

    // Check for confirmation required
    try {
      const json = JSON.parse(out);
      if (json?.data?.confirming === true) {
        // Re-run with --force
        return runOnchainos(args, true);
      }
      if (json?.ok === false) {
        throw new Error(json?.msg || JSON.stringify(json));
      }
    } catch (parseErr) {
      if ((parseErr as Error).message?.includes('onchainos CLI error')) throw parseErr;
      // Not JSON, return raw output
    }

    if (stderr && !out) throw new Error(stderr);
    return out;
  } catch (err: any) {
    if (err.message?.startsWith('onchainos CLI error')) throw err;
    const msg = err.stderr || err.stdout || err.message || String(err);
    throw new Error(`onchainos CLI error: ${msg}`);
  }
}

/** Extract tx hash from onchainos CLI output */
function parseTxHash(output: string): string {
  // EVM tx hash: 0x + 64 hex chars
  const evmMatch = output.match(/0x[a-fA-F0-9]{64}/);
  if (evmMatch) return evmMatch[0];
  // Solana tx signature: base58, 87-88 chars
  const solMatch = output.match(/[1-9A-HJ-NP-Za-km-z]{87,88}/);
  if (solMatch) return solMatch[0];
  return output; // fallback: return raw output
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Get agent wallet address(es) from onchainos CLI
 */
export async function getAgentAddress(chain?: string): Promise<string> {
  try {
    const output = await runOnchainos('wallet addresses');
    const json = JSON.parse(output);
    const data = json?.data;
    if (!data) throw new Error('no data');

    if (!chain) {
      const evm = data.evm?.[0]?.address ?? '';
      const sol = data.solana?.[0]?.address ?? '';
      return `EVM: ${evm} | Solana: ${sol}`;
    }

    const cfg = getChainConfig(chain);
    if (cfg.type === 'solana') {
      return data.solana?.[0]?.address ?? '(no solana address)';
    }
    // XLayer and all EVM chains share the same address
    const chainIdStr = String(cfg.chainId);
    const match = (data.xlayer ?? data.evm ?? []).find(
      (a: any) => a.chainIndex === chainIdStr
    ) ?? data.evm?.[0];
    return match?.address ?? '(no evm address)';
  } catch {
    return '(not authenticated — run: onchainos wallet login)';
  }
}

/**
 * Get token balance via onchainos CLI
 */
export async function getTokenBalance(
  chain: string,
  _walletAddress: string,
  token: string
): Promise<string> {
  const { chainId } = getChainConfig(chain);
  const output = await runOnchainos(`wallet balance --chain ${chainId}`);

  try {
    const json = JSON.parse(output);
    const assets: any[] = json?.data?.details?.[0]?.tokenAssets ?? [];
    const tokenAddr = getTokenAddress(chain, token);
    // Match by contract address first (avoids ambiguity when multiple tokens share the same symbol)
    const byAddr = tokenAddr && tokenAddr !== 'native'
      ? assets.find((a: any) => a.tokenAddress?.toLowerCase() === tokenAddr.toLowerCase())
      : null;
    if (byAddr) return byAddr.balance ?? '0';
    // Fallback: match by symbol
    const tokenUpper = token.toUpperCase();
    const bySymbol = assets.find((a: any) => a.symbol?.toUpperCase() === tokenUpper);
    if (bySymbol) return bySymbol.balance ?? '0';
  } catch {
    // ignore parse errors
  }
  return '0';
}

/**
 * Transfer tokens using onchainos Agentic Wallet
 * Uses: onchainos wallet send --chain <id> [--contract-token <addr>] --readable-amount <n> --recipient <addr>
 */
export async function transferToken(
  chain: string,
  token: string,
  toAddress: string,
  amountHuman: string
): Promise<string> {
  const { chainId } = getChainConfig(chain);
  const tokenAddr = getTokenAddress(chain, token);
  const native = isNativeToken(chain, token);

  let cmd: string;
  if (native) {
    cmd = `wallet send --chain ${chainId} --readable-amount ${amountHuman} --recipient ${toAddress}`;
  } else {
    if (!tokenAddr) throw new Error(`Unknown token "${token}" on chain "${chain}"`);
    cmd = `wallet send --chain ${chainId} --contract-token ${tokenAddr} --readable-amount ${amountHuman} --recipient ${toAddress}`;
  }

  const output = await runOnchainos(cmd);
  return parseTxHash(output);
}

/**
 * Parse a human-readable amount into smallest unit (wei / lamports)
 * Used for envelope pre-calculation
 */
export async function parseTokenAmount(
  chain: string,
  token: string,
  amountHuman: string
): Promise<{ amountWei: string; decimals: number }> {
  const { type } = getChainConfig(chain);
  const native = isNativeToken(chain, token);

  let decimals: number;
  if (type === 'solana') {
    decimals = native ? 9 : 6; // SOL=9, USDC/USDT on Solana=6
  } else {
    decimals = native ? 18 : 6; // OKB/ETH=18, USDC/USDT on EVM=6
  }

  const amountWei = BigInt(Math.round(parseFloat(amountHuman) * 10 ** decimals)).toString();
  return { amountWei, decimals };
}

export function formatTokenAmount(amountWei: string, decimals: number): string {
  const value = Number(BigInt(amountWei)) / 10 ** decimals;
  return value.toFixed(Math.min(decimals, 6));
}
