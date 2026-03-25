#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { requestSuiFromFaucetV2, getFaucetHost } from "@mysten/sui/faucet";
import { SuinsClient } from "@mysten/suins";
import { z } from "zod";

// ─── DeFi Constants ──────────────────────────────────────────────────────────

const CETUS_CLMM_PACKAGE = "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb";
const DEEPBOOK_PACKAGE = "0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497";
const DEEPBOOK_REGISTRY = "0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d";

const COMMON_COIN_TYPES: Record<string, string> = {
  SUI: "0x2::sui::SUI",
  USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  USDT: "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
  WETH: "0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN",
  DEEP: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
};

// ─── Types ───────────────────────────────────────────────────────────────────

type NetworkType = "mainnet" | "testnet" | "devnet" | "localnet";

interface WalletEntry {
  name: string;
  keypair: Ed25519Keypair;
  address: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

const wallets: Map<string, WalletEntry> = new Map();
let currentNetwork: NetworkType = "devnet";
let client = new SuiJsonRpcClient({
  url: getJsonRpcFullnodeUrl(currentNetwork as Exclude<NetworkType, "localnet">),
  network: currentNetwork as Exclude<NetworkType, "localnet">,
});
let suinsClient: SuinsClient | null = null;

function getSuinsClient(): SuinsClient {
  if (!suinsClient || currentNetwork === "localnet") {
    const net = currentNetwork === "localnet" ? "mainnet" : currentNetwork;
    const suiClientForSuins = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(net),
      network: net,
    });
    suinsClient = new SuinsClient({ client: suiClientForSuins as never, network: net });
  }
  return suinsClient;
}

function switchClient(network: NetworkType): void {
  currentNetwork = network;
  suinsClient = null; // Reset SuiNS client
  if (network === "localnet") {
    client = new SuiJsonRpcClient({ url: "http://127.0.0.1:9000", network: "custom" as never });
  } else {
    client = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(network),
      network,
    });
  }
}

function resolveCoinType(input: string): string {
  const upper = input.toUpperCase();
  return COMMON_COIN_TYPES[upper] || input;
}

// ─── Validation Schemas ──────────────────────────────────────────────────────

const NameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, "Alphanumeric, hyphens, underscores only");

const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Must be a valid Sui address (0x + 64 hex chars)");

const ObjectIdSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/, "Must be a valid object ID");

const AmountSchema = z.number().positive("Amount must be positive");

const NetworkSchema = z.enum(["mainnet", "testnet", "devnet", "localnet"]);

const DigestSchema = z.string().min(1, "Transaction digest required");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/suiprivkey[a-zA-Z0-9]+/g, "[REDACTED]").replace(/0x[a-fA-F0-9]{64}/g, (m) =>
    m.slice(0, 10) + "..." + m.slice(-4)
  );
}

function getWallet(name: string): WalletEntry {
  const w = wallets.get(name);
  if (!w) throw new Error(`Wallet '${name}' not found. Use list_wallets to see available wallets.`);
  return w;
}

function formatSui(mist: string | bigint): string {
  const val = BigInt(mist);
  const sui = Number(val) / 1e9;
  return `${sui.toFixed(9)} SUI`;
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class RateLimiter {
  private timestamps: number[] = [];
  constructor(
    private maxCalls: number = 120,
    private windowMs: number = 60_000
  ) {}

  check(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxCalls) return false;
    this.timestamps.push(now);
    return true;
  }
}

const rateLimiter = new RateLimiter();

// ─── Tool Definitions ────────────────────────────────────────────────────────

const tools: Tool[] = [
  // Wallet Management
  {
    name: "create_wallet",
    description: "Create a new Sui wallet (Ed25519 keypair). Keys are held in memory only.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Wallet name (alphanumeric, hyphens, underscores)" },
      },
      required: ["name"],
    },
  },
  {
    name: "import_wallet",
    description: "Import a Sui wallet from a Bech32-encoded private key (suiprivkey...).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Wallet name" },
        privateKey: { type: "string", description: "Bech32 private key (suiprivkey...)" },
      },
      required: ["name", "privateKey"],
    },
  },
  {
    name: "list_wallets",
    description: "List all wallets managed in this session.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_balance",
    description: "Get SUI balance for an address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Sui address (0x...)" },
      },
      required: ["address"],
    },
  },

  // Coin Operations
  {
    name: "get_all_balances",
    description: "Get all coin balances for an address (SUI and all other coin types).",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Sui address" },
      },
      required: ["address"],
    },
  },
  {
    name: "get_coins",
    description: "Get coin objects of a specific type owned by an address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Owner address" },
        coinType: { type: "string", description: "Coin type (default: 0x2::sui::SUI)" },
        limit: { type: "number", description: "Max coins to return (default: 50)" },
      },
      required: ["address"],
    },
  },
  {
    name: "get_coin_metadata",
    description: "Get metadata for a coin type (name, symbol, decimals, description).",
    inputSchema: {
      type: "object",
      properties: {
        coinType: { type: "string", description: "Coin type (e.g. 0x2::sui::SUI)" },
      },
      required: ["coinType"],
    },
  },
  {
    name: "get_total_supply",
    description: "Get total supply of a coin type.",
    inputSchema: {
      type: "object",
      properties: {
        coinType: { type: "string", description: "Coin type" },
      },
      required: ["coinType"],
    },
  },

  // Transfers
  {
    name: "transfer_sui",
    description: "Transfer SUI from a managed wallet to a recipient address. Amount is in SUI (not MIST).",
    inputSchema: {
      type: "object",
      properties: {
        fromWallet: { type: "string", description: "Name of the sending wallet" },
        toAddress: { type: "string", description: "Recipient Sui address" },
        amount: { type: "number", description: "Amount in SUI" },
      },
      required: ["fromWallet", "toAddress", "amount"],
    },
  },
  {
    name: "transfer_objects",
    description: "Transfer one or more objects to a recipient address.",
    inputSchema: {
      type: "object",
      properties: {
        fromWallet: { type: "string", description: "Sending wallet name" },
        toAddress: { type: "string", description: "Recipient address" },
        objectIds: {
          type: "array",
          items: { type: "string" },
          description: "Object IDs to transfer",
        },
      },
      required: ["fromWallet", "toAddress", "objectIds"],
    },
  },
  {
    name: "merge_coins",
    description: "Merge multiple coins into one. All coins must be the same type.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Wallet name" },
        primaryCoin: { type: "string", description: "Object ID of the coin to merge into" },
        coinsToMerge: {
          type: "array",
          items: { type: "string" },
          description: "Object IDs of coins to merge",
        },
      },
      required: ["wallet", "primaryCoin", "coinsToMerge"],
    },
  },
  {
    name: "split_coins",
    description: "Split a coin into multiple coins with specified amounts (in MIST).",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Wallet name" },
        coinId: { type: "string", description: "Object ID of the coin to split" },
        amounts: {
          type: "array",
          items: { type: "number" },
          description: "Amounts for each new coin (in MIST)",
        },
      },
      required: ["wallet", "coinId", "amounts"],
    },
  },

  // Object Queries
  {
    name: "get_object",
    description: "Get details of a Sui object by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "Object ID" },
        showContent: { type: "boolean", description: "Include object content (default: true)" },
        showType: { type: "boolean", description: "Include object type (default: true)" },
        showOwner: { type: "boolean", description: "Include owner info (default: true)" },
      },
      required: ["objectId"],
    },
  },
  {
    name: "get_owned_objects",
    description: "Get objects owned by an address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Owner address" },
        limit: { type: "number", description: "Max objects to return (default: 50)" },
        filter: {
          type: "object",
          description: "Optional filter: { StructType: '0x2::coin::Coin<0x2::sui::SUI>' }",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "get_dynamic_fields",
    description: "Get dynamic fields of an object.",
    inputSchema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "Parent object ID" },
        limit: { type: "number", description: "Max fields to return (default: 50)" },
      },
      required: ["parentId"],
    },
  },

  // Transactions
  {
    name: "get_transaction",
    description: "Get transaction details by digest.",
    inputSchema: {
      type: "object",
      properties: {
        digest: { type: "string", description: "Transaction digest" },
        showInput: { type: "boolean", description: "Show transaction input (default: true)" },
        showEffects: { type: "boolean", description: "Show effects (default: true)" },
        showEvents: { type: "boolean", description: "Show events (default: true)" },
      },
      required: ["digest"],
    },
  },
  {
    name: "dry_run_transaction",
    description: "Dry-run a transaction to preview effects without executing.",
    inputSchema: {
      type: "object",
      properties: {
        txBytes: { type: "string", description: "Base64-encoded transaction bytes" },
      },
      required: ["txBytes"],
    },
  },

  // Move
  {
    name: "move_call",
    description:
      "Execute a Move function call. Arguments are passed as an array of strings/numbers.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Wallet name for signing" },
        target: {
          type: "string",
          description: "Move call target: package::module::function",
        },
        arguments: {
          type: "array",
          items: {},
          description: "Function arguments",
        },
        typeArguments: {
          type: "array",
          items: { type: "string" },
          description: "Type arguments for generic functions",
        },
      },
      required: ["wallet", "target"],
    },
  },
  {
    name: "get_normalized_module",
    description: "Get the normalized Move module definition (functions, structs, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        packageId: { type: "string", description: "Package object ID" },
        moduleName: { type: "string", description: "Module name" },
      },
      required: ["packageId", "moduleName"],
    },
  },
  {
    name: "get_move_function",
    description: "Get details of a specific Move function.",
    inputSchema: {
      type: "object",
      properties: {
        packageId: { type: "string", description: "Package object ID" },
        moduleName: { type: "string", description: "Module name" },
        functionName: { type: "string", description: "Function name" },
      },
      required: ["packageId", "moduleName", "functionName"],
    },
  },

  // Staking
  {
    name: "get_stakes",
    description: "Get all staking positions for an address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Staker address" },
      },
      required: ["address"],
    },
  },
  {
    name: "request_add_stake",
    description: "Stake SUI with a validator. Amount is in SUI.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Wallet name" },
        validatorAddress: { type: "string", description: "Validator address" },
        amount: { type: "number", description: "Amount of SUI to stake" },
      },
      required: ["wallet", "validatorAddress", "amount"],
    },
  },
  {
    name: "request_withdraw_stake",
    description: "Withdraw staked SUI.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Wallet name" },
        stakeObjectId: { type: "string", description: "StakedSui object ID" },
      },
      required: ["wallet", "stakeObjectId"],
    },
  },
  {
    name: "get_validators",
    description:
      "Get current validator set with APY, commission, and stake info.",
    inputSchema: { type: "object", properties: {} },
  },

  // Network
  {
    name: "switch_network",
    description: "Switch to a different Sui network.",
    inputSchema: {
      type: "object",
      properties: {
        network: {
          type: "string",
          enum: ["mainnet", "testnet", "devnet", "localnet"],
          description: "Network to switch to",
        },
      },
      required: ["network"],
    },
  },
  {
    name: "get_network_info",
    description: "Get current network info: chain ID, epoch, reference gas price, checkpoint.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_latest_checkpoint",
    description: "Get the latest checkpoint sequence number.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_reference_gas_price",
    description: "Get current reference gas price.",
    inputSchema: { type: "object", properties: {} },
  },

  // Faucet
  {
    name: "request_faucet",
    description:
      "Request SUI from the faucet (devnet/testnet only).",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address to fund" },
      },
      required: ["address"],
    },
  },

  // Name Service
  {
    name: "resolve_name",
    description: "Resolve a SuiNS name to an address.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "SuiNS name (e.g. example.sui)" },
      },
      required: ["name"],
    },
  },
  {
    name: "resolve_address",
    description: "Reverse-resolve an address to its SuiNS name(s).",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Sui address" },
      },
      required: ["address"],
    },
  },

  // Events
  {
    name: "query_events",
    description:
      "Query on-chain events by type, sender, package, module, or transaction digest.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          description:
            'Event filter. Examples: { "MoveEventType": "0x2::coin::CoinEvent" }, { "Sender": "0x..." }, { "Package": "0x2" }, { "Transaction": "digest..." }',
        },
        limit: { type: "number", description: "Max events (default: 50)" },
        order: {
          type: "string",
          enum: ["ascending", "descending"],
          description: "Sort order (default: descending)",
        },
      },
      required: ["filter"],
    },
  },

  // Transaction Queries
  {
    name: "query_transactions",
    description:
      "Search and filter transactions by sender, recipient, input object, changed object, or Move function.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          description:
            'Transaction filter. Examples: { "FromAddress": "0x..." }, { "ToAddress": "0x..." }, { "InputObject": "0x..." }, { "ChangedObject": "0x..." }, { "MoveFunction": { "package": "0x2", "module": "coin", "function": "transfer" } }',
        },
        limit: { type: "number", description: "Max transactions (default: 50)" },
        order: {
          type: "string",
          enum: ["ascending", "descending"],
          description: "Sort order (default: descending)",
        },
      },
      required: ["filter"],
    },
  },

  // Multi-Object Queries
  {
    name: "multi_get_objects",
    description: "Batch-fetch multiple objects by their IDs in one call.",
    inputSchema: {
      type: "object",
      properties: {
        objectIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of object IDs to fetch",
        },
        showContent: { type: "boolean", description: "Include content (default: true)" },
        showType: { type: "boolean", description: "Include type (default: true)" },
      },
      required: ["objectIds"],
    },
  },

  // Package Inspection
  {
    name: "get_package_modules",
    description: "List all modules in a Move package, with their functions and structs.",
    inputSchema: {
      type: "object",
      properties: {
        packageId: { type: "string", description: "Package object ID" },
      },
      required: ["packageId"],
    },
  },
  {
    name: "get_move_struct",
    description: "Get a Move struct definition (fields, abilities, type parameters).",
    inputSchema: {
      type: "object",
      properties: {
        packageId: { type: "string", description: "Package object ID" },
        moduleName: { type: "string", description: "Module name" },
        structName: { type: "string", description: "Struct name" },
      },
      required: ["packageId", "moduleName", "structName"],
    },
  },

  // Epoch & Checkpoint Analytics
  {
    name: "get_epoch_info",
    description: "Get detailed info about epochs (current or historical).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of epochs to return (default: 5)" },
        order: {
          type: "string",
          enum: ["ascending", "descending"],
          description: "Sort order (default: descending)",
        },
      },
    },
  },
  {
    name: "get_checkpoint",
    description: "Get detailed checkpoint data by sequence number.",
    inputSchema: {
      type: "object",
      properties: {
        sequenceNumber: { type: "string", description: "Checkpoint sequence number" },
      },
      required: ["sequenceNumber"],
    },
  },

  // Protocol & System
  {
    name: "get_protocol_config",
    description: "Get the current Sui protocol configuration (limits, features, gas settings).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_system_state",
    description:
      "Get the full Sui system state: epoch, validators, stake distribution, gas price, storage fund.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_committee_info",
    description: "Get validator committee information for a specific epoch.",
    inputSchema: {
      type: "object",
      properties: {
        epoch: { type: "string", description: "Epoch number (default: current)" },
      },
    },
  },

  // Dev Inspect
  {
    name: "dev_inspect",
    description:
      "Simulate a Move call without executing it — returns results, gas cost, and effects. No wallet needed.",
    inputSchema: {
      type: "object",
      properties: {
        sender: { type: "string", description: "Sender address to simulate from" },
        target: { type: "string", description: "Move call target: package::module::function" },
        arguments: {
          type: "array",
          items: {},
          description: "Function arguments",
        },
        typeArguments: {
          type: "array",
          items: { type: "string" },
          description: "Type arguments",
        },
      },
      required: ["sender", "target"],
    },
  },

  // Object History
  {
    name: "get_object_history",
    description: "Find all transactions that touched a given object (trace provenance).",
    inputSchema: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "Object ID to trace" },
        limit: { type: "number", description: "Max transactions (default: 20)" },
      },
      required: ["objectId"],
    },
  },

  // Token Analytics
  {
    name: "get_total_transactions",
    description: "Get the total number of transactions on the network.",
    inputSchema: { type: "object", properties: {} },
  },

  // Move Call Metrics
  {
    name: "get_move_call_metrics",
    description: "Get Move call metrics — most-called packages, modules, and functions.",
    inputSchema: { type: "object", properties: {} },
  },

  // ── DeFi: Cetus DEX ──
  {
    name: "cetus_get_pools",
    description: "Query Cetus CLMM pools by coin types. Returns pool addresses, liquidity, and fee rates.",
    inputSchema: {
      type: "object",
      properties: {
        coinTypeA: { type: "string", description: "Coin type A (e.g. 0x2::sui::SUI). Use 'SUI', 'USDC', 'USDT', 'WETH', 'DEEP' as shortcuts." },
        coinTypeB: { type: "string", description: "Coin type B" },
        limit: { type: "number", description: "Max pools (default: 10)" },
      },
    },
  },
  {
    name: "cetus_get_pool",
    description: "Get detailed info for a specific Cetus pool by its object ID.",
    inputSchema: {
      type: "object",
      properties: {
        poolId: { type: "string", description: "Cetus pool object ID" },
      },
      required: ["poolId"],
    },
  },

  // ── DeFi: DeepBook Order Book ──
  {
    name: "deepbook_get_pool",
    description: "Get DeepBook v3 pool info (order book) — mid price, spread, balances.",
    inputSchema: {
      type: "object",
      properties: {
        poolId: { type: "string", description: "DeepBook pool object ID" },
      },
      required: ["poolId"],
    },
  },

  // ── DeFi: Token Price (via pools) ──
  {
    name: "get_token_price",
    description: "Get approximate token price by querying DeFi pool reserves. Supports common tokens: SUI, USDC, USDT, WETH, DEEP.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token symbol (SUI, USDC, USDT, WETH, DEEP) or full coin type" },
      },
      required: ["token"],
    },
  },

  // ── DeFi: Swap Quote ──
  {
    name: "swap_quote",
    description: "Get a swap quote by simulating a Move call. Returns estimated output amount and gas cost without executing.",
    inputSchema: {
      type: "object",
      properties: {
        fromCoin: { type: "string", description: "Source coin type or shorthand (SUI, USDC, etc.)" },
        toCoin: { type: "string", description: "Destination coin type or shorthand" },
        amount: { type: "number", description: "Amount to swap (in token units, not MIST)" },
        poolId: { type: "string", description: "Pool object ID to use for the swap" },
      },
      required: ["fromCoin", "toCoin", "amount", "poolId"],
    },
  },

  // ── SuiNS Extended ──
  {
    name: "suins_get_name_record",
    description: "Get detailed SuiNS name record — NFT ID, target address, expiration, metadata.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "SuiNS name (e.g. example.sui)" },
      },
      required: ["name"],
    },
  },
  {
    name: "suins_get_price",
    description: "Get SuiNS registration and renewal pricing.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Domain name to check price for" },
        years: { type: "number", description: "Number of years (default: 1)" },
      },
      required: ["name"],
    },
  },

  // ── Common Tokens ──
  {
    name: "list_common_tokens",
    description: "List commonly used Sui token types (SUI, USDC, USDT, WETH, DEEP) with their full coin type addresses.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ─── Tool Handlers ───────────────────────────────────────────────────────────

async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  if (!rateLimiter.check()) {
    return errorResult("Rate limit exceeded. Max 120 calls per minute.");
  }

  try {
    switch (name) {
      // ── Wallet ──
      case "create_wallet": {
        const walletName = NameSchema.parse(args.name);
        if (wallets.has(walletName)) return errorResult(`Wallet '${walletName}' already exists.`);
        const keypair = new Ed25519Keypair();
        const address = keypair.getPublicKey().toSuiAddress();
        wallets.set(walletName, { name: walletName, keypair, address });
        return textResult(
          JSON.stringify({ name: walletName, address, network: currentNetwork }, null, 2)
        );
      }

      case "import_wallet": {
        const walletName = NameSchema.parse(args.name);
        const pk = z.string().min(1).parse(args.privateKey);
        if (wallets.has(walletName)) return errorResult(`Wallet '${walletName}' already exists.`);
        const keypair = Ed25519Keypair.fromSecretKey(pk);
        const address = keypair.getPublicKey().toSuiAddress();
        wallets.set(walletName, { name: walletName, keypair, address });
        return textResult(JSON.stringify({ name: walletName, address, network: currentNetwork }, null, 2));
      }

      case "list_wallets": {
        const list = Array.from(wallets.values()).map((w) => ({
          name: w.name,
          address: w.address,
        }));
        return textResult(
          JSON.stringify({ wallets: list, network: currentNetwork, count: list.length }, null, 2)
        );
      }

      case "get_balance": {
        const address = AddressSchema.parse(args.address);
        const balance = await client.getBalance({ owner: address });
        return textResult(
          JSON.stringify(
            {
              address,
              coinType: balance.coinType,
              balance: formatSui(balance.totalBalance),
              balanceMist: balance.totalBalance,
              coinObjectCount: balance.coinObjectCount,
            },
            null,
            2
          )
        );
      }

      // ── Coins ──
      case "get_all_balances": {
        const address = AddressSchema.parse(args.address);
        const balances = await client.getAllBalances({ owner: address });
        const formatted = balances.map((b: { coinType: string; totalBalance: string; coinObjectCount: number }) => ({
          coinType: b.coinType,
          balance: b.coinType === "0x2::sui::SUI" ? formatSui(b.totalBalance) : b.totalBalance,
          balanceMist: b.totalBalance,
          coinObjectCount: b.coinObjectCount,
        }));
        return textResult(JSON.stringify({ address, balances: formatted }, null, 2));
      }

      case "get_coins": {
        const address = AddressSchema.parse(args.address);
        const coinType = (args.coinType as string) || "0x2::sui::SUI";
        const limit = z.number().int().min(1).max(200).optional().parse(args.limit) ?? 50;
        const coins = await client.getCoins({ owner: address, coinType, limit });
        return textResult(JSON.stringify(coins, null, 2));
      }

      case "get_coin_metadata": {
        const coinType = z.string().min(1).parse(args.coinType);
        const meta = await client.getCoinMetadata({ coinType });
        return textResult(JSON.stringify(meta, null, 2));
      }

      case "get_total_supply": {
        const coinType = z.string().min(1).parse(args.coinType);
        const supply = await client.getTotalSupply({ coinType });
        return textResult(JSON.stringify(supply, null, 2));
      }

      // ── Transfers ──
      case "transfer_sui": {
        const wallet = getWallet(NameSchema.parse(args.fromWallet));
        const toAddress = AddressSchema.parse(args.toAddress);
        const amount = AmountSchema.parse(args.amount);
        const mistAmount = BigInt(Math.round(amount * 1e9));

        const tx = new Transaction();
        const [coin] = tx.splitCoins(tx.gas, [mistAmount]);
        tx.transferObjects([coin], toAddress);

        const result = await client.signAndExecuteTransaction({
          transaction: tx,
          signer: wallet.keypair,
          options: { showEffects: true },
        });

        return textResult(
          JSON.stringify(
            {
              digest: result.digest,
              status: result.effects?.status?.status,
              from: wallet.address,
              to: toAddress,
              amount: `${amount} SUI`,
              network: currentNetwork,
            },
            null,
            2
          )
        );
      }

      case "transfer_objects": {
        const wallet = getWallet(NameSchema.parse(args.fromWallet));
        const toAddress = AddressSchema.parse(args.toAddress);
        const objectIds = z.array(ObjectIdSchema).min(1).parse(args.objectIds);

        const tx = new Transaction();
        tx.transferObjects(
          objectIds.map((id) => tx.object(id)),
          toAddress
        );

        const result = await client.signAndExecuteTransaction({
          transaction: tx,
          signer: wallet.keypair,
          options: { showEffects: true },
        });

        return textResult(
          JSON.stringify(
            {
              digest: result.digest,
              status: result.effects?.status?.status,
              objectsMoved: objectIds.length,
            },
            null,
            2
          )
        );
      }

      case "merge_coins": {
        const wallet = getWallet(NameSchema.parse(args.wallet));
        const primaryCoin = ObjectIdSchema.parse(args.primaryCoin);
        const coinsToMerge = z.array(ObjectIdSchema).min(1).parse(args.coinsToMerge);

        const tx = new Transaction();
        // Merge into the gas coin if primary is the gas coin, otherwise use object ref
        tx.mergeCoins(
          tx.gas,
          coinsToMerge.map((id) => tx.object(id))
        );

        const result = await client.signAndExecuteTransaction({
          transaction: tx,
          signer: wallet.keypair,
          options: { showEffects: true },
        });

        return textResult(
          JSON.stringify({ digest: result.digest, status: result.effects?.status?.status, merged: coinsToMerge.length + 1 }, null, 2)
        );
      }

      case "split_coins": {
        const wallet = getWallet(NameSchema.parse(args.wallet));
        const coinId = ObjectIdSchema.parse(args.coinId);
        const amounts = z.array(z.number().positive()).min(1).parse(args.amounts);

        // Check if this is the only coin (use tx.gas to avoid "no gas" error)
        const ownerCoins = await client.getCoins({ owner: wallet.address, limit: 2 });
        const isSoleCoin = (ownerCoins.data?.length ?? 0) <= 1;

        const tx = new Transaction();
        const source = isSoleCoin ? tx.gas : tx.object(coinId);
        const newCoins = tx.splitCoins(
          source,
          amounts.map((a) => BigInt(a))
        );
        // Transfer split coins back to sender
        for (let i = 0; i < amounts.length; i++) {
          tx.transferObjects([newCoins[i]], wallet.address);
        }

        const result = await client.signAndExecuteTransaction({
          transaction: tx,
          signer: wallet.keypair,
          options: { showEffects: true },
        });

        return textResult(
          JSON.stringify({ digest: result.digest, status: result.effects?.status?.status, splits: amounts.length }, null, 2)
        );
      }

      // ── Objects ──
      case "get_object": {
        const objectId = ObjectIdSchema.parse(args.objectId);
        const showContent = args.showContent !== false;
        const showType = args.showType !== false;
        const showOwner = args.showOwner !== false;
        const obj = await client.getObject({
          id: objectId,
          options: { showContent, showType, showOwner, showDisplay: false, showBcs: false, showStorageRebate: true },
        });
        return textResult(JSON.stringify(obj, null, 2));
      }

      case "get_owned_objects": {
        const address = AddressSchema.parse(args.address);
        const limit = z.number().int().min(1).max(200).optional().parse(args.limit) ?? 50;
        const filter = args.filter as Record<string, unknown> | undefined;
        const objects = await client.getOwnedObjects({
          owner: address,
          limit,
          filter: filter as never,
          options: { showType: true, showContent: false, showOwner: false },
        });
        return textResult(JSON.stringify(objects, null, 2));
      }

      case "get_dynamic_fields": {
        const parentId = ObjectIdSchema.parse(args.parentId);
        const limit = z.number().int().min(1).max(200).optional().parse(args.limit) ?? 50;
        const fields = await client.getDynamicFields({ parentId, limit });
        return textResult(JSON.stringify(fields, null, 2));
      }

      // ── Transactions ──
      case "get_transaction": {
        const digest = DigestSchema.parse(args.digest);
        const showInput = args.showInput !== false;
        const showEffects = args.showEffects !== false;
        const showEvents = args.showEvents !== false;
        const tx = await client.getTransactionBlock({
          digest,
          options: { showInput, showEffects, showEvents, showObjectChanges: true },
        });
        return textResult(JSON.stringify(tx, null, 2));
      }

      case "dry_run_transaction": {
        const txBytes = z.string().min(1).parse(args.txBytes);
        const result = await client.dryRunTransactionBlock({ transactionBlock: txBytes });
        return textResult(JSON.stringify(result, null, 2));
      }

      // ── Move ──
      case "move_call": {
        const wallet = getWallet(NameSchema.parse(args.wallet));
        const target = z.string().regex(/^0x[^:]+::[^:]+::[^:]+$/, "Format: package::module::function").parse(args.target);
        const fnArgs = (args.arguments as unknown[]) || [];
        const typeArgs = (args.typeArguments as string[]) || [];

        const tx = new Transaction();
        tx.moveCall({
          target: target as `${string}::${string}::${string}`,
          arguments: fnArgs.map((a) => {
            if (typeof a === "string" && a.startsWith("0x")) return tx.object(a);
            if (typeof a === "number" || typeof a === "bigint") return tx.pure.u64(BigInt(a));
            if (typeof a === "boolean") return tx.pure.bool(a);
            return tx.pure.string(String(a));
          }),
          typeArguments: typeArgs,
        });

        const result = await client.signAndExecuteTransaction({
          transaction: tx,
          signer: wallet.keypair,
          options: { showEffects: true, showEvents: true },
        });

        return textResult(
          JSON.stringify(
            {
              digest: result.digest,
              status: result.effects?.status?.status,
              events: result.events,
            },
            null,
            2
          )
        );
      }

      case "get_normalized_module": {
        const packageId = ObjectIdSchema.parse(args.packageId);
        const moduleName = z.string().min(1).parse(args.moduleName);
        const mod = await client.getNormalizedMoveModule({ package: packageId, module: moduleName });
        return textResult(JSON.stringify(mod, null, 2));
      }

      case "get_move_function": {
        const packageId = ObjectIdSchema.parse(args.packageId);
        const moduleName = z.string().min(1).parse(args.moduleName);
        const functionName = z.string().min(1).parse(args.functionName);
        const fn = await client.getNormalizedMoveFunction({
          package: packageId,
          module: moduleName,
          function: functionName,
        });
        return textResult(JSON.stringify(fn, null, 2));
      }

      // ── Staking ──
      case "get_stakes": {
        const address = AddressSchema.parse(args.address);
        const stakes = await client.getStakes({ owner: address });
        return textResult(JSON.stringify(stakes, null, 2));
      }

      case "request_add_stake": {
        const wallet = getWallet(NameSchema.parse(args.wallet));
        const validatorAddress = AddressSchema.parse(args.validatorAddress);
        const amount = AmountSchema.parse(args.amount);
        const mistAmount = BigInt(Math.round(amount * 1e9));

        const tx = new Transaction();
        const [stakeCoin] = tx.splitCoins(tx.gas, [mistAmount]);
        tx.moveCall({
          target: "0x3::sui_system::request_add_stake",
          arguments: [
            tx.object("0x5"), // SuiSystemState
            stakeCoin,
            tx.pure.address(validatorAddress),
          ],
        });

        const result = await client.signAndExecuteTransaction({
          transaction: tx,
          signer: wallet.keypair,
          options: { showEffects: true },
        });

        return textResult(
          JSON.stringify(
            {
              digest: result.digest,
              status: result.effects?.status?.status,
              validator: validatorAddress,
              amount: `${amount} SUI`,
            },
            null,
            2
          )
        );
      }

      case "request_withdraw_stake": {
        const wallet = getWallet(NameSchema.parse(args.wallet));
        const stakeObjectId = ObjectIdSchema.parse(args.stakeObjectId);

        const tx = new Transaction();
        tx.moveCall({
          target: "0x3::sui_system::request_withdraw_stake",
          arguments: [tx.object("0x5"), tx.object(stakeObjectId)],
        });

        const result = await client.signAndExecuteTransaction({
          transaction: tx,
          signer: wallet.keypair,
          options: { showEffects: true },
        });

        return textResult(
          JSON.stringify({ digest: result.digest, status: result.effects?.status?.status }, null, 2)
        );
      }

      case "get_validators": {
        const [systemState, apys] = await Promise.all([
          client.getLatestSuiSystemState(),
          client.getValidatorsApy(),
        ]);
        const validators = (systemState as unknown as { activeValidators: Array<{ suiAddress: string; name: string; stakingPoolSuiBalance: string; commissionRate: string }> }).activeValidators.map(
          (v: { suiAddress: string; name: string; stakingPoolSuiBalance: string; commissionRate: string }) => {
            const apyEntry = (apys as unknown as { apys: Array<{ address: string; apy: number }> }).apys.find(
              (a: { address: string; apy: number }) => a.address === v.suiAddress
            );
            return {
              address: v.suiAddress,
              name: v.name,
              stake: formatSui(v.stakingPoolSuiBalance),
              commission: `${Number(v.commissionRate) / 100}%`,
              apy: apyEntry ? `${(apyEntry.apy * 100).toFixed(2)}%` : "N/A",
            };
          }
        );
        return textResult(
          JSON.stringify({ validators: validators.slice(0, 50), total: validators.length, epoch: (systemState as unknown as { epoch: string }).epoch }, null, 2)
        );
      }

      // ── Network ──
      case "switch_network": {
        const network = NetworkSchema.parse(args.network);
        switchClient(network);
        return textResult(JSON.stringify({ network: currentNetwork, message: `Switched to ${network}` }, null, 2));
      }

      case "get_network_info": {
        const [chainId, gasPrice, checkpoint, systemState] = await Promise.all([
          client.getChainIdentifier(),
          client.getReferenceGasPrice(),
          client.getLatestCheckpointSequenceNumber(),
          client.getLatestSuiSystemState(),
        ]);
        return textResult(
          JSON.stringify(
            {
              network: currentNetwork,
              chainId,
              referenceGasPrice: String(gasPrice),
              latestCheckpoint: checkpoint,
              epoch: (systemState as unknown as { epoch: string }).epoch,
            },
            null,
            2
          )
        );
      }

      case "get_latest_checkpoint": {
        const seq = await client.getLatestCheckpointSequenceNumber();
        return textResult(JSON.stringify({ checkpoint: seq, network: currentNetwork }, null, 2));
      }

      case "get_reference_gas_price": {
        const price = await client.getReferenceGasPrice();
        return textResult(JSON.stringify({ gasPrice: String(price), network: currentNetwork }, null, 2));
      }

      // ── Faucet ──
      case "request_faucet": {
        const address = AddressSchema.parse(args.address);
        if (currentNetwork !== "devnet" && currentNetwork !== "testnet") {
          return errorResult("Faucet only available on devnet and testnet.");
        }
        const result = await requestSuiFromFaucetV2({
          host: getFaucetHost(currentNetwork),
          recipient: address,
        });
        return textResult(JSON.stringify({ ...result, address, network: currentNetwork }, null, 2));
      }

      // ── Name Service ──
      case "resolve_name": {
        const suiName = z.string().min(1).parse(args.name);
        const address = await client.resolveNameServiceAddress({ name: suiName });
        return textResult(
          JSON.stringify({ name: suiName, address: address || "Not found" }, null, 2)
        );
      }

      case "resolve_address": {
        const address = AddressSchema.parse(args.address);
        const names = await client.resolveNameServiceNames({ address });
        return textResult(JSON.stringify({ address, names }, null, 2));
      }

      // ── Events ──
      case "query_events": {
        const filter = args.filter as Record<string, unknown>;
        if (!filter) return errorResult("Filter is required.");
        const limit = z.number().int().min(1).max(200).optional().parse(args.limit) ?? 50;
        const order = (args.order as string) === "ascending" ? "ascending" : "descending";
        const events = await client.queryEvents({
          query: filter as never,
          limit,
          order: order as "ascending" | "descending",
        });
        return textResult(JSON.stringify(events, null, 2));
      }

      // ── Transaction Queries ──
      case "query_transactions": {
        const filter = args.filter as Record<string, unknown>;
        if (!filter) return errorResult("Filter is required.");
        const limit = z.number().int().min(1).max(200).optional().parse(args.limit) ?? 50;
        const order = (args.order as string) === "ascending" ? "ascending" : "descending";
        const txns = await client.queryTransactionBlocks({
          filter: filter as never,
          limit,
          order: order as "ascending" | "descending",
          options: { showEffects: true, showInput: false },
        });
        return textResult(JSON.stringify(txns, null, 2));
      }

      // ── Multi-Object Queries ──
      case "multi_get_objects": {
        const objectIds = z.array(ObjectIdSchema).min(1).max(50).parse(args.objectIds);
        const showContent = args.showContent !== false;
        const showType = args.showType !== false;
        const objects = await client.multiGetObjects({
          ids: objectIds,
          options: { showContent, showType, showOwner: true },
        });
        return textResult(JSON.stringify(objects, null, 2));
      }

      // ── Package Inspection ──
      case "get_package_modules": {
        const packageId = ObjectIdSchema.parse(args.packageId);
        const modules = await client.getNormalizedMoveModulesByPackage({ package: packageId });
        const summary = Object.entries(modules as Record<string, { exposedFunctions: Record<string, unknown>; structs: Record<string, unknown> }>).map(([name, mod]) => ({
          module: name,
          functions: Object.keys(mod.exposedFunctions || {}),
          structs: Object.keys(mod.structs || {}),
        }));
        return textResult(JSON.stringify({ packageId, modules: summary }, null, 2));
      }

      case "get_move_struct": {
        const packageId = ObjectIdSchema.parse(args.packageId);
        const moduleName = z.string().min(1).parse(args.moduleName);
        const structName = z.string().min(1).parse(args.structName);
        const struct = await client.getNormalizedMoveStruct({
          package: packageId,
          module: moduleName,
          struct: structName,
        });
        return textResult(JSON.stringify(struct, null, 2));
      }

      // ── Epoch & Checkpoint Analytics ──
      case "get_epoch_info": {
        const limit = z.number().int().min(1).max(50).optional().parse(args.limit) ?? 5;
        const order = (args.order as string) === "ascending" ? "ascending" : "descending";
        const epochs = await client.getEpochs({
          limit,
          descendingOrder: order === "descending",
        });
        return textResult(JSON.stringify(epochs, null, 2));
      }

      case "get_checkpoint": {
        const seqNum = z.string().min(1).parse(args.sequenceNumber);
        const checkpoint = await client.getCheckpoint({ id: seqNum });
        return textResult(JSON.stringify(checkpoint, null, 2));
      }

      // ── Protocol & System ──
      case "get_protocol_config": {
        const config = await client.getProtocolConfig({});
        return textResult(JSON.stringify(config, null, 2));
      }

      case "get_system_state": {
        const state = await client.getLatestSuiSystemState();
        const s = state as unknown as {
          epoch: string;
          referenceGasPrice: string;
          storageFundTotalObjectStorageRebates: string;
          totalStake: string;
          activeValidators: Array<{ suiAddress: string; name: string; stakingPoolSuiBalance: string; commissionRate: string }>;
        };
        return textResult(
          JSON.stringify(
            {
              epoch: s.epoch,
              referenceGasPrice: s.referenceGasPrice,
              storageFundRebates: s.storageFundTotalObjectStorageRebates,
              totalStake: formatSui(s.totalStake),
              validatorCount: s.activeValidators.length,
              network: currentNetwork,
            },
            null,
            2
          )
        );
      }

      case "get_committee_info": {
        const epoch = args.epoch as string | undefined;
        const committee = await client.getCommitteeInfo({ epoch: epoch ?? undefined });
        return textResult(JSON.stringify(committee, null, 2));
      }

      // ── Dev Inspect ──
      case "dev_inspect": {
        const sender = AddressSchema.parse(args.sender);
        const target = z.string().regex(/^0x[^:]+::[^:]+::[^:]+$/).parse(args.target);
        const fnArgs = (args.arguments as unknown[]) || [];
        const typeArgs = (args.typeArguments as string[]) || [];

        const tx = new Transaction();
        tx.moveCall({
          target: target as `${string}::${string}::${string}`,
          arguments: fnArgs.map((a) => {
            if (typeof a === "string" && a.startsWith("0x")) return tx.object(a);
            if (typeof a === "number" || typeof a === "bigint") return tx.pure.u64(BigInt(a));
            if (typeof a === "boolean") return tx.pure.bool(a);
            return tx.pure.string(String(a));
          }),
          typeArguments: typeArgs,
        });

        const result = await client.devInspectTransactionBlock({
          transactionBlock: tx,
          sender,
        });
        return textResult(JSON.stringify(result, null, 2));
      }

      // ── Object History ──
      case "get_object_history": {
        const objectId = ObjectIdSchema.parse(args.objectId);
        const limit = z.number().int().min(1).max(100).optional().parse(args.limit) ?? 20;
        const txns = await client.queryTransactionBlocks({
          filter: { ChangedObject: objectId },
          limit,
          order: "descending",
          options: { showEffects: true, showInput: true },
        });
        return textResult(JSON.stringify(txns, null, 2));
      }

      // ── Total Transactions ──
      case "get_total_transactions": {
        const total = await client.getTotalTransactionBlocks();
        return textResult(JSON.stringify({ totalTransactions: String(total), network: currentNetwork }, null, 2));
      }

      // ── Move Call Metrics ──
      case "get_move_call_metrics": {
        const metrics = await client.getMoveCallMetrics();
        return textResult(JSON.stringify(metrics, null, 2));
      }

      // ── DeFi: Cetus ──
      case "cetus_get_pools": {
        const coinA = args.coinTypeA ? resolveCoinType(args.coinTypeA as string) : undefined;
        const coinB = args.coinTypeB ? resolveCoinType(args.coinTypeB as string) : undefined;
        const limit = z.number().int().min(1).max(50).optional().parse(args.limit) ?? 10;

        // Query Cetus pool objects by their type
        const poolType = `${CETUS_CLMM_PACKAGE}::pool::Pool`;
        const poolObjects = await client.queryTransactionBlocks({
          filter: { ChangedObject: CETUS_CLMM_PACKAGE },
          limit: 1,
          options: {},
        });

        // Instead, directly query owned objects of the CLMM package for pools
        // We'll search for Pool objects matching the coin types
        let filter: Record<string, unknown> | undefined;
        if (coinA && coinB) {
          filter = { StructType: `${CETUS_CLMM_PACKAGE}::pool::Pool<${coinA}, ${coinB}>` };
        }

        const objects = await client.getOwnedObjects({
          owner: CETUS_CLMM_PACKAGE,
          limit,
          filter: filter as never,
          options: { showType: true, showContent: true },
        });

        // If no owned objects, try querying by type via events
        if (!objects.data?.length && coinA && coinB) {
          // Try reverse order
          const reverseFilter = { StructType: `${CETUS_CLMM_PACKAGE}::pool::Pool<${coinB}, ${coinA}>` };
          const reverseObjects = await client.getOwnedObjects({
            owner: CETUS_CLMM_PACKAGE,
            limit,
            filter: reverseFilter as never,
            options: { showType: true, showContent: true },
          });
          return textResult(JSON.stringify({
            pools: reverseObjects.data || [],
            network: currentNetwork,
            hint: "Use get_object with a known Cetus pool ID for detailed pool data",
          }, null, 2));
        }

        return textResult(JSON.stringify({
          pools: objects.data || [],
          network: currentNetwork,
          hint: "Use get_object with a known Cetus pool ID for detailed pool data",
        }, null, 2));
      }

      case "cetus_get_pool": {
        const poolId = ObjectIdSchema.parse(args.poolId);
        const pool = await client.getObject({
          id: poolId,
          options: { showContent: true, showType: true, showOwner: true },
        });
        return textResult(JSON.stringify(pool, null, 2));
      }

      // ── DeFi: DeepBook ──
      case "deepbook_get_pool": {
        const poolId = ObjectIdSchema.parse(args.poolId);
        const pool = await client.getObject({
          id: poolId,
          options: { showContent: true, showType: true },
        });
        // Also get dynamic fields for order book data
        const fields = await client.getDynamicFields({ parentId: poolId, limit: 10 });
        return textResult(JSON.stringify({ pool, dynamicFields: fields, network: currentNetwork }, null, 2));
      }

      // ── DeFi: Token Price ──
      case "get_token_price": {
        const tokenInput = z.string().min(1).parse(args.token);
        const coinType = resolveCoinType(tokenInput);

        if (coinType === COMMON_COIN_TYPES.SUI || tokenInput.toUpperCase() === "SUI") {
          // Get SUI price via Cetus SUI/USDC pool on mainnet
          // Well-known Cetus SUI/USDC pool
          const suiUsdcPool = "0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688571";
          try {
            const poolData = await client.getObject({
              id: suiUsdcPool,
              options: { showContent: true },
            });
            return textResult(JSON.stringify({
              token: "SUI",
              coinType,
              pool: suiUsdcPool,
              poolData: (poolData.data as { content?: unknown })?.content,
              network: currentNetwork,
              note: "Parse current_sqrt_price from pool content. Price = (sqrt_price / 2^64)^2 * 10^(decimalsA - decimalsB)",
            }, null, 2));
          } catch {
            return textResult(JSON.stringify({
              token: tokenInput,
              coinType,
              error: "Pool query failed — ensure you're on mainnet for price data",
              network: currentNetwork,
            }, null, 2));
          }
        }

        // For other tokens, get coin metadata
        try {
          const meta = await client.getCoinMetadata({ coinType });
          return textResult(JSON.stringify({
            token: tokenInput,
            coinType,
            metadata: meta,
            network: currentNetwork,
            hint: "Use cetus_get_pool with a known pool ID to get live price data",
          }, null, 2));
        } catch {
          return errorResult(`Could not find metadata for coin type: ${coinType}`);
        }
      }

      // ── DeFi: Swap Quote ──
      case "swap_quote": {
        const fromCoin = resolveCoinType(z.string().min(1).parse(args.fromCoin));
        const toCoin = resolveCoinType(z.string().min(1).parse(args.toCoin));
        const amount = AmountSchema.parse(args.amount);
        const poolId = ObjectIdSchema.parse(args.poolId);

        // First get pool to determine coin order
        const pool = await client.getObject({
          id: poolId,
          options: { showType: true, showContent: true },
        });

        const poolType = (pool.data as { type?: string })?.type || "";
        const a2b = poolType.includes(fromCoin);

        // Use dev_inspect to simulate the swap
        const sender = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const tx = new Transaction();
        tx.moveCall({
          target: `${CETUS_CLMM_PACKAGE}::pool::get_pool_info`,
          arguments: [tx.object(poolId)],
        });

        try {
          const result = await client.devInspectTransactionBlock({
            transactionBlock: tx,
            sender,
          });
          return textResult(JSON.stringify({
            fromCoin,
            toCoin,
            amount,
            poolId,
            a2b,
            poolInfo: result,
            network: currentNetwork,
            note: "This shows pool state. For exact swap output, use move_call with the pool's swap function.",
          }, null, 2));
        } catch (err) {
          return textResult(JSON.stringify({
            fromCoin,
            toCoin,
            amount,
            poolId,
            poolType,
            error: sanitizeError(err),
            hint: "Use get_object on the pool to inspect reserves and calculate expected output",
          }, null, 2));
        }
      }

      // ── SuiNS Extended ──
      case "suins_get_name_record": {
        const name = z.string().min(1).parse(args.name);
        const suins = getSuinsClient();
        const record = await suins.getNameRecord(name);
        return textResult(JSON.stringify({
          ...record,
          expirationDate: record?.expirationTimestampMs
            ? new Date(Number(record.expirationTimestampMs)).toISOString()
            : null,
        }, null, 2));
      }

      case "suins_get_price": {
        const name = z.string().min(1).parse(args.name);
        const years = z.number().int().min(1).max(5).optional().parse(args.years) ?? 1;
        const suins = getSuinsClient();
        try {
          const priceList = await suins.getPriceList();
          const renewalPriceList = await suins.getRenewalPriceList();
          const nameLength = name.replace(".sui", "").length;
          return textResult(JSON.stringify({
            name,
            nameLength,
            years,
            registrationPrices: priceList,
            renewalPrices: renewalPriceList,
            note: "Prices are in MIST (1 SUI = 1e9 MIST). Price depends on name length.",
          }, null, 2));
        } catch (err) {
          return errorResult(sanitizeError(err));
        }
      }

      // ── Common Tokens ──
      case "list_common_tokens": {
        return textResult(JSON.stringify({
          tokens: Object.entries(COMMON_COIN_TYPES).map(([symbol, type]) => ({
            symbol,
            coinType: type,
          })),
          network: currentNetwork,
          note: "These are mainnet coin types. Use the symbol as shorthand in other tools (e.g. 'SUI' instead of the full type).",
        }, null, 2));
      }

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResult(sanitizeError(err));
  }
}

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new Server(
  { name: "sui-mcp-server", version: "0.3.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, (args as Record<string, unknown>) ?? {});
});

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`sui-mcp-server v0.3.0 running on ${currentNetwork} (stdio)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
