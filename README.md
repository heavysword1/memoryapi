# 🧠 MemoryAPI

> Persistent memory for AI agents and LLMs — REST API + MCP native

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io)

**MemoryAPI** gives your AI agent a persistent, searchable memory across sessions. Store memories in natural language, retrieve them semantically — no exact keywords needed.

🌐 **[memoryapi.org](https://memory-landing-page.replit.app)** | 📡 **API: [api.memoryapi.org](https://api.memoryapi.org)**

---

## Features

- 🧠 **Semantic Search** — find memories by meaning, not keywords
- 🔌 **MCP Native** — plug into Claude, Cursor, Windsurf instantly
- ⚡ **REST API** — simple HTTP endpoints, any language
- 🔑 **API Key Auth** — secure, namespaced per agent
- 📊 **Usage Tracking** — memory count and plan limits
- 🌍 **Always On** — hosted at api.memoryapi.org

---

## Quick Start

### 1. Get an API Key

```bash
curl -X POST https://api.memoryapi.org/keys \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "my-agent", "email": "you@example.com"}'
```

Returns:
```json
{
  "api_key": "mem_xxxxxxxx.yyyyyyyy",
  "message": "Save this key securely — it will not be shown again."
}
```

### 2. Store a Memory

```bash
curl -X POST https://api.memoryapi.org/memory \
  -H "Content-Type: application/json" \
  -H "x-api-key: mem_xxxxxxxx.yyyyyyyy" \
  -d '{"content": "User prefers dark mode and React Native"}'
```

### 3. Search Memories

```bash
curl "https://api.memoryapi.org/memory?query=what+does+the+user+prefer" \
  -H "x-api-key: mem_xxxxxxxx.yyyyyyyy"
```

---

## MCP Integration

Add to your MCP client config (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "memoryapi": {
      "url": "https://api.memoryapi.org/mcp",
      "headers": {
        "x-api-key": "mem_xxxxxxxx.yyyyyyyy"
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `store_memory` | Store a memory in natural language |
| `search_memory` | Semantically search memories |
| `list_memories` | List all stored memories |
| `delete_memory` | Delete a memory by ID |

---

## REST API Reference

### `POST /memory`
Store a memory.

**Headers:** `x-api-key: your-key`

**Body:**
```json
{
  "content": "string (required, max 10,000 chars)",
  "metadata": { "type": "preference" }
}
```

---

### `GET /memory?query=...`
Semantic search across memories.

**Headers:** `x-api-key: your-key`

**Query params:**
- `query` (required) — natural language search
- `limit` (optional, default 10) — max results
- `threshold` (optional, default 0.4) — similarity threshold

---

### `GET /memory/list`
List all memories for the agent.

**Query params:**
- `limit` (default 50)
- `offset` (default 0)

---

### `DELETE /memory/:id`
Delete a specific memory.

---

### `POST /keys`
Generate a new API key.

**Body:**
```json
{
  "agent_id": "my-agent",
  "email": "you@example.com",
  "plan": "free"
}
```

---

## Pricing

| Plan | Price | Memories | Agents |
|------|-------|----------|--------|
| Free | $0/mo | 100 | 1 |
| Starter | $19/mo | 10,000 | 5 |
| Pro | $49/mo | Unlimited | Unlimited |

---

## Tech Stack

- **Runtime:** Node.js + Express
- **Database:** Supabase (PostgreSQL + pgvector)
- **Embeddings:** OpenAI `text-embedding-3-small`
- **Auth:** bcrypt-hashed API keys
- **Protocol:** MCP 2024-11-05

---

## License

MIT © 2026 [Ocean Digital Group](https://oceandigitalgroup.com)
