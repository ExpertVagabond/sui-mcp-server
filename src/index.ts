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
import { z } from "zod";

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

function switchClient(network: NetworkType): void {
  currentNetwork = network;
  if (network === "localnet") {
    client = new SuiJsonRpcClient({ url: "http://127.0.0.1:9000", network: "custom" as never });
  } else {
    client = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(network),
      network,
    });
  }
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
        tx.mergeCoins(
          tx.object(primaryCoin),
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

        const tx = new Transaction();
        const newCoins = tx.splitCoins(
          tx.object(coinId),
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

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResult(sanitizeError(err));
  }
}

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new Server(
  { name: "sui-mcp-server", version: "0.1.0" },
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
  console.error(`sui-mcp-server v0.1.0 running on ${currentNetwork} (stdio)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
