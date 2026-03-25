# sui-mcp-server

[![npm version](https://img.shields.io/npm/v/sui-mcp-server)](https://www.npmjs.com/package/sui-mcp-server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

MCP server for the **Sui blockchain** — gives AI agents direct access to wallet management, token operations, transactions, Move contract interaction, object queries, staking, and more.

Built on the [Model Context Protocol](https://modelcontextprotocol.io/) with the official [@mysten/sui](https://www.npmjs.com/package/@mysten/sui) SDK.

## Tools

| Category | Tools |
|----------|-------|
| **Wallet** | `create_wallet`, `import_wallet`, `list_wallets`, `get_balance` |
| **Coins** | `get_coins`, `get_all_balances`, `get_coin_metadata` |
| **Transfers** | `transfer_sui`, `transfer_objects`, `merge_coins`, `split_coins` |
| **Objects** | `get_object`, `get_owned_objects`, `get_dynamic_fields` |
| **Transactions** | `get_transaction`, `dry_run_transaction`, `execute_transaction` |
| **Move** | `move_call`, `get_normalized_module`, `get_move_function` |
| **Staking** | `get_stakes`, `request_add_stake`, `request_withdraw_stake`, `get_validators` |
| **Network** | `switch_network`, `get_network_info`, `get_latest_checkpoint`, `get_reference_gas_price` |
| **Faucet** | `request_faucet` |

## Quick Start

```bash
npm install -g sui-mcp-server
sui-mcp-server
```

### Claude Code

Add to `~/.mcp.json`:

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

## Development

```bash
npm install
npm run build
npm start
```

## License

MIT
