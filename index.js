const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const { scheduleJob } = require('node-schedule');
const P = require('pino');
const QRCode = require('qrcode');

async function startSock() {
    console.log("🚀 Starting WhatsApp bot...");

    const path = require('path');
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'baileys_auth_info'));
    const { version } = await fetchLatestBaileysVersion();

    console.log(`✅ Using WA Version: ${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
        },
        logger: P({ level: 'silent' }),
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, qr }) => {
        if (qr) {
            console.log('📱 Scan this QR code:\n');
            console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
        }

        if (connection === 'close') {
            console.log('❌ Disconnected. Reconnecting...');
            startSock();
        }

        if (connection === 'open') {
            console.log('✅ WhatsApp connected!');
        }
    });

    // 🔥 Handle Incoming Messages
    sock.ev.on('messages.upsert', async (m) => {
        console.log('📥 New message event received'); // debug log

        const msg = m.messages[0];
        if (!msg.message) return;

        // COMMENT THIS OUT so bot responds to your own messages too
        // if (msg.key.fromMe) return;

        const textMsg = msg.message.conversation || msg.message?.extendedTextMessage?.text;
        console.log('🔎 Parsed message:', textMsg); // debug log

        if (!textMsg) return;

        if (textMsg.startsWith('#timer')) {
            console.log('⏳ Timer command detected'); // debug log

            const parts = textMsg.trim().split(' ');
            if (parts.length < 4) {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Format: #timer <number> <HH:MM> <message>'
                });
                return;
            }

            const phone = parts[1].replace(/\D/g, '');
            const timeString = parts[2];
            const message = parts.slice(3).join(' ');

            const timeMatch = timeString.match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
            if (!timeMatch) {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Invalid time format. Use HH:MM (24-hour).'
                });
                return;
            }

            const [hour, minute] = timeString.split(':').map(Number);
            const now = new Date();
            const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
            if (targetTime < now) {
                targetTime.setDate(targetTime.getDate() + 1); // schedule for next day
            }

            const jid = phone + '@s.whatsapp.net';

            console.log(`📆 Scheduling message to ${phone} at ${targetTime.toLocaleString()}`);

            scheduleJob(targetTime, async () => {
                console.log(`⏰ Timer triggered! Sending to ${phone}...`);
                try {
                    await sock.sendMessage(jid, { text: message });
                    console.log(`📤 Sent to ${phone}: "${message}"`);
                } catch (err) {
                    console.error('❌ Failed to send message:', err);
                }
            });

            await sock.sendMessage(msg.key.remoteJid, {
                text: `✅ Message scheduled!\n📍 To: ${phone}\n🕐 Time: ${targetTime.toLocaleTimeString()}\n💬 "${message}"`
            });
        }
    });

    // Prevent node from exiting
    setInterval(() => {}, 1000);
}

startSock().catch(err => {
    console.error('❌ Error starting bot:', err);
});
