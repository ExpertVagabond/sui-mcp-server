# sui-mcp-server

[![npm version](https://img.shields.io/npm/v/sui-mcp-server)](https://www.npmjs.com/package/sui-mcp-server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

MCP server for the **Sui blockchain** — gives AI agents direct access to wallet management, token operations, transactions, Move contract interaction, object queries, staking, analytics, and more.

Built on the [Model Context Protocol](https://modelcontextprotocol.io/) with the official [@mysten/sui](https://www.npmjs.com/package/@mysten/sui) SDK. **45 tools** across 11 categories.

## Tools

| Category | Tools |
|----------|-------|
| **Wallet** | `create_wallet`, `import_wallet`, `list_wallets`, `get_balance` |
| **Coins** | `get_coins`, `get_all_balances`, `get_coin_metadata`, `get_total_supply` |
| **Transfers** | `transfer_sui`, `transfer_objects`, `merge_coins`, `split_coins` |
| **Objects** | `get_object`, `get_owned_objects`, `get_dynamic_fields`, `multi_get_objects`, `get_object_history` |
| **Transactions** | `get_transaction`, `dry_run_transaction`, `query_transactions`, `get_total_transactions` |
| **Move** | `move_call`, `get_normalized_module`, `get_move_function`, `get_move_struct`, `get_package_modules`, `dev_inspect`, `get_move_call_metrics` |
| **Staking** | `get_stakes`, `request_add_stake`, `request_withdraw_stake`, `get_validators` |
| **Events** | `query_events` |
| **Network** | `switch_network`, `get_network_info`, `get_latest_checkpoint`, `get_reference_gas_price`, `get_checkpoint`, `get_epoch_info`, `get_protocol_config`, `get_system_state`, `get_committee_info` |
| **SuiNS** | `resolve_name`, `resolve_address` |
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
npm test     # 46 integration tests
npm start
```

## License

MIT
