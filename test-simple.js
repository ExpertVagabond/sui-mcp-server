#!/usr/bin/env node
// Integration test for sui-mcp-server v0.2.0 using MCP SDK client

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
  console.log("sui-mcp-server v0.3.0 integration tests\n");

  const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
  const client = new Client({ name: "test", version: "1.0" });
  await client.connect(transport);

  // ── Tool Registration ──
  const { tools } = await client.listTools();
  assert("Lists 53 tools", tools.length === 53, `got ${tools.length}`);

  const names = tools.map((t) => t.name);
  for (const expected of [
    "create_wallet", "transfer_sui", "get_object", "move_call",
    "get_stakes", "switch_network", "request_faucet", "resolve_name",
    // v0.2.0 tools
    "resolve_address", "query_events", "query_transactions", "multi_get_objects",
    "get_package_modules", "get_move_struct", "get_epoch_info", "get_checkpoint",
    "get_protocol_config", "get_system_state", "get_committee_info", "dev_inspect",
    "get_object_history", "get_total_transactions", "get_move_call_metrics",
    // v0.3.0 DeFi tools
    "cetus_get_pools", "cetus_get_pool", "deepbook_get_pool", "get_token_price",
    "swap_quote", "suins_get_name_record", "suins_get_price", "list_common_tokens",
  ]) {
    assert(`Has tool: ${expected}`, names.includes(expected));
  }

  // ── Wallet ──
  const wallet = parse(await client.callTool({ name: "create_wallet", arguments: { name: "test-wallet" } }));
  assert("Creates wallet", wallet.name === "test-wallet");
  assert("Wallet has valid address", wallet.address?.startsWith("0x") && wallet.address.length === 66);
  assert("Default network is devnet", wallet.network === "devnet");

  const walletList = parse(await client.callTool({ name: "list_wallets", arguments: {} }));
  assert("Lists 1 wallet", walletList.count === 1);

  const dup = await client.callTool({ name: "create_wallet", arguments: { name: "test-wallet" } });
  assert("Rejects duplicate wallet", dup.isError === true);

  // ── Balance & Coins ──
  const bal = parse(await client.callTool({ name: "get_balance", arguments: { address: wallet.address } }));
  assert("Gets balance (zero for new wallet)", bal.balanceMist === "0");

  const allBal = parse(await client.callTool({ name: "get_all_balances", arguments: { address: wallet.address } }));
  assert("Gets all balances", Array.isArray(allBal.balances));

  // ── Network ──
  const net = parse(await client.callTool({ name: "get_network_info", arguments: {} }));
  assert("Gets network info", net.network === "devnet");
  assert("Has chain ID", typeof net.chainId === "string" && net.chainId.length > 0);
  assert("Has epoch", net.epoch !== undefined);

  // ── New: Total Transactions (on devnet) ──
  const total = parse(await client.callTool({ name: "get_total_transactions", arguments: {} }));
  assert("Gets total transactions", typeof total.totalTransactions === "string" && Number(total.totalTransactions) > 0);

  // ── New: Protocol Config ──
  const proto = await client.callTool({ name: "get_protocol_config", arguments: {} });
  assert("Gets protocol config", !proto.isError);

  // ── New: System State ──
  const state = parse(await client.callTool({ name: "get_system_state", arguments: {} }));
  assert("Gets system state", state.epoch !== undefined);
  assert("Has validator count", state.validatorCount > 0);

  // ── New: Committee Info ──
  const committee = await client.callTool({ name: "get_committee_info", arguments: {} });
  assert("Gets committee info", !committee.isError);

  // ── New: Query Events ──
  const events = await client.callTool({ name: "query_events", arguments: { filter: { MoveEventType: "0x3::validator::StakingRequestEvent" }, limit: 3 } });
  assert("Queries events", !events.isError);

  // ── New: Query Transactions ──
  const txns = await client.callTool({ name: "query_transactions", arguments: { filter: { FromAddress: "0x0000000000000000000000000000000000000000000000000000000000000000" }, limit: 3 } });
  assert("Queries transactions", !txns.isError);

  // ── Switch network ──
  const sw = parse(await client.callTool({ name: "switch_network", arguments: { network: "testnet" } }));
  assert("Switches to testnet", sw.network === "testnet");

  const gas = parse(await client.callTool({ name: "get_reference_gas_price", arguments: {} }));
  assert("Gets gas price on testnet", gas.gasPrice !== undefined && gas.network === "testnet");

  const cp = parse(await client.callTool({ name: "get_latest_checkpoint", arguments: {} }));
  assert("Gets latest checkpoint", typeof cp.checkpoint === "string");

  // ── v0.3.0 DeFi Tools ──
  const tokens = parse(await client.callTool({ name: "list_common_tokens", arguments: {} }));
  assert("Lists common tokens", tokens.tokens.length >= 5);
  assert("Has SUI token", tokens.tokens.some(t => t.symbol === "SUI"));

  // Switch to mainnet for DeFi tests
  await client.callTool({ name: "switch_network", arguments: { network: "mainnet" } });

  const suinsRec = parse(await client.callTool({ name: "suins_get_name_record", arguments: { name: "sui.sui" } }));
  assert("Gets SuiNS name record", suinsRec.name === "sui.sui");
  assert("SuiNS has NFT ID", suinsRec.nftId?.startsWith("0x"));

  const cetusPool = await client.callTool({ name: "cetus_get_pool", arguments: { poolId: "0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688571" } });
  assert("Gets Cetus SUI/USDC pool", !cetusPool.isError);

  // ── Validation ──
  // Switch back to devnet for validation tests
  await client.callTool({ name: "switch_network", arguments: { network: "devnet" } });

  const bad = await client.callTool({ name: "get_balance", arguments: { address: "not-valid" } });
  assert("Rejects invalid address", bad.isError === true);

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
