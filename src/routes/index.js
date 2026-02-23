const { handleAdminMessage, SUPERADMIN_JID } = require('../controllers/adminController');
const { handleWargaMessage } = require('../controllers/wargaController');
const { logIncomingChat } = require('../utils/logger');

const unwrapMessage = (message) => {
    if (!message) return {};

    let current = message;
    let guard = 0;

    while (guard < 5) {
        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            guard += 1;
            continue;
        }

        if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
            guard += 1;
            continue;
        }

        if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
            guard += 1;
            continue;
        }

        if (current.viewOnceMessageV2Extension?.message) {
            current = current.viewOnceMessageV2Extension.message;
            guard += 1;
            continue;
        }

        break;
    }

    return current;
};

const extractBodyText = (msg) => {
    const rawMessage = unwrapMessage(msg?.message || {});
    let bodyText = "";
    const interactiveResp = rawMessage?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;

    if (interactiveResp) {
        try {
            const parsedParams = JSON.parse(interactiveResp);
            bodyText = parsedParams.id; // The ID set in the rows
        } catch {
            bodyText = "";
        }
    } else {
        bodyText = (
            rawMessage?.conversation ||
            rawMessage?.extendedTextMessage?.text ||
            rawMessage?.imageMessage?.caption ||
            rawMessage?.videoMessage?.caption ||
            rawMessage?.buttonsResponseMessage?.selectedDisplayText ||
            rawMessage?.listResponseMessage?.title ||
            rawMessage?.templateButtonReplyMessage?.selectedDisplayText ||
            ""
        ).trim();
    }

    return bodyText;
};

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
                const bodyText = extractBodyText(msg);
                if (!bodyText) continue;
                msg.bodyText = bodyText;

                if (jid === SUPERADMIN_JID) {
                    logIncomingChat(msg, 'SUPERADMIN');
                    await handleAdminMessage(sock, msg, bodyText);
                } else {
                    logIncomingChat(msg, 'WARGA');
                    await handleWargaMessage(sock, msg, bodyText);
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
