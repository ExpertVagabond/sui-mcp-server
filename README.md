# Sui MCP Server

A comprehensive Model Context Protocol (MCP) server for Sui blockchain interactions. This server provides wallet management, transaction handling, and blockchain operations for Sui network.

## Features

### 🔐 Wallet Management
- Create new wallets with mnemonic phrases
- Import wallets from mnemonic or private key
- List all wallets
- Export wallet details
- Secure key management

### 💰 Balance & Object Operations
- Get SUI balance for wallets
- Get all coin balances
- View owned objects
- Get detailed object information

### 🔄 Transaction Operations
- Transfer SUI between addresses
- Transfer objects
- Get transaction details
- View transaction history

### 🌐 Network Operations
- Switch between networks (mainnet, testnet, devnet, localnet)
- Get network information
- Get chain identifier

### ⚡ Gas & Fees
- Get current gas prices
- Request tokens from faucet (testnet/devnet)

### 🔍 Validator & Staking
- Get validator information
- Staking operations

### 🛠 Utility Functions
- Address validation and normalization
- MIST to SUI conversion
- SUI to MIST conversion

## Installation

### From NPM
```bash
npm install -g @ExpertVagabond/sui-mcp-server
```

### From Source
```bash
git clone https://github.com/ExpertVagabond/sui-mcp-server.git
cd sui-mcp-server
npm install
npm run build
```

## Usage

### As MCP Server
```bash
sui-mcp-server
```

### Development
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Test
```bash
npm test
```

## Available Tools

### Wallet Operations
- `create_wallet` - Create a new Sui wallet
- `import_wallet` - Import wallet from mnemonic/private key
- `list_wallets` - List all wallets
- `get_wallet_address` - Get wallet address
- `export_wallet` - Export wallet details

### Balance Operations
- `get_balance` - Get SUI balance
- `get_all_balances` - Get all coin balances

### Object Operations
- `get_objects` - Get owned objects
- `get_object_details` - Get object details

### Transaction Operations
- `transfer_sui` - Transfer SUI
- `transfer_object` - Transfer objects
- `get_transaction` - Get transaction details
- `get_transactions` - Get transaction history
- `get_wallet_transactions` - Get wallet transaction history

### Network Operations
- `switch_network` - Switch networks
- `get_network_info` - Get network info
- `get_chain_id` - Get chain ID

### Gas Operations
- `get_gas_price` - Get gas price
- `request_tokens_from_faucet` - Request test tokens

### Validator Operations
- `get_validators` - Get validators
- `get_validator_info` - Get validator info

### Utility Operations
- `validate_address` - Validate address
- `normalize_address` - Normalize address
- `convert_mist_to_sui` - Convert MIST to SUI
- `convert_sui_to_mist` - Convert SUI to MIST

## Network Support

- **Mainnet** - Production Sui network
- **Testnet** - Sui testnet for testing
- **Devnet** - Sui development network
- **Localnet** - Local Sui network

## Security Notes

⚠️ **Warning**: This server stores private keys in memory during runtime. In production environments, ensure proper security measures:

- Use secure key storage solutions
- Implement proper access controls
- Run in isolated environments
- Regularly rotate keys
- Monitor for suspicious activities

## Dependencies

- `@mysten/sui` - Official Sui TypeScript SDK
- `@modelcontextprotocol/sdk` - MCP SDK
- `bip39` - Mnemonic phrase generation
- `ed25519-hd-key` - HD key derivation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/ExpertVagabond/sui-mcp-server/issues)
- Documentation: [Sui Documentation](https://docs.sui.io/)

## Changelog

### v1.0.0
- Initial release
- Basic wallet operations
- Transaction handling
- Network operations
- Utility functions