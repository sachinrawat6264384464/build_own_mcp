import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  WASocket,
  ConnectionState,
  WAMessage,
  Contact
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultAuthDir = path.resolve(__dirname, '..', 'auth_info_baileys');
const defaultContactsFile = path.resolve(__dirname, '..', 'contacts.json');

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
  contactsFile?: string;
  printQRInTerminal?: boolean;
  onQR?: (qr: string) => void;
  onConnected?: (user: { id: string; name?: string }) => void;
  onDisconnected?: (reason?: string) => void;
  silent?: boolean;
}

export class WhatsAppManager {
  private sock: WASocket | null = null;
  private authDir: string;
  private contactsFile: string;
  private isConnecting = false;
  private isConnected = false;
  private userInfo: { id: string; name?: string } | null = null;
  private recentMessages: RecentMessage[] = [];
  private maxStoredMessages = 100;
  private contacts: Record<string, string> = {}; // name -> JID or phone
  private options: WhatsAppManagerOptions;

  constructor(options: WhatsAppManagerOptions = {}) {
    this.options = options;
    this.authDir =
      options.authDir ||
      process.env.WHATSAPP_AUTH_DIR ||
      defaultAuthDir;
    this.contactsFile =
      options.contactsFile ||
      process.env.WHATSAPP_CONTACTS_FILE ||
      defaultContactsFile;

    this.loadContacts();
  }

  private loadContacts() {
    try {
      if (fs.existsSync(this.contactsFile)) {
        const raw = fs.readFileSync(this.contactsFile, 'utf-8');
        this.contacts = JSON.parse(raw);
      }
    } catch (e: any) {
      console.error('[WhatsApp] Could not load contacts.json:', e?.message);
      this.contacts = {};
    }
  }

  private persistContacts() {
    try {
      fs.writeFileSync(this.contactsFile, JSON.stringify(this.contacts, null, 2), 'utf-8');
    } catch (e: any) {
      console.error('[WhatsApp] Could not save contacts.json:', e?.message);
    }
  }

  public saveContact(name: string, phoneOrJid: string): { success: boolean; name: string; jid: string } {
    const jid = this.formatRecipient(phoneOrJid);
    this.contacts[name.trim()] = jid;
    this.persistContacts();
    return { success: true, name: name.trim(), jid };
  }

  public async listContacts(): Promise<{ savedContacts: Record<string, string>; groups: Array<{ id: string; name: string }> }> {
    const groups: Array<{ id: string; name: string }> = [];

    if (this.sock && this.isConnected) {
      try {
        const participating = await this.sock.groupFetchAllParticipating();
        for (const [id, meta] of Object.entries(participating)) {
          if (meta.subject) {
            groups.push({ id, name: meta.subject });
          }
        }
      } catch (err: any) {
        console.error('[WhatsApp] Error listing groups:', err?.message);
      }
    }

    return {
      savedContacts: this.contacts,
      groups
    };
  }

  public async syncAllContacts(): Promise<{ count: number; contacts: Record<string, string> }> {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp is not connected.');
    }

    const versions = ['critical_unblock_low', 'regular_low', 'regular_high'];
    await this.sock.resyncAppState(versions as any, true);
    this.loadContacts();
    return {
      count: Object.keys(this.contacts).length,
      contacts: this.contacts
    };
  }

  public async resolveRecipient(recipient: string): Promise<{ jid: string; resolvedName?: string }> {
    this.loadContacts();
    const clean = recipient.trim();

    // 1. If it's already an explicit JID or direct phone number
    const isPhoneNumber = /^(\+?\d{1,4}[\s-]?)?(\(?\d{2,5}\)?[\s-]?)?\d{4,12}$/.test(clean);
    if (isPhoneNumber || clean.endsWith('@s.whatsapp.net') || clean.endsWith('@g.us')) {
      return { jid: this.formatRecipient(clean) };
    }

    const query = clean.toLowerCase();

    // 2. Search in saved contacts (exact or partial match)
    for (const [name, jid] of Object.entries(this.contacts)) {
      const lowerName = name.toLowerCase();
      if (lowerName === query || lowerName.includes(query) || query.includes(lowerName)) {
        return { jid: this.formatRecipient(jid), resolvedName: name };
      }
    }

    // 3. Search in WhatsApp participating groups
    if (this.sock && this.isConnected) {
      try {
        const groups = await this.sock.groupFetchAllParticipating();
        for (const [id, meta] of Object.entries(groups)) {
          const lowerSub = (meta.subject || '').toLowerCase();
          if (lowerSub && (lowerSub === query || lowerSub.includes(query) || query.includes(lowerSub))) {
            return { jid: id, resolvedName: meta.subject };
          }
        }
      } catch (e: any) {
        console.error('[WhatsApp] Group search error:', e?.message);
      }
    }

    // 4. Not found
    throw new Error(
      `Contact or Group "${recipient}" nahi mila. Please ek baar unka phone number bata dijiye taaki main unka naam save kar sakun.`
    );
  }

  public getStatus() {
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      user: this.userInfo,
      authDir: this.authDir,
      hasSavedCredentials: fs.existsSync(path.join(this.authDir, 'creds.json')),
      savedContactsCount: Object.keys(this.contacts).length
    };
  }

  public async connect(): Promise<WASocket> {
    if (this.sock && this.isConnected) {
      return this.sock;
    }

    if (this.isConnecting) {
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

    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

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

    sock.ev.on('creds.update', saveCreds);

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

    // Auto-record incoming & outgoing messages and contacts
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        this.storeMessage(msg);
      }
    });

    // Auto-save contacts when received
    sock.ev.on('contacts.upsert', (contacts: Contact[]) => {
      for (const c of contacts) {
        const name = c.name || c.notify || c.verifiedName;
        if (name && c.id) {
          this.contacts[name.trim()] = c.id;
        }
      }
      this.persistContacts();
    });

    sock.ev.on('contacts.update', (updates) => {
      for (const u of updates) {
        const name = u.name || u.notify || u.verifiedName;
        if (name && u.id) {
          this.contacts[name.trim()] = u.id;
        }
      }
      this.persistContacts();
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

    // Auto-learn contact name from pushName if available
    if (msg.pushName && chatJid.endsWith('@s.whatsapp.net')) {
      if (!this.contacts[msg.pushName.trim()]) {
        this.contacts[msg.pushName.trim()] = chatJid;
        this.persistContacts();
      }
    }

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

    if (clean.endsWith('@s.whatsapp.net') || clean.endsWith('@g.us') || clean.endsWith('@lid')) {
      return clean;
    }

    clean = clean.replace(/\D/g, '');

    if (clean.length === 10) {
      clean = defaultCountryCode + clean;
    }

    return `${clean}@s.whatsapp.net`;
  }

  public async checkNumberExists(phone: string): Promise<{ exists: boolean; jid?: string }> {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp is not connected.');
    }

    const jid = this.formatRecipient(phone);
    if (jid.endsWith('@g.us') || jid.endsWith('@lid')) {
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
  ): Promise<{ success: boolean; messageId: string; recipient: string; resolvedName?: string }> {
    if (!this.sock || !this.isConnected) {
      throw new Error(
        'WhatsApp is not connected yet! Please ensure the server is running.'
      );
    }

    // Resolve contact name or group name to JID
    const { jid: targetJid, resolvedName } = await this.resolveRecipient(recipient);

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
      recipient: targetJid,
      resolvedName
    };
  }
}
