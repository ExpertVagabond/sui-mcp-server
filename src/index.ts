#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { 
  SuiClient, 
  getFullnodeUrl
} from "@mysten/sui/client";
import { 
  Ed25519Keypair
} from "@mysten/sui/keypairs/ed25519";
import { 
  fromB64, 
  toB64,
  normalizeSuiAddress,
  isValidSuiAddress
} from "@mysten/sui/utils";
import { generateMnemonic, mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";

// Sui network configurations
const NETWORKS = {
  mainnet: getFullnodeUrl("mainnet"),
  testnet: getFullnodeUrl("testnet"),
  devnet: getFullnodeUrl("devnet"),
  localnet: getFullnodeUrl("localnet")
};

// Wallet storage (in production, use secure storage)
const wallets = new Map<string, { keypair: Ed25519Keypair; name: string; mnemonic?: string }>();

// Initialize client
let client: SuiClient;
let currentNetwork = "devnet";

function initializeClient(network: string = "devnet") {
  currentNetwork = network;
  const rpcUrl = NETWORKS[network as keyof typeof NETWORKS] || NETWORKS.devnet;
  client = new SuiClient({ url: rpcUrl });
}

// Initialize client lazily to avoid startup timeouts
let clientInitialized = false;

function ensureClient() {
  if (!clientInitialized) {
    initializeClient();
    clientInitialized = true;
  }
}

// Add timeout wrapper for network calls
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 10000): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

// Comprehensive tool definitions for Sui
const tools: Tool[] = [
  // Basic Wallet Operations
  {
    name: "create_wallet",
    description: "Create a new Sui wallet with mnemonic phrase",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the wallet" }
      },
      required: ["name"]
    }
  },
  {
    name: "import_wallet",
    description: "Import an existing wallet from mnemonic or private key",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the wallet" },
        mnemonic: { type: "string", description: "Mnemonic phrase (12-24 words)" },
        privateKey: { type: "string", description: "Private key in hex or base64 format" }
      },
      required: ["name"]
    }
  },
  {
    name: "list_wallets",
    description: "List all created/imported wallets",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_wallet_address",
    description: "Get wallet address",
    inputSchema: {
      type: "object",
      properties: {
        walletName: { type: "string", description: "Name of the wallet" }
      },
      required: ["walletName"]
    }
  },
  {
    name: "export_wallet",
    description: "Export wallet private key and mnemonic",
    inputSchema: {
      type: "object",
      properties: {
        walletName: { type: "string", description: "Name of the wallet" }
      },
      required: ["walletName"]
    }
  },

  // Balance and Object Operations
  {
    name: "get_balance",
    description: "Get SUI balance for a wallet",
    inputSchema: {
      type: "object",
      properties: {
        walletName: { type: "string", description: "Name of the wallet" },
        coinType: { type: "string", description: "Coin type (default: 0x2::sui::SUI)" }
      },
      required: ["walletName"]
    }
  },
  {
    name: "get_all_balances",
    description: "Get all coin balances for a wallet",
    inputSchema: {
      type: "object",
      properties: {
        walletName: { type: "string", description: "Name of the wallet" }
      },
      required: ["walletName"]
    }
  },
  {
    name: "get_objects",
    description: "Get owned objects for a wallet",
    inputSchema: {
      type: "object",
      properties: {
        walletName: { type: "string", description: "Name of the wallet" },
        filter: { type: "object", description: "Object filter options" },
        limit: { type: "number", description: "Limit number of objects returned" }
      },
      required: ["walletName"]
    }
  },
  {
    name: "get_object_details",
    description: "Get detailed information about an object",
    inputSchema: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "Object ID" }
      },
      required: ["objectId"]
    }
  },

  // Transaction Operations
  {
    name: "transfer_sui",
    description: "Transfer SUI to another address",
    inputSchema: {
      type: "object",
      properties: {
        fromWallet: { type: "string", description: "Name of the sender wallet" },
        toAddress: { type: "string", description: "Recipient address" },
        amount: { type: "number", description: "Amount in SUI" }
      },
      required: ["fromWallet", "toAddress", "amount"]
    }
  },
  {
    name: "transfer_object",
    description: "Transfer an object to another address",
    inputSchema: {
      type: "object",
      properties: {
        fromWallet: { type: "string", description: "Name of the sender wallet" },
        toAddress: { type: "string", description: "Recipient address" },
        objectId: { type: "string", description: "Object ID to transfer" }
      },
      required: ["fromWallet", "toAddress", "objectId"]
    }
  },

  // Transaction History and Info
  {
    name: "get_transaction",
    description: "Get transaction details by digest",
    inputSchema: {
      type: "object",
      properties: {
        digest: { type: "string", description: "Transaction digest" }
      },
      required: ["digest"]
    }
  },
  {
    name: "get_transactions",
    description: "Get transaction history for an address",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address to get transactions for" },
        limit: { type: "number", description: "Limit number of transactions" }
      },
      required: ["address"]
    }
  },
  {
    name: "get_wallet_transactions",
    description: "Get transaction history for a wallet",
    inputSchema: {
      type: "object",
      properties: {
        walletName: { type: "string", description: "Name of the wallet" },
        limit: { type: "number", description: "Limit number of transactions" }
      },
      required: ["walletName"]
    }
  },

  // Gas and Fee Operations
  {
    name: "get_gas_price",
    description: "Get current gas price",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "request_tokens_from_faucet",
    description: "Request test SUI from faucet (testnet/devnet only)",
    inputSchema: {
      type: "object",
      properties: {
        walletName: { type: "string", description: "Name of the wallet" }
      },
      required: ["walletName"]
    }
  },

  // Network Operations
  {
    name: "switch_network",
    description: "Switch Sui network",
    inputSchema: {
      type: "object",
      properties: {
        network: { type: "string", enum: ["mainnet", "testnet", "devnet", "localnet"], description: "Network to switch to" }
      },
      required: ["network"]
    }
  },
  {
    name: "get_network_info",
    description: "Get current network information",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_chain_id",
    description: "Get chain identifier",
    inputSchema: { type: "object", properties: {} }
  },

  // Validator and Staking
  {
    name: "get_validators",
    description: "Get list of active validators",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_validator_info",
    description: "Get detailed information about a validator",
    inputSchema: {
      type: "object",
      properties: {
        validatorAddress: { type: "string", description: "Validator Sui address" }
      },
      required: ["validatorAddress"]
    }
  },

  // Utility Operations
  {
    name: "validate_address",
    description: "Validate if an address is a valid Sui address",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address to validate" }
      },
      required: ["address"]
    }
  },
  {
    name: "normalize_address",
    description: "Normalize a Sui address to full length",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address to normalize" }
      },
      required: ["address"]
    }
  },
  {
    name: "convert_mist_to_sui",
    description: "Convert MIST to SUI",
    inputSchema: {
      type: "object",
      properties: {
        mist: { type: "string", description: "Amount in MIST" }
      },
      required: ["mist"]
    }
  },
  {
    name: "convert_sui_to_mist",
    description: "Convert SUI to MIST",
    inputSchema: {
      type: "object",
      properties: {
        sui: { type: "number", description: "Amount in SUI" }
      },
      required: ["sui"]
    }
  }
];

// Tool handlers
async function handleCreateWallet(args: any) {
  const { name } = args;
  
  if (wallets.has(name)) {
    throw new Error(`Wallet with name '${name}' already exists`);
  }

  const mnemonic = generateMnemonic();
  const seed = mnemonicToSeedSync(mnemonic);
  
  const { key } = derivePath("m/44'/784'/0'/0'/0'", seed.toString("hex"));
  const keypair = Ed25519Keypair.fromSecretKey(key);

  wallets.set(name, { keypair, name, mnemonic });

  return {
    success: true,
    wallet: {
      name,
      address: keypair.getPublicKey().toSuiAddress(),
      mnemonic
    }
  };
}

async function handleImportWallet(args: any) {
  const { name, mnemonic, privateKey } = args;
  
  if (wallets.has(name)) {
    throw new Error(`Wallet with name '${name}' already exists`);
  }

  let keypair: Ed25519Keypair;

  try {
    if (mnemonic) {
      const seed = mnemonicToSeedSync(mnemonic);
      const { key } = derivePath("m/44'/784'/0'/0'/0'", seed.toString("hex"));
      keypair = Ed25519Keypair.fromSecretKey(key);
    } else if (privateKey) {
      // Try to parse as hex or base64
      let secretKey: Uint8Array;
      try {
        if (privateKey.startsWith('0x')) {
          secretKey = new Uint8Array(Buffer.from(privateKey.slice(2), 'hex'));
        } else {
          try {
            secretKey = fromB64(privateKey);
          } catch {
            secretKey = new Uint8Array(Buffer.from(privateKey, 'hex'));
          }
        }
      } catch {
        throw new Error('Invalid private key format');
      }
      
      keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
      throw new Error('Either mnemonic or privateKey must be provided');
    }

    wallets.set(name, { keypair, name, mnemonic });

    return {
      success: true,
      wallet: {
        name,
        address: keypair.getPublicKey().toSuiAddress()
      }
    };
  } catch (error) {
    throw new Error(`Failed to import wallet: ${error}`);
  }
}

async function handleListWallets() {
  const walletList = Array.from(wallets.values()).map(wallet => ({
    name: wallet.name,
    address: wallet.keypair.getPublicKey().toSuiAddress()
  }));

  return {
    wallets: walletList,
    count: walletList.length
  };
}

async function handleGetBalance(args: any) {
  const { walletName, coinType = "0x2::sui::SUI" } = args;
  
  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureClient();
  const address = wallet.keypair.getPublicKey().toSuiAddress();
  const balance = await withTimeout(client.getBalance({
    owner: address,
    coinType
  }));

  const suiBalance = Number(balance.totalBalance) / 1_000_000_000; // Convert MIST to SUI

  return {
    wallet: walletName,
    address,
    coinType,
    balance: {
      totalBalance: balance.totalBalance,
      sui: suiBalance,
      coinObjectCount: balance.coinObjectCount
    }
  };
}

async function handleGetAllBalances(args: any) {
  const { walletName } = args;
  
  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureClient();
  const address = wallet.keypair.getPublicKey().toSuiAddress();
  const balances = await withTimeout(client.getAllBalances({ owner: address }));

  return {
    wallet: walletName,
    address,
    balances: balances.map(balance => ({
      coinType: balance.coinType,
      totalBalance: balance.totalBalance,
      sui: Number(balance.totalBalance) / 1_000_000_000, // Convert MIST to SUI if SUI coin
      coinObjectCount: balance.coinObjectCount
    }))
  };
}

async function handleGetNetworkInfo() {
  ensureClient();
  try {
    const chainId = await withTimeout(client.getChainIdentifier());
    
    return {
      network: currentNetwork,
      rpcUrl: NETWORKS[currentNetwork as keyof typeof NETWORKS],
      chainId
    };
  } catch (error) {
    return {
      network: currentNetwork,
      rpcUrl: NETWORKS[currentNetwork as keyof typeof NETWORKS],
      error: "Failed to fetch network details"
    };
  }
}

async function handleSwitchNetwork(args: any) {
  const { network } = args;
  
  if (!NETWORKS[network as keyof typeof NETWORKS]) {
    throw new Error(`Unsupported network: ${network}`);
  }
  
  initializeClient(network);
  
  return {
    success: true,
    previousNetwork: currentNetwork,
    currentNetwork: network,
    rpcUrl: NETWORKS[network as keyof typeof NETWORKS]
  };
}

async function handleRequestTokensFromFaucet(args: any) {
  const { walletName } = args;
  
  if (currentNetwork === "mainnet") {
    throw new Error("Faucet is not available on mainnet");
  }

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  // Note: This would require the faucet client which is not in the main Sui package
  // For now, we'll return a placeholder response
  return {
    success: false,
    message: "Faucet functionality requires additional setup. Use the Sui CLI or web faucet.",
    address: wallet.keypair.getPublicKey().toSuiAddress(),
    faucetUrl: `https://faucet.${currentNetwork}.sui.io/`
  };
}

async function handleValidateAddress(args: any) {
  const { address } = args;
  
  try {
    const isValid = isValidSuiAddress(address);
    return {
      address,
      valid: isValid,
      normalized: isValid ? normalizeSuiAddress(address) : null,
      message: isValid ? "Valid Sui address" : "Invalid Sui address"
    };
  } catch (error) {
    return {
      address,
      valid: false,
      message: "Invalid Sui address format"
    };
  }
}

async function handleNormalizeAddress(args: any) {
  const { address } = args;
  
  try {
    const normalized = normalizeSuiAddress(address);
    return {
      original: address,
      normalized,
      valid: true
    };
  } catch (error) {
    return {
      original: address,
      normalized: null,
      valid: false,
      error: "Invalid address format"
    };
  }
}

async function handleConvertMistToSui(args: any) {
  const { mist } = args;
  const sui = Number(mist) / 1_000_000_000;
  
  return {
    mist,
    sui,
    formatted: `${sui.toFixed(9)} SUI`
  };
}

async function handleConvertSuiToMist(args: any) {
  const { sui } = args;
  const mist = Math.floor(sui * 1_000_000_000);
  
  return {
    sui,
    mist: mist.toString(),
    formatted: `${mist} MIST`
  };
}

// Main server setup
const server = new Server(
  {
    name: "comprehensive-sui-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    
    switch (name) {
      case "create_wallet":
        result = await handleCreateWallet(args);
        break;
      case "import_wallet":
        result = await handleImportWallet(args);
        break;
      case "list_wallets":
        result = await handleListWallets();
        break;
      case "get_balance":
        result = await handleGetBalance(args);
        break;
      case "get_all_balances":
        result = await handleGetAllBalances(args);
        break;
      case "get_network_info":
        result = await handleGetNetworkInfo();
        break;
      case "switch_network":
        result = await handleSwitchNetwork(args);
        break;
      case "request_tokens_from_faucet":
        result = await handleRequestTokensFromFaucet(args);
        break;
      case "validate_address":
        result = await handleValidateAddress(args);
        break;
      case "normalize_address":
        result = await handleNormalizeAddress(args);
        break;
      case "convert_mist_to_sui":
        result = await handleConvertMistToSui(args);
        break;
      case "convert_sui_to_mist":
        result = await handleConvertSuiToMist(args);
        break;
      default:
        // For unimplemented commands, return a placeholder response
        result = {
          message: `Command '${name}' is recognized but not yet implemented`,
          args: args,
          status: "placeholder"
        };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Comprehensive Sui MCP server running on stdio");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});