#!/usr/bin/env bun
/**
 * MCP Code Execution Server for RS-Agent
 *
 * Manages multiple bot connections dynamically at runtime.
 * Agents can connect, disconnect, and execute code on any connected bot.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { botManager } from './api/index.js';
import { initPathfinding } from '../sdk/pathfinding.js';
import { marketTool, readMarket } from './market-tools.js';
import { installExecutionConsoleCapture } from './console-capture.js';
import { executeCode, botExecutions } from './execute-code.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create MCP server
const server = new Server(
  {
    name: 'rs-agent-bot',
    version: '2.0.0'
  },
  {
    capabilities: {
      resources: {},
      tools: {}
    }
  }
);

// List available API modules as resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'file://../sdk/API.md',
        name: 'SDK API Reference',
        description: 'Auto-generated reference for bot.* (high-level actions: chopTree, walkTo, attack, openBank, ...) and sdk.* (low-level: getState, sendWalk, findNearbyNpc, ...).',
        mimeType: 'text/markdown'
      },
      {uri: 'file://../sdk/MARKET.md', name: 'Grand Exchange guide', description: 'Public market reads, physical trading, offer receipts and recovery after uncertain outcomes.', mimeType: 'text/markdown'}
    ]
  };
});

// Read API module contents
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  try {
    const uri = request.params.uri;
    let filePath: string;

    if (uri.startsWith('file://')) {
      const relativePath = uri.replace('file://', '');
      filePath = join(__dirname, relativePath);
    } else {
      throw new Error(`Unsupported URI scheme: ${uri}`);
    }

    const content = await Bun.file(filePath).text();

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'text/plain',
          text: content
        }
      ]
    };
  } catch (error: any) {
    throw new Error(`Failed to read resource: ${error.message}`);
  }
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      marketTool,
      {
        name: 'execute_code',
        description: 'Execute TypeScript code on a bot. Auto-connects using credentials from bots/{name}/bot.env. The code runs in an async context with bot (BotActions), sdk (BotSDK), and Spells (spell component ids) available. A new call for the same bot cancels the one still running. Timeout or explicit MCP cancellation stops SDK dispatches and observations, including inside high-level actions. Keep interactive snippets short; use a saved script with the existing browser client for long loops.',
        inputSchema: {
          type: 'object',
          properties: {
            bot_name: {
              type: 'string',
              description: 'Bot name (matches folder in bots/). Auto-connects on first use.'
            },
            code: {
              type: 'string',
              description: 'TypeScript code to execute (type annotations are stripped before running). Available globals: bot (BotActions), sdk (BotSDK), Spells (e.g. Spells.HIGH_ALCHEMY). Example: "const r = await bot.chopTree(); return r;". A world-state summary (position, skills, inventory, nearby entities, open dialogs, new messages) is appended to every result, so there is no need to return sdk.getState() just to look around.'
            },
            timeout: {
              type: 'number',
              description: 'Execution timeout in minutes (default: 2, max: 60).'
            }
          },
          required: ['bot_name', 'code']
        }
      },
      {
        name: 'disconnect_bot',
        description: 'Disconnect a connected bot',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Bot name to disconnect'
            }
          },
          required: ['name']
        }
      },
      {
        name: 'list_bots',
        description: 'List all connected bots',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_market': return successResponse(await readMarket(args ?? {}));

      case 'disconnect_bot': {
        const botName = args?.name as string;

        if (!botName) {
          return errorResponse('Bot name is required');
        }

        // Supersedes any execution still running on this bot.
        await botExecutions.run(botName, extra.signal, async () => botManager.disconnect(botName));
        return successResponse({ message: `Disconnected bot "${botName}"` });
      }

      case 'list_bots': {
        const bots = botManager.list();
        return successResponse({
          bots,
          count: bots.length
        });
      }

      case 'execute_code': {
        const botName = args?.bot_name as string;
        const code = args?.code as string;

        if (!botName) {
          return errorResponse('bot_name is required');
        }

        if (!code) {
          return errorResponse('code is required');
        }

        const timeoutMinutes = Math.min(Math.max((args?.timeout as number) || 2, 0.1), 60);
        return executeCode(botManager, botName, code, timeoutMinutes * 60_000, extra.signal);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const errorMessage = `Error: ${error.message}\n\nStack trace:\n${error.stack}`;
    return {
      content: [{ type: 'text', text: errorMessage }],
      isError: true
    };
  }
});

function successResponse(data: any) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  };
}

function errorResponse(message: string) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true
  };
}

// Start server
async function main() {
  installExecutionConsoleCapture();
  console.error('[MCP Server] Starting RS-Agent MCP server v2.0...');
  console.error('[MCP Server] Bots auto-connect on the first execute_code call.');

  // Warm the pathfinder before any live session exists: init is fully
  // synchronous (tens of seconds on slow hosts), and paying it lazily inside
  // a walkTo blocks the event loop until the gateway drops the connection.
  initPathfinding();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP Server] Server running on stdio');
}

main().catch((error) => {
  console.error('[MCP Server] Fatal error:', error);
  process.exit(1);
});
