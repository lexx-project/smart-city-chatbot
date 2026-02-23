const path = require('path');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
} = require('baileys-mod'); // <--- UDAH DIGANTI DI SINI 😁
const { registerRoutes } = require('./src/routes');

const AUTH_DIR = path.join(__dirname, 'session');

const startBot = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }),
        browser: ['Smart Public Service Bot', 'Chrome', '1.0.0'],
    });

    registerRoutes(sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                startBot().catch((error) => {
                    console.error('[WA] Reconnect failed', error);
                });
            }
        }
    });
};

startBot().catch((error) => {
    console.error('[APP_BOOT_ERROR]', error);
    process.exit(1);
});