const path = require('path');
const P = require('pino'); // <--- INI YANG HILANG (Si P)
const qrcode = require('qrcode-terminal');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { registerRoutes } = require('./src/routes');

const AUTH_DIR = path.join(__dirname, 'session');

const startBot = async () => {
    console.log('[SYSTEM] Memulai bot, memeriksa sesi...');
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }), // <--- Makanya dia error di sini karena P nya gak ada
        browser: ['Smart Public Service Bot', 'Chrome', '1.0.0'],
    });

    registerRoutes(sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        console.log('[KONEKSI UPDATE]:', connection || 'Generating QR/Connecting...');

        if (qr) {
            console.log('\n=======================================');
            console.log('[QR CODE READY] SILAKAN SCAN SEKARANG:');
            console.log('=======================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[KONEKSI TERPUTUS] Status Code: ${statusCode}. Reconnect: ${shouldReconnect}`);

            if (shouldReconnect) {
                console.log('[SYSTEM] Mencoba menyambung kembali...');
                startBot().catch((error) => {
                    console.error('[WA] Reconnect failed', error);
                });
            } else {
                console.log('[SYSTEM] Logged out. Silakan hapus folder session dan restart.');
            }
        } else if (connection === 'open') {
            console.log('\n[BERHASIL] Bot sudah terhubung dan siap menerima pesan!\n');
        }
    });
};

startBot().catch((error) => {
    console.error('[APP_BOOT_ERROR]', error);
    process.exit(1);
});