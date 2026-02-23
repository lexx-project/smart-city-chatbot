const { handleAdminMessage, SUPERADMIN_JID } = require('../controllers/adminController');
const { handleWargaMessage } = require('../controllers/wargaController');
const { logIncomingChat } = require('../utils/logger');

const shouldSkipMessage = (msg) => {
    if (!msg?.message) return true;
    if (msg.key?.fromMe) return true;
    if (msg.key?.remoteJid === 'status@broadcast') return true;
    return false;
};

const registerRoutes = (sock) => {
    sock.ev.on('messages.upsert', async ({ type, messages }) => {
        if (!Array.isArray(messages) || messages.length === 0) return;

        for (const msg of messages) {
            try {
                if (shouldSkipMessage(msg)) continue;

                const jid = msg.key.remoteJid;
                if (!jid) continue;

                if (jid === SUPERADMIN_JID) {
                    logIncomingChat(msg, 'SUPERADMIN');
                    await handleAdminMessage(sock, msg);
                } else {
                    logIncomingChat(msg, 'WARGA');
                    await handleWargaMessage(sock, msg);
                }
            } catch (error) {
                console.error('[ROUTER_MESSAGE_ERROR]', error);
            }
        }
    });
};

module.exports = {
    registerRoutes,
};
