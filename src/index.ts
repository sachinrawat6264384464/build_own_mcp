#!/usr/bin/env node

/**
 * WhatsApp MCP Server
 * Connects AI Assistants (Antigravity, Claude Desktop, Cursor) to WhatsApp.
 */

// CRITICAL: Redirect all stdout console.log to stderr so JSON-RPC stdio protocol is NEVER corrupted.
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
console.log = (...args: any[]) => {
  console.error('[MCP WhatsApp]', ...args);
};

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WhatsAppManager } from './whatsapp.js';

// Initialize WhatsApp Manager
const whatsapp = new WhatsAppManager({
  printQRInTerminal: false,
  onConnected: (user) => {
    console.error(`[MCP WhatsApp] Connected as ${user.name || user.id}`);
  },
  onDisconnected: (reason) => {
    console.error(`[MCP WhatsApp] Disconnected: ${reason || 'Unknown'}`);
  }
});

// Start connecting in background if saved credentials exist
whatsapp.connect().catch((err) => {
  console.error('[MCP WhatsApp] Background connection init:', err?.message || err);
});

// Create MCP Server instance
const server = new McpServer({
  name: 'whatsapp-mcp',
  version: '1.0.0'
});

// Tool: send_message
server.tool(
  'send_message',
  'Send a WhatsApp message to a phone number or group. Automatically formats Indian & international numbers.',
  {
    recipient: z
      .string()
      .describe(
        'Phone number with country code (e.g. +91 98765 43210, 919876543210, or 10-digit 9876543210 for India) or group JID'
      ),
    message: z.string().describe('The text message to send')
  },
  async ({ recipient, message }) => {
    try {
      const status = whatsapp.getStatus();
      if (!status.connected) {
        return {
          content: [
            {
              type: 'text',
              text: `WhatsApp is not connected yet. Please run "npm run auth" once in terminal to scan the QR code and pair your WhatsApp account.`
            }
          ],
          isError: true
        };
      }

      const res = await whatsapp.sendMessage(recipient, message);
      return {
        content: [
          {
            type: 'text',
            text: `✅ Message sent successfully!\nRecipient: ${res.recipient}\nMessage ID: ${res.messageId}\nMessage: "${message}"`
          }
        ]
      };
    } catch (err: any) {
      console.error('[MCP WhatsApp] Error in send_message:', err);
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to send message: ${err?.message || 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: check_number
server.tool(
  'check_number',
  'Verify if a phone number is registered on WhatsApp before sending a message.',
  {
    phone: z.string().describe('Phone number to check (e.g. +91 98765 43210, 9876543210)')
  },
  async ({ phone }) => {
    try {
      const status = whatsapp.getStatus();
      if (!status.connected) {
        return {
          content: [
            {
              type: 'text',
              text: `WhatsApp is not connected. Run "npm run auth" to connect.`
            }
          ],
          isError: true
        };
      }

      const res = await whatsapp.checkNumberExists(phone);
      if (res.exists) {
        return {
          content: [
            {
              type: 'text',
              text: `✅ Number ${phone} IS registered on WhatsApp (${res.jid}).`
            }
          ]
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `⚠️ Number ${phone} is NOT registered on WhatsApp.`
            }
          ]
        };
      }
    } catch (err: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error checking number: ${err?.message || 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: get_status
server.tool(
  'get_status',
  'Get current WhatsApp connection status, logged-in phone number, and session state.',
  {},
  async () => {
    const status = whatsapp.getStatus();
    const info = [
      `Status: ${status.connected ? '🟢 Connected' : status.connecting ? '🟡 Connecting...' : '🔴 Disconnected'}`,
      `Saved Credentials: ${status.hasSavedCredentials ? 'Yes' : 'No'}`,
      `Auth Directory: ${status.authDir}`
    ];

    if (status.user) {
      info.push(`Logged-in User: ${status.user.name ? `${status.user.name} (${status.user.id})` : status.user.id}`);
    }

    if (!status.connected && !status.hasSavedCredentials) {
      info.push(`\n👉 To authenticate, run \`npm run auth\` in the terminal to scan the QR code.`);
    }

    return {
      content: [
        {
          type: 'text',
          text: info.join('\n')
        }
      ]
    };
  }
);

// Tool: get_recent_messages
server.tool(
  'get_recent_messages',
  'Get recent incoming or outgoing WhatsApp messages received during this session.',
  {
    limit: z.number().optional().describe('Maximum number of messages to return (default: 10)'),
    phone: z.string().optional().describe('Filter by specific phone number or contact')
  },
  async ({ limit = 10, phone }) => {
    const msgs = whatsapp.getRecentMessages(limit, phone);

    if (msgs.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No messages recorded in the current session yet.'
          }
        ]
      };
    }

    const formatted = msgs.map((m, idx) => {
      const time = new Date(m.timestamp).toLocaleTimeString();
      const direction = m.fromMe ? '➡️ Sent' : '⬅️ Received';
      const sender = m.fromMe ? 'Me' : m.pushName ? `${m.pushName} (${m.from})` : m.from;
      return `${idx + 1}. [${time}] ${direction} | From/To: ${sender}\n   Message: ${m.text}`;
    });

    return {
      content: [
        {
          type: 'text',
          text: `Found ${msgs.length} recent message(s):\n\n` + formatted.join('\n\n')
        }
      ]
    };
  }
);

// Start MCP Server with Stdio transport
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP WhatsApp] WhatsApp MCP Server is running over stdio...');
}

run().catch((err) => {
  console.error('[MCP WhatsApp] Fatal server startup error:', err);
  process.exit(1);
});
