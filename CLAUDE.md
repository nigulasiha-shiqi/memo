# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memo is an MCP (Model Context Protocol) server that saves and retrieves AI conversation context. It allows users to hand off conversations between AI agents by saving structured context (goal, completed tasks, pending tasks, decisions, relevant files) and retrieving it via short IDs.

## Architecture

The project has two main components:

1. **MCP Server** (`index.ts`) - A stdio-based MCP server that registers two tools:
   - `memo_get` - Retrieves saved context by ID
   - `memo_set` - Saves structured conversation context with a schema (goal, completed, pending, decisions, files, context)

2. **API Server** (`api/index.ts`) - A Hono-based REST API deployed to Vercel:
   - `GET/POST /api/get/:id` - Retrieve stored context from Redis
   - `POST /api/set` - Store context in Redis with TTL
   - Uses Upstash Redis for storage with rate limiting (60 req/min per IP)

The MCP server communicates with the hosted API at `memo-upstash.vercel.app` by default.

## Commands

```bash
# Build the MCP server (compiles TypeScript to dist/)
npm run build:mcp

# Run MCP server in development mode
npm run dev

# Run API locally (requires .env with Upstash credentials)
npx vercel dev

# Deploy API to Vercel
npm run deploy
```

## Environment Variables (for self-hosting)

```
UPSTASH_REDIS_REST_URL=your-redis-url
UPSTASH_REDIS_REST_TOKEN=your-redis-token
```

## Key Implementation Details

- Context is stored as JSON with configurable TTL (default 24 hours via `--ttl-mins` CLI arg)
- The MCP server uses `@modelcontextprotocol/sdk` with stdio transport
- API uses sliding window rate limiting via `@upstash/ratelimit`
- IDs are generated using `nanoid`
