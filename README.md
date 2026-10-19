# 📱 WhatsApp MCP Server

A Model Context Protocol (MCP) server that empowers AI agents (Antigravity IDE, Claude Desktop, Cursor, Cline) to connect directly with your personal WhatsApp account to send messages, verify phone numbers, and check chat updates.

Built using [Baileys](https://github.com/WhiskeySockets/Baileys) (WebSocket WhatsApp Web API) and the official [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk).

---

## ✨ Features

- **🚀 Direct Personal WhatsApp Integration**: Send messages directly from your existing WhatsApp number without expensive business verification or paid APIs.
- **🛡️ Secure Local Session**: Session credentials are encrypted and stored locally in `./auth_info_baileys` (auto-ignored by Git).
- **⚡ Super Fast & Lightweight**: Uses pure WebSockets without running heavy Chromium/Puppeteer browsers.
- **🛠️ Rich MCP Tools**:
  - `send_message`: Send messages to any phone number (auto-formats Indian numbers and international formats) or group.
  - `check_number`: Check if a phone number is registered on WhatsApp before messaging.
  - `get_status`: View current WhatsApp connection status, logged-in phone number, and state.
  - `get_recent_messages`: Read recent incoming and outgoing messages from this session.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js** v18+ (tested on Node v20/v22/v24)
- **Git**
- A smartphone with WhatsApp installed

### 2. Installation & Build

```bash
# Clone the repository
git clone https://github.com/sachinrawat6264384464/build_own_mcp.git
cd build_own_mcp

# Install dependencies
npm install

# Build TypeScript code
npm run build
```

---

### 3. One-Time WhatsApp Authentication (QR Code)

Run the auth command in your terminal:

```bash
npm run auth
```

1. A **QR code** will appear in your terminal.
2. Open WhatsApp on your phone.
3. Go to **Settings** (or tap the 3 dots on Android) -> **Linked Devices** -> **Link a Device**.
4. Scan the QR code displayed in the terminal.
5. Once connected, your session will be saved locally to `./auth_info_baileys`. You only need to do this once!

---

## 🤖 AI Agent Setup (Configuration)

### A. Antigravity IDE
Add the server to your Antigravity MCP config:
- **Location**: `C:\Users\<YourUser>\.gemini\config\mcp_config.json` or `.agents\mcp_config.json`

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["d:/build_own_mcp/dist/index.js"]
    }
  }
}
```

### B. Claude Desktop
Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["D:\\build_own_mcp\\dist\\index.js"]
    }
  }
}
```

### C. Cursor / Cline / Roo Code
Configure MCP server command:
- **Command**: `node`
- **Args**: `["D:/build_own_mcp/dist/index.js"]`

---

## 🛠️ MCP Tools Reference

### 1. `send_message`
Sends a WhatsApp message to a given recipient.
- **Parameters**:
  - `recipient` *(string, required)*: Phone number with country code (e.g. `+91 98765 43210`, `919876543210`, or 10-digit Indian number `9876543210`) or Group JID.
  - `message` *(string, required)*: Message text.
- **Example Agent Command**:
  > *"Rahul ko WhatsApp pe message bhej: 'Meeting 5 baje reschedule ho gayi hai' (number: 9876543210)"*

### 2. `check_number`
Checks whether a phone number is registered on WhatsApp.
- **Parameters**:
  - `phone` *(string, required)*: Phone number to verify.

### 3. `get_status`
Returns the status of the connection and the logged-in phone number.

### 4. `get_recent_messages`
Retrieves recent messages received or sent during the current session.
- **Parameters**:
  - `limit` *(number, optional)*: Maximum messages to retrieve (default: 10).
  - `phone` *(string, optional)*: Filter by contact/number.

---

## 🔒 Security & Privacy Notice

- **Your credentials stay local**: Authentication tokens are stored inside `./auth_info_baileys/`.
- **Never share or commit** `./auth_info_baileys/` to public repositories. (This is already included in `.gitignore`).
- This project uses the unofficial WhatsApp Web protocol. Follow WhatsApp terms of service and avoid spamming.

---

## 📄 License
MIT License. Created for AI Agent builders.
