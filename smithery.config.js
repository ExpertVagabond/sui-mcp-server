export default {
  // Entry point for the MCP server
  entry: "./src/index.ts",
  
  // Build configuration
  build: {
    outDir: ".smithery",
    target: "node18",
    format: "cjs"
  },
  
  // Server configuration
  server: {
    name: "comprehensive-sui-mcp-server",
    version: "1.0.0",
    description: "Comprehensive Sui blockchain MCP server for wallet management, transactions, and blockchain operations",
    transport: "stdio"
  },
  
  // Development configuration
  dev: {
    port: 8181,
    hot: true
  }
};