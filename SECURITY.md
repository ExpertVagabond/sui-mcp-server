# Security Considerations for Sui MCP Server

## ⚠️ Important Security Notice

This MCP server handles cryptographic keys and should be used with caution in production environments.

## Current Security Model

### Key Storage
- **Private keys** and **mnemonic phrases** are stored in memory during runtime
- Keys are stored in a simple `Map<string, WalletData>` structure
- **No persistent storage** - keys are lost when the server restarts
- **No encryption** of in-memory key data

### Security Implications

#### ✅ Current Protections
- Keys are never written to disk
- Memory-only storage means keys don't persist after process termination
- No network transmission of private keys (keys stay local)

#### ⚠️ Current Risks
- Keys are stored in plain text in memory
- Memory dumps could expose private keys
- No access controls on wallet operations
- No audit logging of key operations

## Production Security Recommendations

### 🔒 For Production Deployment

1. **Secure Key Storage**
   ```bash
   # Use hardware security modules (HSM)
   # Or encrypted key vaults like:
   - HashiCorp Vault
   - AWS KMS
   - Azure Key Vault
   - Google Cloud KMS
   ```

2. **Access Controls**
   - Implement authentication for MCP client connections
   - Add role-based access controls for wallet operations
   - Audit all key-related operations

3. **Runtime Security**
   ```bash
   # Run in isolated environments
   docker run --security-opt no-new-privileges \
     --cap-drop ALL \
     sui-mcp-server
   
   # Use memory protection
   # Implement secure memory allocation
   # Clear sensitive data from memory when not needed
   ```

4. **Network Security**
   - Use TLS for all MCP connections
   - Implement proper firewall rules
   - Limit network access to trusted clients only

5. **Key Rotation**
   - Implement regular key rotation policies
   - Use time-limited access tokens
   - Monitor for suspicious key usage patterns

### 🛡️ Development/Testing Security

For development and testing environments:

1. **Use Test Networks Only**
   ```typescript
   // Always use testnet for development
   const client = new SuiClient({ url: getFullnodeUrl('testnet') });
   ```

2. **Test Keys Only**
   - Never use real mainnet keys in development
   - Use dedicated test wallets with minimal funds
   - Rotate test keys regularly

3. **Environment Isolation**
   - Run in containers or VMs
   - Use separate development environments
   - Monitor resource access

## Code Security Improvements Needed

### High Priority
- [ ] Implement secure memory allocation for keys
- [ ] Add key encryption at rest (even in memory)
- [ ] Implement access controls and authentication
- [ ] Add comprehensive audit logging

### Medium Priority
- [ ] Add key expiration and rotation
- [ ] Implement rate limiting for key operations
- [ ] Add memory protection against dumps
- [ ] Secure key import/export functions

### Low Priority
- [ ] Add hardware security module support
- [ ] Implement multi-signature wallet support
- [ ] Add backup and recovery procedures

## Current Use Cases

### ✅ Safe for:
- Development and testing
- Local blockchain development
- Educational purposes
- Testnet operations with test funds

### ⚠️ Use with caution for:
- Production applications
- Mainnet operations
- High-value transactions
- Multi-user environments

### ❌ Not recommended for:
- Exchange operations
- Custody services
- High-frequency trading
- Production financial applications

## Incident Response

If you suspect key compromise:

1. **Immediate Actions**
   - Stop the MCP server immediately
   - Transfer any funds to new secure wallets
   - Rotate all potentially compromised keys
   - Review access logs for suspicious activity

2. **Investigation**
   - Analyze memory dumps if available
   - Check network traffic for key transmission
   - Review all recent transactions
   - Audit client access patterns

3. **Recovery**
   - Generate new keys using secure methods
   - Update all applications with new keys
   - Implement additional security measures
   - Document lessons learned

## Contributing Security Improvements

We welcome security improvements! Please:

1. Review this security model before contributing
2. Follow secure coding practices
3. Test security features thoroughly
4. Document security implications of changes
5. Consider backward compatibility with existing deployments

## Reporting Security Issues

For security vulnerabilities, please:
- **DO NOT** open public issues
- Contact the maintainers privately
- Provide detailed reproduction steps
- Allow time for fixes before disclosure

---

**Remember:** This MCP server is a development tool. Always implement proper security measures for production use!