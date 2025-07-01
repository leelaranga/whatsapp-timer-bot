import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import schedule from 'node-schedule';

const authFolder = path.join(__dirname, 'baileys_auth_info');

const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;

        if (qr) {
            console.log('\n📱 QR Code (may not fit in terminal):');
            qrcode.generate(qr, { small: true });

            QRCode.toDataURL(qr, (err, url) => {
                if (err) return console.error('⚠️ Error generating QR link:', err);
                console.log('\n🔗 Open this link in your browser to scan the QR code:');
                console.log(url);
            });
        }

        if (connection === 'open') {
            console.log('✅ WhatsApp connected!');
        } else if (connection === 'close') {
            const reason = update.lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Disconnected with reason: ${reason}`);

            if (reason !== DisconnectReason.loggedOut) {
                startSock();
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // 🔔 Command Listener for "#timer"
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!body || !body.startsWith('#timer')) return;

        try {
            const [, number, timeStr, ...textParts] = body.split(' ');
            const text = textParts.join(' ');
            const [hours, minutes] = timeStr.split(':').map(Number);

            const now = new Date();
            const scheduledTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);

            if (scheduledTime < now) {
                scheduledTime.setDate(scheduledTime.getDate() + 1); // Schedule for next day if time already passed
            }

            const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

            // ✅ Confirm timer to sender
            await sock.sendMessage(msg.key.remoteJid, {
                text: `✅ Timer set for ${timeStr} to send to ${number}`
            });

            // ⏱️ Schedule the message
            schedule.scheduleJob(scheduledTime, async () => {
                await sock.sendMessage(jid, { text });
                console.log(`📤 Sent to ${number} at ${timeStr}: ${text}`);
            });
        } catch (err) {
            console.error('❌ Failed to handle #timer command:', err);
            await sock.sendMessage(msg.key.remoteJid, {
                text: `⚠️ Error setting timer. Use this format:\n#timer <number> <HH:MM> <message>`
            });
        }
    });
};

startSock();
