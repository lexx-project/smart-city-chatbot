const path = require('path');

const toNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toList = (value, fallback = []) => {
    if (!value) return fallback;
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const SESSION_PATH = path.join(__dirname, 'session');

module.exports = {
    // WhatsApp auth/session storage
    AUTH_DIR: SESSION_PATH,
    SESSION_DIR: SESSION_PATH,

    // Admin access
    SUPERADMIN_JID: process.env.SUPERADMIN_JID || '62882009391607@s.whatsapp.net',
    ADMIN_FLOW_TIMEOUT_MS: toNumber(process.env.ADMIN_FLOW_TIMEOUT_MS, 60 * 1000),

    // Warga flow timeout behavior
    DEFAULT_WARGA_TIMEOUT_SECONDS: toNumber(process.env.DEFAULT_WARGA_TIMEOUT_SECONDS, 30),
    LONG_INPUT_TIMEOUT_SECONDS: toNumber(process.env.LONG_INPUT_TIMEOUT_SECONDS, 180),
    LONG_INPUT_MENU_IDS: toList(process.env.LONG_INPUT_MENU_IDS, ['menu_pengaduan']),
};
