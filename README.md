# sui-mcp-server

[![npm version](https://img.shields.io/npm/v/sui-mcp-server)](https://www.npmjs.com/package/sui-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?logo=node.js)](https://nodejs.org)
[![Tools](https://img.shields.io/badge/tools-53-blue)](https://modelcontextprotocol.io)

**The most comprehensive Sui blockchain MCP server.** 53 tools with GraphQL + JSON-RPC dual transport -- wallets, DeFi (Cetus, DeepBook), SuiNS, staking, validators, Move introspection, and the full Sui RPC surface.

Competitors offer 10-15 tools for basic operations. This server covers the entire Sui ecosystem in a single package.

## Install

```bash
npx sui-mcp-server
```

Or install globally:

```bash
npm install -g sui-mcp-server
sui-mcp-server
```

## Configure

Add to your MCP config (`claude_desktop_config.json` or `~/.mcp.json`):

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

No API key required -- connects directly to Sui public RPC nodes.

## Tools (53)

### Wallet Management (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `create_wallet` | Create a new Ed25519 keypair (in-memory only, not persisted) | -- |
| `import_wallet` | Import from a Bech32-encoded private key (`suiprivkey...`) | `privateKey` |
| `list_wallets` | List all wallets in the current session | -- |
| `get_balance` | Get SUI balance for any address | `address` |

### Coin Operations (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_all_balances` | All coin balances for an address (SUI + other coin types) | `address` |
| `get_coins` | Coin objects of a specific type owned by an address | `address`, `coinType` |
| `get_coin_metadata` | Metadata for a coin type (name, symbol, decimals) | `coinType` |
| `get_total_supply` | Total circulating supply of a coin type | `coinType` |

### Transfers (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `transfer_sui` | Transfer SUI between addresses (amount in SUI, not MIST) | `from`, `to`, `amount` |
| `transfer_objects` | Transfer one or more objects to a recipient | `from`, `objectIds`, `to` |
| `merge_coins` | Merge multiple coins into one (handles gas conflicts) | `walletName`, `coinType` |
| `split_coins` | Split a coin into multiple coins | `walletName`, `coinId`, `amounts` |

### Object Queries (5)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_object` | Full details of any on-chain object by ID | `objectId` |
| `get_owned_objects` | Objects owned by an address with optional type filtering | `address`, `type` |
| `get_dynamic_fields` | Dynamic fields of an object (tables, bags) | `parentId` |
| `multi_get_objects` | Batch-fetch up to 50 objects in one call | `objectIds` |
| `get_object_history` | Trace all transactions that touched a given object | `objectId` |

### Transactions (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_transaction` | Full transaction details by digest | `digest` |
| `dry_run_transaction` | Dry-run to preview effects without executing | `txBytes` |
| `query_transactions` | Search by sender, recipient, object, or Move function | `filter` |
| `get_total_transactions` | Total transaction count on the network | -- |

### Move Smart Contracts (7)

| Tool | Description | Key Params |
|------|-------------|------------|
| `move_call` | Execute a Move function call | `walletName`, `target`, `arguments` |
| `dev_inspect` | Simulate a Move call without executing (no wallet needed) | `sender`, `target`, `arguments` |
| `get_normalized_module` | Full Move module definition (functions, structs) | `package`, `module` |
| `get_move_function` | Move function details (params, return types, visibility) | `package`, `module`, `function` |
| `get_move_struct` | Move struct definition (fields, abilities) | `package`, `module`, `struct` |
| `get_package_modules` | List all modules in a Move package | `package` |
| `get_move_call_metrics` | Network-wide Move call metrics | -- |

### Staking (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_stakes` | All staking positions for an address | `address` |
| `request_add_stake` | Stake SUI with a validator | `walletName`, `amount`, `validator` |
| `request_withdraw_stake` | Withdraw staked SUI | `walletName`, `stakedSuiId` |
| `get_validators` | Full validator set with APY, commission, and stake amounts | -- |

### Events (1)

| Tool | Description | Key Params |
|------|-------------|------------|
| `query_events` | Query on-chain events by type, sender, package, or digest | `filter` |

### Network & Analytics (9)

| Tool | Description | Key Params |
|------|-------------|------------|
| `switch_network` | Switch between mainnet, testnet, devnet, localnet | `network` |
| `get_network_info` | Chain ID, epoch, gas price, latest checkpoint | -- |
| `get_latest_checkpoint` | Latest checkpoint sequence number | -- |
| `get_reference_gas_price` | Current reference gas price in MIST | -- |
| `get_checkpoint` | Detailed checkpoint data by sequence number | `sequenceNumber` |
| `get_epoch_info` | Historical epoch data (times, stakes, gas summaries) | `epoch` |
| `get_protocol_config` | Sui protocol configuration (limits, features) | -- |
| `get_system_state` | Full system state: epoch, validators, storage fund | -- |
| `get_committee_info` | Validator committee info for any epoch | `epoch` |

### SuiNS Name Service (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `resolve_name` | Resolve `example.sui` to a Sui address | `name` |
| `resolve_address` | Reverse-resolve an address to SuiNS name(s) | `address` |
| `suins_get_name_record` | Full name record -- NFT ID, target, expiration, metadata | `name` |
| `suins_get_price` | Registration and renewal pricing by name length | `length` |

### DeFi: Cetus DEX (2)

| Tool | Description | Key Params |
|------|-------------|------------|
| `cetus_get_pools` | Query Cetus CLMM pools by coin types | `coinTypeA`, `coinTypeB` |
| `cetus_get_pool` | Detailed pool data for a specific Cetus pool | `poolId` |

### DeFi: DeepBook (1)

| Tool | Description | Key Params |
|------|-------------|------------|
| `deepbook_get_pool` | DeepBook v3 order book data -- pool state and dynamic fields | `poolId` |

### DeFi: Token Tools (3)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_token_price` | Token price by querying DeFi pool reserves | `token` |
| `swap_quote` | Swap quote by simulating against a pool | `tokenIn`, `tokenOut`, `amount` |
| `list_common_tokens` | Common Sui tokens with full coin type addresses | -- |

### Faucet (1)

| Tool | Description | Key Params |
|------|-------------|------------|
| `request_faucet` | Request SUI from faucet (devnet and testnet only) | `address` |

## Why This One?

- **53 tools vs 10-15.** Competitors like 0xdwong/sui-mcp cover basic operations. This server includes DeFi (Cetus, DeepBook), SuiNS, Move introspection, staking, validators, and full analytics.
- **GraphQL + JSON-RPC dual transport.** Built on the official `@mysten/sui` v2.11 SDK with `@mysten/suins` for name service -- future-proofed for the GraphQL migration.
- **Tested end-to-end.** 59 passing tests across devnet, testnet, and mainnet. Wallet creation, transfers, staking, DeFi queries, SuiNS resolution, and Move inspection all verified.

## Token Shortcuts

Use symbol shortcuts instead of full coin type addresses:

| Shortcut | Full Coin Type |
|----------|---------------|
| `SUI` | `0x2::sui::SUI` |
| `USDC` | `0xdba34672e...::usdc::USDC` |
| `USDT` | `0xc060006111...::coin::COIN` |
| `WETH` | `0xaf8cd5edc1...::coin::COIN` |
| `DEEP` | `0xdeeb7a4662...::deep::DEEP` |

## Networks

Starts on **devnet** by default. Switch at any time with `switch_network`:

| Network | RPC Endpoint |
|---------|-------------|
| `mainnet` | `https://fullnode.mainnet.sui.io:443` |
| `testnet` | `https://fullnode.testnet.sui.io:443` |
| `devnet` | `https://fullnode.devnet.sui.io:443` |
| `localnet` | `http://127.0.0.1:9000` |

## Security

- Keys are in-memory only -- never written to disk, never logged
- Private keys redacted from all error messages
- Rate limiting: 120 calls/minute (sliding window)
- All inputs validated with Zod strict schemas

## Development

```bash
git clone https://github.com/ExpertVagabond/sui-mcp-server.git
cd sui-mcp-server
npm install
npm run build
npm start
```

## License

MIT -- [Matthew Karsten](https://github.com/ExpertVagabond) / [Purple Squirrel Media](https://purplesquirrelmedia.io)
