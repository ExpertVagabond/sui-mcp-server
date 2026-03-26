# Sui Foundation Developer Grant Application

## sui-mcp-server: AI-Native Developer Tooling for Sui

**Applicant:** Matthew Karsten, Founder, Purple Squirrel Media LLC
**Project:** sui-mcp-server
**GitHub:** [github.com/ExpertVagabond/sui-mcp-server](https://github.com/ExpertVagabond/sui-mcp-server) (public, MIT)
**npm:** [sui-mcp-server](https://www.npmjs.com/package/sui-mcp-server) (v0.4.1, 4 versions shipped)
**Date:** March 2026
**Funding Request:** $25,000 -- $50,000

---

## Executive Summary

sui-mcp-server is a 53-tool open-source server that gives AI coding agents -- Claude Code, Cursor, Windsurf, GPT, and any MCP-compatible client -- direct, programmatic access to the entire Sui blockchain RPC surface. It is the most comprehensive Sui MCP server available today, covering wallets, DeFi, Move contracts, staking, analytics, SuiNS name service, and the testnet/devnet faucet, with 59/59 integration tests passing across devnet, testnet, and mainnet.

AI-assisted development is no longer experimental. Claude Code, Cursor, and Windsurf are used daily by hundreds of thousands of developers. The Model Context Protocol (MCP) is the emerging standard for connecting these AI agents to external tools and data sources. Kapa.ai already provides the knowledge layer for Sui (documentation search). sui-mcp-server provides the **action layer** -- the ability for AI agents to actually create wallets, deploy contracts, execute transactions, query DeFi pools, and interact with Sui on behalf of developers.

This grant would fund completion of the GraphQL transport migration, deep DeFi SDK integrations, event streaming, and developer documentation to make sui-mcp-server the definitive bridge between AI tooling and the Sui ecosystem.

---

## Problem

Developers building on Sui today face two friction points that AI tooling should eliminate but currently cannot:

1. **AI agents cannot interact with Sui.** Claude Code, Cursor, and Windsurf can write Move code by reading documentation, but they cannot compile it, deploy it, test it on devnet, query objects, check balances, or simulate transactions. Every interaction requires the developer to context-switch out of their AI-assisted workflow and into a CLI or browser wallet. This breaks the promise of AI-native development.

2. **The Sui RPC surface is large and evolving.** Sui exposes JSON-RPC, GraphQL, and soon gRPC endpoints across multiple networks. Navigating these APIs requires deep protocol knowledge -- object versioning, gas coin selection, PTB construction, coin splitting for gas, MIST/SUI unit conversion, dynamic field pagination. Developers spend significant time on plumbing instead of application logic.

3. **The JSON-RPC deprecation deadline is July 2026.** Every tool that relies on JSON-RPC must migrate to GraphQL. Developers who build integrations today risk breakage in months. A server that handles both transports and migrates transparently provides immediate insurance.

---

## Solution

sui-mcp-server solves these problems by implementing the Model Context Protocol -- the open standard created by Anthropic and adopted by Cursor, Windsurf, Sourcegraph, and others -- as a bridge to Sui's full RPC surface.

### What it does today (Phase 1, complete):

- **53 tools** across 13 categories, covering the complete Sui developer workflow from wallet creation through DeFi interaction
- **Dual transport architecture:** JSON-RPC primary with GraphQL queries already integrated, ready for the July 2026 migration
- **Built on official SDKs:** `@mysten/sui` v2.11 and `@mysten/suins` v1.0 -- not custom RPC wrappers
- **Production-grade security:** In-memory key management (never persisted to disk), input validation via Zod strict schemas, rate limiting (120 calls/min), redacted error output
- **DeFi coverage:** Cetus CLMM pool queries, DeepBook v3 order book data, token price lookups via pool reserves, swap quote simulation
- **SuiNS integration:** Forward and reverse name resolution, name records, registration pricing
- **Multi-network support:** Devnet, testnet, mainnet, localnet -- switchable at runtime
- **59/59 integration tests** passing end-to-end on live networks
- **Published on npm** with zero-config `npx` installation -- developers add 5 lines of JSON to their MCP config and every AI agent in their workflow gains Sui access

### What AI agents can do with sui-mcp-server:

- Create wallets, request devnet/testnet faucet tokens, and run test transactions -- all within a Claude Code or Cursor session
- Query any on-chain object, trace its provenance, inspect its dynamic fields
- Simulate Move function calls with `dev_inspect` before executing them
- Check validator APYs and stake SUI, or withdraw existing stakes
- Look up Cetus pool liquidity, get swap quotes, list token prices
- Resolve SuiNS names and look up registration pricing
- Search transactions by sender, recipient, Move function, or changed object
- Inspect Move module definitions, struct layouts, and function signatures
- All of this without leaving the IDE, without opening a browser wallet, without memorizing RPC endpoints

---

## Technical Architecture

```
sui-mcp-server (TypeScript, ~1,300 lines)
├── MCP Protocol Layer
│   ├── stdio transport (local, sandboxed)
│   ├── Tool registration (53 tools, Zod schemas)
│   └── Request/response handling
│
├── Blockchain Layer
│   ├── @mysten/sui v2.11 (JSON-RPC + GraphQL)
│   ├── @mysten/suins v1.0 (name service)
│   ├── Multi-network client management
│   └── Transaction building (PTB construction)
│
├── Security Layer
│   ├── In-memory wallet store (Map<string, WalletEntry>)
│   ├── Rate limiter (sliding window, 120/min)
│   ├── Zod strict input validation
│   └── Key/address redaction in error output
│
├── DeFi Layer
│   ├── Cetus CLMM pool queries
│   ├── DeepBook v3 order book
│   ├── Token price via pool reserves
│   └── Swap quote simulation
│
└── Dependencies
    ├── @modelcontextprotocol/sdk ^1.20.0
    ├── @mysten/sui ^2.9.1
    ├── @mysten/suins ^1.0.2
    └── zod ^3.23.0
```

**Design decisions:**

- **Single-file architecture** keeps the server auditable and easy to contribute to. No framework abstractions, no ORM, no build pipeline beyond `tsc`.
- **Zod strict schemas** on every tool input reject unknown fields and provide type-safe validation, preventing malformed RPC calls.
- **In-memory wallet store** is a deliberate security choice: keys exist only during the server process lifetime and are never written to disk or logged. This is appropriate for developer tooling and testing workflows. Production key management (HSM, hardware wallets) is documented as a recommendation.
- **Rate limiting** prevents AI agents from accidentally flooding RPC endpoints during rapid iteration.
- **Token shortcuts** (SUI, USDC, USDT, WETH, DEEP) let AI agents reference tokens by symbol instead of full coin type addresses, reducing prompt token overhead and error rates.

---

## Competitive Landscape

| Server | Tools | DeFi | SuiNS | GraphQL | Tests | npm Published |
|--------|-------|------|-------|---------|-------|---------------|
| **sui-mcp-server (ours)** | **53** | Cetus, DeepBook, swap quotes | Full | Dual transport | 59/59 | Yes (4 versions) |
| @anthropic/sui-mcp | 14 | None | None | None | Unknown | No |
| Community forks | 5-10 | None | None | None | Minimal | No |

sui-mcp-server is 3-4x more comprehensive than any alternative. It is the only Sui MCP server with DeFi protocol coverage, SuiNS integration, GraphQL transport readiness, and a published npm package with verified test results on live networks.

Kapa.ai provides documentation search for Sui -- it answers "how do I" questions. sui-mcp-server completes the loop by providing the action surface -- AI agents can read the docs via Kapa and then *do the thing* via sui-mcp-server.

---

## Roadmap

### Phase 1: Core Blockchain Operations (Complete)

- 53 tools: wallets, coins, transfers, objects, transactions, Move, staking, events, network analytics, SuiNS, DeFi, faucet
- Dual JSON-RPC + GraphQL transport
- 59/59 integration tests on devnet, testnet, mainnet
- Published on npm (4 versions shipped)
- Open source, MIT license

### Phase 2: Deep DeFi and GraphQL Migration ($10,000 -- $20,000)

- Full GraphQL-first transport (replace all remaining JSON-RPC calls before July 2026 deadline)
- Cetus SDK integration: position management, liquidity provision, fee collection
- Aftermath Finance SDK: router aggregation, liquid staking
- Scallop SDK: lending/borrowing operations
- NFT and Kiosk framework: minting, listing, purchasing, transfer policies
- Target: 70+ tools

### Phase 3: Advanced Developer Tools ($8,000 -- $15,000)

- Event streaming via gRPC subscription (real-time on-chain monitoring)
- Move contract deployment and upgrade management (publish, upgrade, freeze)
- Multi-wallet management with named accounts and session persistence
- Transaction batching and PTB composition tools
- Gas estimation and optimization tools
- Target: 85+ tools

### Phase 4: Ecosystem and Community ($7,000 -- $15,000)

- Smithery registry listing (MCP marketplace)
- Comprehensive developer documentation site
- Video tutorials: "Build a Sui dApp with AI in 10 minutes"
- Integration guides for Claude Code, Cursor, Windsurf, VS Code + Continue
- Example prompts and workflows for common Sui developer tasks
- Community contributions: issue templates, PR guidelines, contributor guide
- Conference talks and demo submissions (Sui-specific and broader AI/Web3 events)

**Total timeline:** 4-6 months from grant approval.

---

## Team

### Matthew Karsten -- Founder, Purple Squirrel Media LLC

- 7,200+ Claude Code sessions, 2,200+ commits, demonstrating deep expertise in AI-native development workflows
- Built 50+ MCP servers across Solana, Bitcoin, Apple ecosystem, NVIDIA, and infrastructure tooling
- Published npm packages: sui-mcp-server, solmail-mcp, ordinals-mcp, cpanel-mcp, and 60+ others
- Published Rust crates: 20 packages on crates.io
- Active across Solana ecosystem: Coldstar (air-gapped cold wallet, 12 repos), SolMail (on-chain messaging), ordinals-mcp (Bitcoin inscriptions/runes)
- Participated in Colosseum Hackathon (Coldstar placed #62, SolMail #47) and Graveyard Hackathon (4 submissions)
- Previously engaged with Oliver Barker at Sui Foundation, who encouraged the sui-mcp-server build
- GitHub: [ExpertVagabond](https://github.com/ExpertVagabond)
- Email: MatthewKarstenConnects@gmail.com

### Purple Squirrel Media LLC

- Software studio focused on blockchain tooling, AI infrastructure, and developer experience
- Portfolio: 313 active repositories across Rust, TypeScript, Python, Zig, Scala, Ruby
- Expanding from Solana-first to multi-chain, with Sui as the priority new ecosystem
- Infrastructure: 35 active MCP servers (771+ tools), NVIDIA NIM pipeline (189 models), local AI via Ollama

---

## Budget

| Phase | Scope | Range |
|-------|-------|-------|
| Phase 2 | GraphQL migration, DeFi SDK integrations, NFT/Kiosk tools | $10,000 -- $20,000 |
| Phase 3 | Event streaming, Move deployment, multi-wallet, PTB composition | $8,000 -- $15,000 |
| Phase 4 | Smithery listing, documentation, tutorials, community | $7,000 -- $15,000 |
| **Total** | **70+ new tools, full GraphQL migration, docs, community** | **$25,000 -- $50,000** |

**What the grant covers:**

- Development time (sole developer, full-time availability)
- RPC infrastructure costs (mainnet testing, load testing)
- npm hosting and CI/CD
- Documentation site hosting
- Conference attendance for demos and talks

**What is already funded (no grant needed):**

- Phase 1 (complete, self-funded)
- Ongoing maintenance and bug fixes
- Community support and issue triage

---

## Why Sui

Sui is the right blockchain for AI-native tooling because of three technical advantages:

1. **Object-centric data model.** Sui's object model maps naturally to MCP tool design. Each object has a unique ID, a known type, and queryable fields. AI agents can reason about objects the same way they reason about JSON -- inspect it, understand its shape, decide what to do with it. Account-based chains require more context to interpret state.

2. **Programmable Transaction Blocks.** PTBs let a single transaction compose multiple operations -- transfer, split, merge, Move call -- atomically. This is ideal for AI agents, which benefit from expressing complex intent in one shot rather than managing multi-step transaction sequences.

3. **GraphQL API.** Sui's commitment to GraphQL as the primary API gives AI agents a self-documenting, strongly-typed interface. Schema introspection means the MCP server can validate queries at build time and provide better error messages, reducing the back-and-forth between agent and developer.

4. **Growing ecosystem.** Cetus, DeepBook, Aftermath, Scallop, SuiNS, Kiosk, and the broader Move ecosystem provide a rich surface area for AI tooling. Every new protocol is a new set of tools that AI agents can learn to use.

---

## Contact

**Matthew Karsten**
Founder, Purple Squirrel Media LLC

- Email: MatthewKarstenConnects@gmail.com
- GitHub: [github.com/ExpertVagabond](https://github.com/ExpertVagabond)
- X/Twitter: [@expertvagabond](https://x.com/expertvagabond)
- Project: [github.com/ExpertVagabond/sui-mcp-server](https://github.com/ExpertVagabond/sui-mcp-server)
- npm: [npmjs.com/package/sui-mcp-server](https://www.npmjs.com/package/sui-mcp-server)
- Company: [purplesquirrelmedia.io](https://purplesquirrelmedia.io)
