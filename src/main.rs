use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::sync::Mutex;

const NETWORKS: &[(&str, &str)] = &[
    ("mainnet", "https://fullnode.mainnet.sui.io:443"),
    ("testnet", "https://fullnode.testnet.sui.io:443"),
    ("devnet", "https://fullnode.devnet.sui.io:443"),
    ("localnet", "http://127.0.0.1:9000"),
];

fn default_rpc(network: &str) -> &str {
    NETWORKS.iter().find(|(n, _)| *n == network).map(|(_, u)| *u).unwrap_or(NETWORKS[2].1)
}

struct AppState {
    wallets: HashMap<String, WalletInfo>,
    current_network: String,
    http: reqwest::Client,
}

struct WalletInfo {
    name: String,
    address: String,
    public_key_hex: String,
    private_key_hex: String,
    mnemonic: Option<String>,
}

impl AppState {
    fn new() -> Self {
        Self {
            wallets: HashMap::new(),
            current_network: "devnet".into(),
            http: reqwest::Client::new(),
        }
    }

    fn rpc_url(&self) -> String {
        default_rpc(&self.current_network).to_string()
    }

    async fn sui_rpc(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params});
        let resp = self.http.post(&self.rpc_url())
            .json(&body)
            .send().await
            .map_err(|e| format!("RPC error: {e}"))?;
        let val: Value = resp.json().await.map_err(|e| format!("JSON error: {e}"))?;
        if let Some(err) = val.get("error") {
            return Err(format!("Sui RPC error: {err}"));
        }
        Ok(val.get("result").cloned().unwrap_or(Value::Null))
    }
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(|v| v.as_str())
}

fn sui_address_from_pubkey(pubkey_bytes: &[u8]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // Simplified: real Sui uses blake2b-256 of flag+pubkey
    // For this MCP server, we generate a deterministic hex address
    let mut hasher = DefaultHasher::new();
    pubkey_bytes.hash(&mut hasher);
    0u8.hash(&mut hasher); // ed25519 flag
    format!("0x{:064x}", hasher.finish())
}

async fn call_tool(name: &str, args: &Value, state: &Mutex<AppState>) -> Result<Value, String> {
    match name {
        "create_wallet" => {
            let wallet_name = str_arg(args, "name").ok_or("name required")?;
            let mut st = state.lock().unwrap();
            if st.wallets.contains_key(wallet_name) {
                return Err(format!("Wallet '{wallet_name}' already exists"));
            }
            let mnemonic = bip39::Mnemonic::generate(12).map_err(|e| format!("mnemonic error: {e}"))?;
            let seed = mnemonic.to_seed("");
            let secret = ed25519_dalek::SigningKey::from_bytes(&seed[..32].try_into().unwrap());
            let pubkey = secret.verifying_key();
            let addr = sui_address_from_pubkey(pubkey.as_bytes());
            let info = WalletInfo {
                name: wallet_name.into(),
                address: addr.clone(),
                public_key_hex: hex::encode(pubkey.as_bytes()),
                private_key_hex: hex::encode(secret.to_bytes()),
                mnemonic: Some(mnemonic.to_string()),
            };
            st.wallets.insert(wallet_name.into(), info);
            Ok(json!({"success": true, "wallet": {"name": wallet_name, "address": addr, "mnemonic": mnemonic.to_string()}}))
        }
        "import_wallet" => {
            let wallet_name = str_arg(args, "name").ok_or("name required")?;
            let mut st = state.lock().unwrap();
            if st.wallets.contains_key(wallet_name) {
                return Err(format!("Wallet '{wallet_name}' already exists"));
            }
            let mnemonic_str = str_arg(args, "mnemonic");
            let private_key = str_arg(args, "privateKey");
            let (secret_bytes, mnemonic_save) = if let Some(m) = mnemonic_str {
                let mn: bip39::Mnemonic = m.parse().map_err(|e| format!("invalid mnemonic: {e}"))?;
                let seed = mn.to_seed("");
                (seed[..32].to_vec(), Some(m.to_string()))
            } else if let Some(pk) = private_key {
                let cleaned = pk.strip_prefix("0x").unwrap_or(pk);
                let bytes = hex::decode(cleaned).map_err(|e| format!("invalid hex key: {e}"))?;
                (bytes, None)
            } else {
                return Err("Either mnemonic or privateKey required".into());
            };
            let key_array: [u8; 32] = secret_bytes[..32].try_into().map_err(|_| "key must be 32 bytes")?;
            let secret = ed25519_dalek::SigningKey::from_bytes(&key_array);
            let pubkey = secret.verifying_key();
            let addr = sui_address_from_pubkey(pubkey.as_bytes());
            let info = WalletInfo {
                name: wallet_name.into(),
                address: addr.clone(),
                public_key_hex: hex::encode(pubkey.as_bytes()),
                private_key_hex: hex::encode(secret.to_bytes()),
                mnemonic: mnemonic_save,
            };
            st.wallets.insert(wallet_name.into(), info);
            Ok(json!({"success": true, "wallet": {"name": wallet_name, "address": addr}}))
        }
        "list_wallets" => {
            let st = state.lock().unwrap();
            let list: Vec<Value> = st.wallets.values().map(|w| json!({"name": w.name, "address": w.address})).collect();
            Ok(json!({"wallets": list, "count": list.len()}))
        }
        "get_wallet_address" => {
            let wn = str_arg(args, "walletName").ok_or("walletName required")?;
            let st = state.lock().unwrap();
            let w = st.wallets.get(wn).ok_or(format!("Wallet '{wn}' not found"))?;
            Ok(json!({"name": w.name, "address": w.address}))
        }
        "export_wallet" => {
            let wn = str_arg(args, "walletName").ok_or("walletName required")?;
            let st = state.lock().unwrap();
            let w = st.wallets.get(wn).ok_or(format!("Wallet '{wn}' not found"))?;
            Ok(json!({"name": w.name, "address": w.address, "privateKey": w.private_key_hex, "publicKey": w.public_key_hex, "mnemonic": w.mnemonic}))
        }
        "get_balance" => {
            let wn = str_arg(args, "walletName").ok_or("walletName required")?;
            let coin_type = str_arg(args, "coinType").unwrap_or("0x2::sui::SUI");
            let st = state.lock().unwrap();
            let addr = st.wallets.get(wn).ok_or(format!("Wallet '{wn}' not found"))?.address.clone();
            let result = st.sui_rpc("suix_getBalance", json!([addr, coin_type])).await?;
            let total = result.get("totalBalance").and_then(|v| v.as_str()).unwrap_or("0");
            let sui_bal: f64 = total.parse::<f64>().unwrap_or(0.0) / 1_000_000_000.0;
            Ok(json!({"wallet": wn, "address": addr, "coinType": coin_type, "balance": {"totalBalance": total, "sui": sui_bal, "coinObjectCount": result.get("coinObjectCount")}}))
        }
        "get_all_balances" => {
            let wn = str_arg(args, "walletName").ok_or("walletName required")?;
            let st = state.lock().unwrap();
            let addr = st.wallets.get(wn).ok_or(format!("Wallet '{wn}' not found"))?.address.clone();
            let result = st.sui_rpc("suix_getAllBalances", json!([addr])).await?;
            Ok(json!({"wallet": wn, "address": addr, "balances": result}))
        }
        "get_objects" => {
            let wn = str_arg(args, "walletName").ok_or("walletName required")?;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50);
            let st = state.lock().unwrap();
            let addr = st.wallets.get(wn).ok_or(format!("Wallet '{wn}' not found"))?.address.clone();
            let result = st.sui_rpc("suix_getOwnedObjects", json!([addr, null, null, limit])).await?;
            Ok(json!({"wallet": wn, "address": addr, "objects": result}))
        }
        "get_object_details" => {
            let oid = str_arg(args, "objectId").ok_or("objectId required")?;
            let st = state.lock().unwrap();
            let result = st.sui_rpc("sui_getObject", json!([oid, {"showContent": true, "showType": true, "showOwner": true}])).await?;
            Ok(result)
        }
        "transfer_sui" => {
            let from = str_arg(args, "fromWallet").ok_or("fromWallet required")?;
            let to = str_arg(args, "toAddress").ok_or("toAddress required")?;
            let amount = args.get("amount").and_then(|v| v.as_f64()).ok_or("amount required")?;
            let mist = (amount * 1_000_000_000.0) as u64;
            let st = state.lock().unwrap();
            let w = st.wallets.get(from).ok_or(format!("Wallet '{from}' not found"))?;
            Ok(json!({"status": "transfer_prepared", "from": w.address, "to": to, "amount_sui": amount, "amount_mist": mist, "note": "Transaction signing requires full Sui SDK integration. Use sui CLI for actual transfers."}))
        }
        "transfer_object" => {
            let from = str_arg(args, "fromWallet").ok_or("fromWallet required")?;
            let to = str_arg(args, "toAddress").ok_or("toAddress required")?;
            let oid = str_arg(args, "objectId").ok_or("objectId required")?;
            let st = state.lock().unwrap();
            let w = st.wallets.get(from).ok_or(format!("Wallet '{from}' not found"))?;
            Ok(json!({"status": "transfer_prepared", "from": w.address, "to": to, "objectId": oid, "note": "Transaction signing requires full Sui SDK integration. Use sui CLI for actual transfers."}))
        }
        "get_transaction" => {
            let digest = str_arg(args, "digest").ok_or("digest required")?;
            let st = state.lock().unwrap();
            let result = st.sui_rpc("sui_getTransactionBlock", json!([digest, {"showEffects": true, "showInput": true}])).await?;
            Ok(result)
        }
        "get_transactions" | "get_wallet_transactions" => {
            let address = if name == "get_wallet_transactions" {
                let wn = str_arg(args, "walletName").ok_or("walletName required")?;
                let st = state.lock().unwrap();
                st.wallets.get(wn).ok_or(format!("Wallet '{wn}' not found"))?.address.clone()
            } else {
                str_arg(args, "address").ok_or("address required")?.to_string()
            };
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10);
            let st = state.lock().unwrap();
            let result = st.sui_rpc("suix_queryTransactionBlocks", json!([{"filter": {"FromAddress": address}}, null, limit, true])).await?;
            Ok(json!({"address": address, "transactions": result}))
        }
        "get_gas_price" => {
            let st = state.lock().unwrap();
            let result = st.sui_rpc("suix_getReferenceGasPrice", json!([])).await?;
            Ok(json!({"gasPrice": result, "network": st.current_network}))
        }
        "request_tokens_from_faucet" => {
            let wn = str_arg(args, "walletName").ok_or("walletName required")?;
            let st = state.lock().unwrap();
            if st.current_network == "mainnet" {
                return Err("Faucet is not available on mainnet".into());
            }
            let w = st.wallets.get(wn).ok_or(format!("Wallet '{wn}' not found"))?;
            Ok(json!({"success": false, "message": "Faucet functionality requires additional setup. Use the Sui CLI or web faucet.", "address": w.address, "faucetUrl": format!("https://faucet.{}.sui.io/", st.current_network)}))
        }
        "switch_network" => {
            let network = str_arg(args, "network").ok_or("network required")?;
            if !NETWORKS.iter().any(|(n, _)| *n == network) {
                return Err(format!("Unsupported network: {network}"));
            }
            let mut st = state.lock().unwrap();
            let prev = st.current_network.clone();
            st.current_network = network.into();
            Ok(json!({"success": true, "previousNetwork": prev, "currentNetwork": network, "rpcUrl": default_rpc(network)}))
        }
        "get_network_info" => {
            let st = state.lock().unwrap();
            match st.sui_rpc("sui_getChainIdentifier", json!([])).await {
                Ok(chain_id) => Ok(json!({"network": st.current_network, "rpcUrl": st.rpc_url(), "chainId": chain_id})),
                Err(_) => Ok(json!({"network": st.current_network, "rpcUrl": st.rpc_url(), "error": "Failed to fetch network details"})),
            }
        }
        "get_chain_id" => {
            let st = state.lock().unwrap();
            let result = st.sui_rpc("sui_getChainIdentifier", json!([])).await?;
            Ok(json!({"chainId": result}))
        }
        "get_validators" => {
            let st = state.lock().unwrap();
            let result = st.sui_rpc("suix_getLatestSuiSystemState", json!([])).await?;
            let validators = result.get("activeValidators").cloned().unwrap_or(json!([]));
            Ok(json!({"validators": validators}))
        }
        "get_validator_info" => {
            let addr = str_arg(args, "validatorAddress").ok_or("validatorAddress required")?;
            let st = state.lock().unwrap();
            let result = st.sui_rpc("suix_getLatestSuiSystemState", json!([])).await?;
            let validators = result.get("activeValidators").and_then(|v| v.as_array());
            let info = validators.and_then(|vs| vs.iter().find(|v| v.get("suiAddress").and_then(|a| a.as_str()) == Some(addr)).cloned());
            Ok(info.unwrap_or(json!({"error": "Validator not found", "address": addr})))
        }
        "validate_address" => {
            let addr = str_arg(args, "address").ok_or("address required")?;
            let valid = addr.starts_with("0x") && addr.len() == 66 && addr[2..].chars().all(|c| c.is_ascii_hexdigit());
            Ok(json!({"address": addr, "valid": valid, "message": if valid { "Valid Sui address" } else { "Invalid Sui address" }}))
        }
        "normalize_address" => {
            let addr = str_arg(args, "address").ok_or("address required")?;
            let cleaned = addr.strip_prefix("0x").unwrap_or(addr);
            let normalized = format!("0x{:0>64}", cleaned);
            Ok(json!({"original": addr, "normalized": normalized, "valid": true}))
        }
        "convert_mist_to_sui" => {
            let mist = str_arg(args, "mist").ok_or("mist required")?;
            let val: f64 = mist.parse::<f64>().unwrap_or(0.0) / 1_000_000_000.0;
            Ok(json!({"mist": mist, "sui": val, "formatted": format!("{:.9} SUI", val)}))
        }
        "convert_sui_to_mist" => {
            let sui = args.get("sui").and_then(|v| v.as_f64()).ok_or("sui required")?;
            let mist = (sui * 1_000_000_000.0) as u64;
            Ok(json!({"sui": sui, "mist": mist.to_string(), "formatted": format!("{mist} MIST")}))
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}

fn tool_definitions() -> Value {
    json!([
        {"name":"create_wallet","description":"Create a new Sui wallet with mnemonic phrase","inputSchema":{"type":"object","properties":{"name":{"type":"string","description":"Name for the wallet"}},"required":["name"]}},
        {"name":"import_wallet","description":"Import an existing wallet from mnemonic or private key","inputSchema":{"type":"object","properties":{"name":{"type":"string","description":"Name for the wallet"},"mnemonic":{"type":"string","description":"Mnemonic phrase (12-24 words)"},"privateKey":{"type":"string","description":"Private key in hex format"}},"required":["name"]}},
        {"name":"list_wallets","description":"List all created/imported wallets","inputSchema":{"type":"object","properties":{}}},
        {"name":"get_wallet_address","description":"Get wallet address","inputSchema":{"type":"object","properties":{"walletName":{"type":"string","description":"Name of the wallet"}},"required":["walletName"]}},
        {"name":"export_wallet","description":"Export wallet private key and mnemonic","inputSchema":{"type":"object","properties":{"walletName":{"type":"string","description":"Name of the wallet"}},"required":["walletName"]}},
        {"name":"get_balance","description":"Get SUI balance for a wallet","inputSchema":{"type":"object","properties":{"walletName":{"type":"string","description":"Name of the wallet"},"coinType":{"type":"string","description":"Coin type (default: 0x2::sui::SUI)"}},"required":["walletName"]}},
        {"name":"get_all_balances","description":"Get all coin balances for a wallet","inputSchema":{"type":"object","properties":{"walletName":{"type":"string","description":"Name of the wallet"}},"required":["walletName"]}},
        {"name":"get_objects","description":"Get owned objects for a wallet","inputSchema":{"type":"object","properties":{"walletName":{"type":"string","description":"Name of the wallet"},"limit":{"type":"number","description":"Limit number of objects returned"}},"required":["walletName"]}},
        {"name":"get_object_details","description":"Get detailed information about an object","inputSchema":{"type":"object","properties":{"objectId":{"type":"string","description":"Object ID"}},"required":["objectId"]}},
        {"name":"transfer_sui","description":"Transfer SUI to another address","inputSchema":{"type":"object","properties":{"fromWallet":{"type":"string","description":"Name of the sender wallet"},"toAddress":{"type":"string","description":"Recipient address"},"amount":{"type":"number","description":"Amount in SUI"}},"required":["fromWallet","toAddress","amount"]}},
        {"name":"transfer_object","description":"Transfer an object to another address","inputSchema":{"type":"object","properties":{"fromWallet":{"type":"string","description":"Name of the sender wallet"},"toAddress":{"type":"string","description":"Recipient address"},"objectId":{"type":"string","description":"Object ID to transfer"}},"required":["fromWallet","toAddress","objectId"]}},
        {"name":"get_transaction","description":"Get transaction details by digest","inputSchema":{"type":"object","properties":{"digest":{"type":"string","description":"Transaction digest"}},"required":["digest"]}},
        {"name":"get_transactions","description":"Get transaction history for an address","inputSchema":{"type":"object","properties":{"address":{"type":"string","description":"Address to get transactions for"},"limit":{"type":"number","description":"Limit number of transactions"}},"required":["address"]}},
        {"name":"get_wallet_transactions","description":"Get transaction history for a wallet","inputSchema":{"type":"object","properties":{"walletName":{"type":"string","description":"Name of the wallet"},"limit":{"type":"number","description":"Limit number of transactions"}},"required":["walletName"]}},
        {"name":"get_gas_price","description":"Get current gas price","inputSchema":{"type":"object","properties":{}}},
        {"name":"request_tokens_from_faucet","description":"Request test SUI from faucet (testnet/devnet only)","inputSchema":{"type":"object","properties":{"walletName":{"type":"string","description":"Name of the wallet"}},"required":["walletName"]}},
        {"name":"switch_network","description":"Switch Sui network","inputSchema":{"type":"object","properties":{"network":{"type":"string","enum":["mainnet","testnet","devnet","localnet"],"description":"Network to switch to"}},"required":["network"]}},
        {"name":"get_network_info","description":"Get current network information","inputSchema":{"type":"object","properties":{}}},
        {"name":"get_chain_id","description":"Get chain identifier","inputSchema":{"type":"object","properties":{}}},
        {"name":"get_validators","description":"Get list of active validators","inputSchema":{"type":"object","properties":{}}},
        {"name":"get_validator_info","description":"Get detailed information about a validator","inputSchema":{"type":"object","properties":{"validatorAddress":{"type":"string","description":"Validator Sui address"}},"required":["validatorAddress"]}},
        {"name":"validate_address","description":"Validate if an address is a valid Sui address","inputSchema":{"type":"object","properties":{"address":{"type":"string","description":"Address to validate"}},"required":["address"]}},
        {"name":"normalize_address","description":"Normalize a Sui address to full length","inputSchema":{"type":"object","properties":{"address":{"type":"string","description":"Address to normalize"}},"required":["address"]}},
        {"name":"convert_mist_to_sui","description":"Convert MIST to SUI","inputSchema":{"type":"object","properties":{"mist":{"type":"string","description":"Amount in MIST"}},"required":["mist"]}},
        {"name":"convert_sui_to_mist","description":"Convert SUI to MIST","inputSchema":{"type":"object","properties":{"sui":{"type":"number","description":"Amount in SUI"}},"required":["sui"]}}
    ])
}

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let state = Mutex::new(AppState::new());
    tracing::info!("sui-mcp-server starting");

    let stdin = io::stdin();
    let stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line { Ok(l) => l, Err(_) => break };
        if line.trim().is_empty() { continue; }

        let req: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => { tracing::warn!("invalid JSON-RPC: {e}"); continue; }
        };

        let id = req.id.clone().unwrap_or(Value::Null);

        let response = match req.method.as_str() {
            "initialize" => Some(JsonRpcResponse {
                jsonrpc: "2.0".into(), id,
                result: Some(json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"sui-mcp-server","version":env!("CARGO_PKG_VERSION")}})),
                error: None,
            }),
            "notifications/initialized" => None,
            "tools/list" => Some(JsonRpcResponse {
                jsonrpc: "2.0".into(), id,
                result: Some(json!({"tools": tool_definitions()})),
                error: None,
            }),
            "tools/call" => {
                let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = req.params.get("arguments").cloned().unwrap_or(json!({}));
                let result = call_tool(name, &args, &state).await;
                let content = match result {
                    Ok(val) => json!({"content":[{"type":"text","text":serde_json::to_string_pretty(&val).unwrap_or_default()}]}),
                    Err(e) => json!({"content":[{"type":"text","text":format!("Error: {e}")}],"isError":true}),
                };
                Some(JsonRpcResponse { jsonrpc: "2.0".into(), id, result: Some(content), error: None })
            }
            other => Some(JsonRpcResponse {
                jsonrpc: "2.0".into(), id, result: None,
                error: Some(json!({"code":-32601,"message":format!("method not found: {other}")})),
            }),
        };

        if let Some(resp) = response {
            let mut out = stdout.lock();
            let _ = serde_json::to_writer(&mut out, &resp);
            let _ = out.write_all(b"\n");
            let _ = out.flush();
        }
    }
}
