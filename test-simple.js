#!/usr/bin/env node
// Integration test for sui-mcp-server using MCP SDK client

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name} ${detail}`);
    failed++;
  }
}

function parse(result) {
  return JSON.parse(result.content[0].text);
}

async function run() {
  console.log("sui-mcp-server integration tests\n");

  const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
  const client = new Client({ name: "test", version: "1.0" });
  await client.connect(transport);

  // List tools
  const { tools } = await client.listTools();
  assert("Lists 30 tools", tools.length === 30, `got ${tools.length}`);

  const names = tools.map((t) => t.name);
  for (const expected of [
    "create_wallet", "transfer_sui", "get_object", "move_call",
    "get_stakes", "switch_network", "request_faucet", "resolve_name",
  ]) {
    assert(`Has tool: ${expected}`, names.includes(expected));
  }

  // Create wallet
  const wallet = parse(await client.callTool({ name: "create_wallet", arguments: { name: "test-wallet" } }));
  assert("Creates wallet", wallet.name === "test-wallet");
  assert("Wallet has address", wallet.address?.startsWith("0x") && wallet.address.length === 66);
  assert("Default network is devnet", wallet.network === "devnet");

  // List wallets
  const walletList = parse(await client.callTool({ name: "list_wallets", arguments: {} }));
  assert("Lists 1 wallet", walletList.count === 1);

  // Duplicate wallet fails
  const dup = await client.callTool({ name: "create_wallet", arguments: { name: "test-wallet" } });
  assert("Rejects duplicate wallet", dup.isError === true);

  // Get balance (new wallet = 0)
  const bal = parse(await client.callTool({ name: "get_balance", arguments: { address: wallet.address } }));
  assert("Gets balance", bal.balanceMist === "0");

  // Get network info
  const net = parse(await client.callTool({ name: "get_network_info", arguments: {} }));
  assert("Gets network info", net.network === "devnet");
  assert("Has chain ID", typeof net.chainId === "string" && net.chainId.length > 0);
  assert("Has epoch", net.epoch !== undefined);
  assert("Has checkpoint", net.latestCheckpoint !== undefined);

  // Switch network
  const sw = parse(await client.callTool({ name: "switch_network", arguments: { network: "testnet" } }));
  assert("Switches to testnet", sw.network === "testnet");

  // Gas price on testnet
  const gas = parse(await client.callTool({ name: "get_reference_gas_price", arguments: {} }));
  assert("Gets gas price", gas.gasPrice !== undefined);
  assert("Gas price on testnet", gas.network === "testnet");

  // Latest checkpoint
  const cp = parse(await client.callTool({ name: "get_latest_checkpoint", arguments: {} }));
  assert("Gets checkpoint", typeof cp.checkpoint === "string");

  // Invalid address fails
  const bad = await client.callTool({ name: "get_balance", arguments: { address: "not-valid" } });
  assert("Rejects invalid address", bad.isError === true);

  // Invalid wallet name fails
  const badName = await client.callTool({ name: "create_wallet", arguments: { name: "has spaces!" } });
  assert("Rejects invalid wallet name", badName.isError === true);

  // Summary
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
