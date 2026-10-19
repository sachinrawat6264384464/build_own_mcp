import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  WASocket,
  ConnectionState,
  WAMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';

export interface RecentMessage {
  id: string;
  from: string;
  fromMe: boolean;
  pushName?: string;
  timestamp: number;
  text: string;
  chatJid: string;
}

export interface WhatsAppManagerOptions {
  authDir?: string;
  printQRInTerminal?: boolean;
  onQR?: (qr: string) => void;
  onConnected?: (user: { id: string; name?: string }) => void;
  onDisconnected?: (reason?: string) => void;
  silent?: boolean;
}

export class WhatsAppManager {
  private sock: WASocket | null = null;
  private authDir: string;
  private isConnecting = false;
  private isConnected = false;
  private userInfo: { id: string; name?: string } | null = null;
  private recentMessages: RecentMessage[] = [];
  private maxStoredMessages = 100;
  private options: WhatsAppManagerOptions;

  constructor(options: WhatsAppManagerOptions = {}) {
    this.options = options;
    this.authDir = options.authDir || path.resolve(process.cwd(), 'auth_info_baileys');
  }

  public getStatus() {
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      user: this.userInfo,
      authDir: this.authDir,
      hasSavedCredentials: fs.existsSync(path.join(this.authDir, 'creds.json'))
    };
  }

  public async connect(): Promise<WASocket> {
    if (this.sock && this.isConnected) {
      return this.sock;
    }

    if (this.isConnecting) {
      // Wait until connection completes or fails
      return new Promise((resolve, reject) => {
        const interval = setInterval(() => {
          if (this.isConnected && this.sock) {
            clearInterval(interval);
            resolve(this.sock);
          } else if (!this.isConnecting) {
            clearInterval(interval);
            reject(new Error('Connection attempt failed'));
          }
        }, 300);
      });
    }

    this.isConnecting = true;

    // Ensure auth directory exists
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    // Create a silent pino logger
    const logger = pino({
      level: 'silent'
    });

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: this.options.printQRInTerminal ?? false,
      logger,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false
    });

    this.sock = sock;

    // Handle credential updates
    sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && this.options.onQR) {
        this.options.onQR(qr);
      }

      if (connection === 'close') {
        this.isConnected = false;
        this.isConnecting = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.error(
          `[WhatsApp] Connection closed due to: ${lastDisconnect?.error?.message || 'Unknown reason'} (Code: ${statusCode})`
        );

        if (this.options.onDisconnected) {
          this.options.onDisconnected(lastDisconnect?.error?.message);
        }

        if (shouldReconnect) {
          console.error('[WhatsApp] Reconnecting in 3 seconds...');
          setTimeout(() => {
            this.connect().catch((err) => {
              console.error('[WhatsApp] Reconnection failed:', err?.message);
            });
          }, 3000);
        } else {
          console.error('[WhatsApp] Logged out! Please run `npm run auth` again to re-authenticate.');
          this.userInfo = null;
        }
      } else if (connection === 'open') {
        this.isConnected = true;
        this.isConnecting = false;
        this.userInfo = {
          id: sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : 'Unknown',
          name: sock.user?.name || undefined
        };
        console.error(`[WhatsApp] Successfully connected as ${this.userInfo.name || this.userInfo.id}`);

        if (this.options.onConnected) {
          this.options.onConnected(this.userInfo);
        }
      }
    });

    // Track incoming & outgoing messages
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      for (const msg of messages) {
        this.storeMessage(msg);
      }
    });

    return sock;
  }

  private storeMessage(msg: WAMessage) {
    if (!msg.message || !msg.key) return;

    const chatJid = msg.key.remoteJid || 'unknown';
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '';

    if (!text) return;

    const record: RecentMessage = {
      id: msg.key.id || String(Date.now()),
      from: msg.key.participant || msg.key.remoteJid || 'unknown',
      fromMe: Boolean(msg.key.fromMe),
      pushName: msg.pushName || undefined,
      timestamp: Number(msg.messageTimestamp) * 1000 || Date.now(),
      text,
      chatJid
    };

    this.recentMessages.unshift(record);
    if (this.recentMessages.length > this.maxStoredMessages) {
      this.recentMessages.pop();
    }
  }

  public getRecentMessages(limit: number = 20, chatJid?: string): RecentMessage[] {
    let list = this.recentMessages;
    if (chatJid) {
      const formatted = this.formatRecipient(chatJid);
      list = list.filter((m) => m.chatJid === formatted || m.chatJid.includes(chatJid));
    }
    return list.slice(0, limit);
  }

  public formatRecipient(recipient: string, defaultCountryCode: string = '91'): string {
    let clean = recipient.trim();

    // If it's already a full JID (e.g. 1234567890@s.whatsapp.net or group @g.us)
    if (clean.endsWith('@s.whatsapp.net') || clean.endsWith('@g.us')) {
      return clean;
    }

    // Strip out +, spaces, brackets, hyphens
    clean = clean.replace(/\D/g, '');

    // If 10 digits (common in India), add defaultCountryCode
    if (clean.length === 10) {
      clean = defaultCountryCode + clean;
    }

    return `${clean}@s.whatsapp.net`;
  }

  public async checkNumberExists(phone: string): Promise<{ exists: boolean; jid?: string }> {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp is not connected. Make sure you have authenticated via `npm run auth`');
    }

    const jid = this.formatRecipient(phone);
    if (jid.endsWith('@g.us')) {
      return { exists: true, jid };
    }

    const results = await this.sock.onWhatsApp(jid);
    const result = results && results.length > 0 ? results[0] : null;
    if (result && result.exists) {
      return { exists: true, jid: result.jid };
    }
    return { exists: false, jid };
  }

  public async sendMessage(
    recipient: string,
    message: string
  ): Promise<{ success: boolean; messageId: string; recipient: string }> {
    if (!this.sock || !this.isConnected) {
      throw new Error(
        'WhatsApp is not connected yet! Please run `npm run auth` once in your terminal to pair your WhatsApp account.'
      );
    }

    const targetJid = this.formatRecipient(recipient);

    // Validate that number exists if it is an individual chat
    if (!targetJid.endsWith('@g.us')) {
      const check = await this.checkNumberExists(targetJid);
      if (!check.exists) {
        throw new Error(
          `Phone number ${recipient} (${targetJid}) does not seem to be registered on WhatsApp.`
        );
      }
    }

    const response = await this.sock.sendMessage(targetJid, { text: message });

    return {
      success: true,
      messageId: response?.key?.id || 'unknown',
      recipient: targetJid
    };
  }
}
