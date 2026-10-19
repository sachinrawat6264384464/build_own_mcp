import qrcode from 'qrcode-terminal';
import { WhatsAppManager } from './whatsapp.js';

console.log('====================================================');
console.log('      📱 WhatsApp MCP Server - Authentication       ');
console.log('====================================================');
console.log('Starting WhatsApp client... Please wait for QR code.');

const manager = new WhatsAppManager({
  onQR: (qr) => {
    console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP ---');
    console.log('1. Open WhatsApp on your phone');
    console.log('2. Tap Settings (or 3 dots) -> Linked Devices');
    console.log('3. Tap "Link a Device" and scan the QR code below:\n');

    qrcode.generate(qr, { small: true });
    console.log('\nWaiting for connection...\n');
  },
  onConnected: (user) => {
    console.log('\n====================================================');
    console.log('  🎉 SUCCESS: WhatsApp Connected Successfully!');
    console.log('====================================================');
    console.log(`📱 Phone / ID: ${user.id}`);
    if (user.name) {
      console.log(`👤 Name: ${user.name}`);
    }
    console.log('💾 Session saved to: ./auth_info_baileys');
    console.log('\nYou can now start the MCP Server via:');
    console.log('  npm start');
    console.log('\nOr configure it in your AI Agent (Antigravity/Claude).');
    console.log('Exiting in 3 seconds...');

    setTimeout(() => {
      process.exit(0);
    }, 3000);
  },
  onDisconnected: (reason) => {
    console.log(`\nConnection closed: ${reason || 'Unknown reason'}`);
  }
});

manager.connect().catch((err) => {
  console.error('Fatal error during connection:', err);
  process.exit(1);
});
