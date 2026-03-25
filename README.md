# sui-mcp-server

[![npm version](https://img.shields.io/npm/v/sui-mcp-server)](https://www.npmjs.com/package/sui-mcp-server)
[![Tests](https://img.shields.io/badge/tests-59%2F59-brightgreen)](test-simple.js)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io/)

**53-tool MCP server for the Sui blockchain.** Gives AI agents direct access to wallets, DeFi, Move contracts, staking, analytics, and the full Sui RPC surface.

Built on the [Model Context Protocol](https://modelcontextprotocol.io/) with the official [@mysten/sui](https://www.npmjs.com/package/@mysten/sui) v2.11 SDK and [@mysten/suins](https://www.npmjs.com/package/@mysten/suins) for name service.

Tested end-to-end on **devnet** and **testnet** — wallet creation, faucet, transfers, coin splitting/merging, transaction queries, Move inspection, staking, DeFi pool queries, and SuiNS resolution all verified.

## Installation

### Claude Code / Cursor / Windsurf

Add to your MCP config (`~/.mcp.json`):

```json
{
  "mcpServers": {
    "sui": {
      "command": "npx",
      "args": ["-y", "sui-mcp-server"]
    }
  }
}
```

### Global Install

```bash
npm install -g sui-mcp-server
sui-mcp-server
```

### From Source

```bash
git clone https://github.com/ExpertVagabond/sui-mcp-server.git
cd sui-mcp-server
npm install
npm run build
npm start
```

## Tools (53)

### Wallet Management (4)

| Tool | Description |
|------|-------------|
| `create_wallet` | Create a new Ed25519 keypair. Keys are held in memory only — not persisted to disk. |
| `import_wallet` | Import from a Bech32-encoded private key (`suiprivkey...`). |
| `list_wallets` | List all wallets managed in the current session. |
| `get_balance` | Get SUI balance for any address. |

### Coin Operations (4)

| Tool | Description |
|------|-------------|
| `get_all_balances` | Get all coin balances for an address (SUI + all other coin types). |
| `get_coins` | Get coin objects of a specific type owned by an address. |
| `get_coin_metadata` | Get metadata for a coin type (name, symbol, decimals, description). |
| `get_total_supply` | Get total circulating supply of a coin type. |

### Transfers (4)

| Tool | Description |
|------|-------------|
| `transfer_sui` | Transfer SUI between addresses. Amount is in SUI (not MIST). |
| `transfer_objects` | Transfer one or more objects to a recipient. |
| `merge_coins` | Merge multiple coins into one. Handles gas coin conflicts automatically. |
| `split_coins` | Split a coin into multiple coins. Works even with single-coin wallets. |

### Object Queries (5)

| Tool | Description |
|------|-------------|
| `get_object` | Get full details of any on-chain object by ID. |
| `get_owned_objects` | List objects owned by an address, with optional type filtering. |
| `get_dynamic_fields` | Get dynamic fields of an object (for tables, bags, etc.). |
| `multi_get_objects` | Batch-fetch up to 50 objects in one call. |
| `get_object_history` | Trace all transactions that touched a given object (provenance). |

### Transactions (4)

| Tool | Description |
|------|-------------|
| `get_transaction` | Get full transaction details by digest — input, effects, events, object changes. |
| `dry_run_transaction` | Dry-run a transaction to preview effects without executing. |
| `query_transactions` | Search transactions by sender, recipient, input object, changed object, or Move function. |
| `get_total_transactions` | Get the total transaction count on the network. |

### Move Smart Contracts (7)

| Tool | Description |
|------|-------------|
| `move_call` | Execute a Move function call. Supports object refs, integers, booleans, strings. |
| `dev_inspect` | Simulate a Move call without executing — returns results, gas cost, effects. No wallet needed. |
| `get_normalized_module` | Get a full Move module definition (functions, structs). |
| `get_move_function` | Get details of a specific Move function (params, return types, visibility). |
| `get_move_struct` | Get a Move struct definition (fields, abilities, type parameters). |
| `get_package_modules` | List all modules in a Move package with their functions and structs. |
| `get_move_call_metrics` | Get network-wide Move call metrics — most-called packages, modules, functions. |

### Staking (4)

| Tool | Description |
|------|-------------|
| `get_stakes` | Get all staking positions for an address. |
| `request_add_stake` | Stake SUI with a validator. |
| `request_withdraw_stake` | Withdraw staked SUI. |
| `get_validators` | Get the full validator set with APY, commission rates, and stake amounts. |

### Events (1)

| Tool | Description |
|------|-------------|
| `query_events` | Query on-chain events by type, sender, package, module, or transaction digest. |

### Network & Analytics (9)

| Tool | Description |
|------|-------------|
| `switch_network` | Switch between mainnet, testnet, devnet, and localnet. |
| `get_network_info` | Get chain ID, epoch, gas price, and latest checkpoint. |
| `get_latest_checkpoint` | Get the latest checkpoint sequence number. |
| `get_reference_gas_price` | Get the current reference gas price in MIST. |
| `get_checkpoint` | Get detailed checkpoint data by sequence number. |
| `get_epoch_info` | Get historical epoch data (start/end times, stakes, gas summaries). |
| `get_protocol_config` | Get the Sui protocol configuration (limits, features, gas settings). |
| `get_system_state` | Get full system state: epoch, validators, stake distribution, storage fund. |
| `get_committee_info` | Get validator committee information for any epoch. |

### SuiNS Name Service (4)

| Tool | Description |
|------|-------------|
| `resolve_name` | Resolve a SuiNS name (e.g. `example.sui`) to a Sui address. |
| `resolve_address` | Reverse-resolve an address to its SuiNS name(s). |
| `suins_get_name_record` | Get full name record — NFT ID, target address, expiration, metadata. |
| `suins_get_price` | Get SuiNS registration and renewal pricing by name length. |

### DeFi: Cetus DEX (2)

| Tool | Description |
|------|-------------|
| `cetus_get_pools` | Query Cetus CLMM pools by coin types. Returns pool addresses, liquidity, fee rates. |
| `cetus_get_pool` | Get detailed pool data for a specific Cetus pool by object ID. |

### DeFi: DeepBook (1)

| Tool | Description |
|------|-------------|
| `deepbook_get_pool` | Get DeepBook v3 order book data — pool state and dynamic fields. |

### DeFi: Token Tools (3)

| Tool | Description |
|------|-------------|
| `get_token_price` | Get token price by querying DeFi pool reserves. Supports common token shortcuts. |
| `swap_quote` | Get a swap quote by simulating against a pool. Returns estimated output and gas cost. |
| `list_common_tokens` | List common Sui tokens with their full coin type addresses. |

### Faucet (1)

| Tool | Description |
|------|-------------|
| `request_faucet` | Request SUI from the faucet (devnet and testnet only). |

## Token Shortcuts

Use symbol shortcuts instead of full coin type addresses in any tool:

| Shortcut | Full Coin Type |
|----------|---------------|
| `SUI` | `0x2::sui::SUI` |
| `USDC` | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |
| `USDT` | `0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN` |
| `WETH` | `0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN` |
| `DEEP` | `0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP` |

## Networks

The server starts on **devnet** by default. Switch networks at any time with `switch_network`:

| Network | RPC Endpoint |
|---------|-------------|
| `mainnet` | `https://fullnode.mainnet.sui.io:443` |
| `testnet` | `https://fullnode.testnet.sui.io:443` |
| `devnet` | `https://fullnode.devnet.sui.io:443` |
| `localnet` | `http://127.0.0.1:9000` |

## Security

- **Keys are in-memory only** — never written to disk, never logged.
- Private keys are redacted in all error messages.
- Addresses are truncated in error output to prevent leakage.
- Rate limiting: 120 calls per minute (sliding window).
- All inputs validated with Zod strict schemas — rejects unknown fields.

## Architecture

```
src/index.ts          # Single-file MCP server (~1,300 lines)
├── Tool definitions  # 53 tools with Zod input schemas
├── Tool handlers     # Switch-case dispatch with error handling
├── Wallet store      # In-memory Map<string, WalletEntry>
├── Rate limiter      # Sliding window (120/min)
└── Network switcher  # Multi-network SuiJsonRpcClient management
```

**Dependencies:**
- `@modelcontextprotocol/sdk` — MCP protocol (stdio transport)
- `@mysten/sui` v2.11 — Sui JSON-RPC client, transactions, keypairs, faucet
- `@mysten/suins` v1.0 — SuiNS name service queries
- `zod` — Input validation

## Development

```bash
npm install           # Install dependencies
npm run build         # Compile TypeScript
npm run lint          # Type-check without emitting
npm test              # Run 59 integration tests (hits devnet + testnet + mainnet)
npm start             # Start the server (stdio)
npm run dev           # Watch mode
```

## Verified Test Results

Tested on Sui devnet (epoch 42) and testnet (epoch 1049):

```
59 passed, 0 failed, 59 total
```

End-to-end verified:
- Wallet creation and import (Ed25519 + Bech32 private keys)
- Faucet airdrop (10 SUI on devnet)
- SUI transfers between wallets
- Coin split (single-coin gas handling) and merge
- Transaction details, gas costs, object changes
- Move call simulation via `dev_inspect`
- Validator queries (4 on devnet, 118 on testnet)
- SuiNS name records (mainnet)
- Cetus DEX pool queries (mainnet)
- Event and transaction search/filtering
- Protocol config, epoch history, checkpoint data

## Roadmap

- [ ] GraphQL RPC migration (Sui JSON-RPC deprecated July 2026)
- [ ] Cetus/Aftermath/Scallop SDK integration (pending `@mysten/sui` v2 compatibility)
- [ ] NFT and Kiosk framework operations
- [ ] Event streaming via gRPC
- [ ] Move contract deployment and upgrade management

## License

MIT — [Matthew Karsten](https://github.com/ExpertVagabond) / [Purple Squirrel Media](https://purplesquirrelmedia.io)
