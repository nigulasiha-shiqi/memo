#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";

// Parse --ttl-mins arg (env: MEMO_TTL_MINS)
const ttlIndex = process.argv.indexOf("--ttl-mins");
const TTL_MINS =
  ttlIndex !== -1 && process.argv[ttlIndex + 1]
    ? parseInt(process.argv[ttlIndex + 1], 10)
    : process.env.MEMO_TTL_MINS
      ? parseInt(process.env.MEMO_TTL_MINS, 10)
      : 1440; // 24 hours

// Parse --api-key arg (env: MEMO_API_KEY)
const apiKeyIndex = process.argv.indexOf("--api-key");
const API_KEY =
  apiKeyIndex !== -1 && process.argv[apiKeyIndex + 1]
    ? process.argv[apiKeyIndex + 1]
    : process.env.MEMO_API_KEY || undefined;

// Parse --api-url arg (env: MEMO_API_URL)
const apiUrlIndex = process.argv.indexOf("--api-url");
const API_BASE_URL = (
  apiUrlIndex !== -1 && process.argv[apiUrlIndex + 1]
    ? process.argv[apiUrlIndex + 1]
    : process.env.MEMO_API_URL || "https://memo-upstash.vercel.app"
).replace(/\/$/, ""); // remove trailing slash

// API endpoints
const GET_URL = `${API_BASE_URL}/api/get`;
const SET_URL = `${API_BASE_URL}/api/set`;

// Helper to get fetch headers
const getHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }
  return headers;
};

const server = new McpServer({
  name: "memo-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "memo_get",
  {
    title: "Memo Get",
    description:
      `Retrieve saved conversation context by ID from ${GET_URL}. Use when user says 'memo get <id>' or pastes a memo ID.`,
    inputSchema: {
      id: z.string().describe("The memo ID (e.g., 4tJ630XqhCV5gQelx98pu)"),
    },
  },
  async ({ id }: { id: string }) => {
    try {
      const url = `${GET_URL}?id=${encodeURIComponent(id)}`;
      const response = await fetch(url, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Error: HTTP ${response.status} - ${response.statusText}`,
            },
          ],
        };
      }
      const data = await response.json();
      if (data.error) {
        return {
          content: [{ type: "text", text: `Error: ${data.error}` }],
        };
      }

      // Try to parse and format structured context, fall back to raw text
      try {
        const ctx = JSON.parse(data.summary);
        const sessionName = data.name ? `# Session: ${data.name}\n\n` : "";
        const formatted = `${sessionName}# Previous Session Context

This is context from a previous conversation. Use this to continue the work where it left off. Start by reviewing the pending tasks and relevant files.

## Goal
${ctx.goal}

## Completed
${ctx.completed?.map((t: string) => `- ${t}`).join("\n") || "None"}

## Pending
${ctx.pending?.length ? ctx.pending.map((t: string) => `- ${t}`).join("\n") : "None"}

## Key Decisions
${ctx.decisions?.length ? ctx.decisions.map((d: string) => `- ${d}`).join("\n") : "None"}

## Relevant Files
${ctx.files?.length ? ctx.files.map((f: string) => `- ${f}`).join("\n") : "None"}

## Additional Context
${ctx.context || "None"}`;

        return {
          content: [{ type: "text", text: formatted }],
        };
      } catch {
        // Fall back to raw text if not valid JSON
        return {
          content: [{ type: "text", text: data.summary }],
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Network error: ${error instanceof Error ? error.message : "Failed to connect"}`,
          },
        ],
      };
    }
  },
);

const contextSchema = z.object({
  goal: z.string().describe("What the user was trying to accomplish"),
  completed: z.array(z.string()).describe("Tasks/changes that were completed"),
  pending: z
    .array(z.string())
    .optional()
    .describe("Tasks that remain unfinished"),
  decisions: z
    .array(z.string())
    .optional()
    .describe("Key technical decisions made and why"),
  files: z
    .array(z.string())
    .optional()
    .describe("Key files that were modified or are relevant"),
  context: z.string().optional().describe("Any other important context"),
});

type Context = z.infer<typeof contextSchema>;

server.registerTool(
  "memo_set",
  {
    title: "Memo Set",
    description:
      "Save conversation context for another AI agent. Use when user says 'memo set' or 'memo set <name>'. If user provides a name after 'memo set', use it as the name parameter.",
    inputSchema: {
      name: z.string().optional().describe("Optional session name provided by user (e.g., 'memo set 我的项目' -> name='我的项目')"),
      context: contextSchema,
    },
  },
  async ({ name, context }: { name?: string; context: Context }) => {
    try {
      const response = await fetch(SET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getHeaders() },
        body: JSON.stringify({
          name,
          summary: JSON.stringify(context),
          ttlMins: TTL_MINS,
        }),
      });
      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Error: HTTP ${response.status} - ${response.statusText}`,
            },
          ],
        };
      }
      const data = await response.json();
      const id = data.id;
      if (!id) {
        console.warn("Warning: No ID returned from set API", data);
        return {
          content: [
            {
              type: "text",
              text: `Warning: Failed to save summary. No ID was returned.\n\nResponse: ${JSON.stringify(data, null, 2)}`,
            },
          ],
        };
      }
      const displayName = data.name || id;
      return {
        content: [
          {
            type: "text",
            text: `Conversation summary saved as "${displayName}"!\n\nTo restore this context later, copy and paste:\n\n\`\`\`\nmemo get ${id}\n\`\`\``,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Network error: ${error instanceof Error ? error.message : "Failed to connect"}`,
          },
        ],
      };
    }
  },
);

// Register prompt for "memo set" command
server.registerPrompt(
  "memo set",
  {
    description:
      "Save structured conversation context for another AI agent to continue the work",
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Please save our conversation context using the 'memo_set' tool with structured data: goal (what we were trying to accomplish), completed (tasks done), pending (remaining tasks), decisions (key technical choices made), files (relevant files), and any other important context.",
          },
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
