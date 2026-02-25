const fs = require('fs/promises');
const path = require('path');
const { SESSION_DIR, DEFAULT_WARGA_TIMEOUT_SECONDS, LONG_INPUT_TIMEOUT_SECONDS, LONG_INPUT_MENU_IDS } = require('../../settings');
// Import sendListMessage kita matikan sementara karena pakai teks biasa
// const { sendListMessage } = require('../utils/messageHelper');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const sessions = new Map();
const sessionAliasIndex = new Map();

const TIMEOUT_TEXT = 'Terima kasih telah menghubungi kami. Sesi Anda telah berakhir karena tidak ada aktivitas. Silakan kirim pesan lagi untuk memulai sesi baru.';
const SESSION_END_TEXT = 'Terima kasih sudah menggunakan layanan Smart Public Service. Sampai jumpa.';

const loadCmsData = async () => {
    const raw = await fs.readFile(CMS_DATA_PATH, 'utf-8');
    return JSON.parse(raw);
};

const readJsonStringFile = async (filePath) => {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return '';
    }
};

const resolvePhoneFromLid = async (lidLocalId) => {
    const reversePath = path.join(SESSION_DIR, `lid-mapping-${lidLocalId}_reverse.json`);
    const mapped = await readJsonStringFile(reversePath);
    return String(mapped || '').replace(/\D/g, '');
};

const toSessionKey = async (jid = '') => {
    const [local = '', domain = ''] = String(jid).split('@');
    const digits = local.replace(/\D/g, '');

    if (domain === 'lid') {
        const mappedPhone = await resolvePhoneFromLid(digits);
        return mappedPhone || digits || String(jid);
    }

    return digits || String(jid);
};

const clearSessionTimer = (sessionKey) => {
    const session = sessions.get(sessionKey);
    if (!session?.timeoutId) return;
    clearTimeout(session.timeoutId);
};

const registerSessionAlias = (sessionKey, alias, session) => {
    if (!alias) return;
    sessionAliasIndex.set(alias, sessionKey);
    if (!session._aliases) session._aliases = new Set();
    session._aliases.add(alias);
};

const registerAliasesForJid = (sessionKey, jid, session) => {
    const local = String(jid || '').split('@')[0] || '';
    registerSessionAlias(sessionKey, jid, session);
    registerSessionAlias(sessionKey, local, session);
};

const endSession = async (sock, sessionKey, replyJid, sendTimeoutMessage = false) => {
    const session = sessions.get(sessionKey);
    clearSessionTimer(sessionKey);
    sessions.delete(sessionKey);
    if (session?._aliases) {
        for (const alias of session._aliases) {
            if (sessionAliasIndex.get(alias) === sessionKey) {
                sessionAliasIndex.delete(alias);
            }
        }
    }

    if (sendTimeoutMessage) {
        await sock.sendMessage(replyJid, { text: TIMEOUT_TEXT });
    }
};

const scheduleSessionTimeout = (sock, sessionKey, replyJid, timeoutSeconds) => {
    clearSessionTimer(sessionKey);

    const timeoutId = setTimeout(async () => {
        try {
            await endSession(sock, sessionKey, replyJid, true);
        } catch (error) {
            console.error('[WARGA_TIMEOUT_ERROR]', error);
        }
    }, timeoutSeconds * 1000);

    // Keep the same session object reference so nested menu option mapping
    // (currentOptions) is not lost between timer refreshes.
    const current = sessions.get(sessionKey) || {};
    current.timeoutId = timeoutId;
    current.timeoutSeconds = timeoutSeconds;
    current.updatedAt = Date.now();
    sessions.set(sessionKey, current);
};

// --- FUNGSI BARU: Pembuat Menu Teks ---
const sendTextMenu = async (sock, jid, textBlock, menuArray, session) => {
    let message = textBlock + "\n\n";
    let optionsMap = {};

    menuArray.forEach((item, index) => {
        const num = String(index + 1);
        // Format teks: 1. Nama Menu
        message += `*${num}.* ${item.title}\n`;
        // Simpan pemetaan nomor ke ID menu (misal: "1" -> "menu_kependudukan")
        optionsMap[num] = item.id;
    });

    message += "\n👉 *Balas dengan angka (contoh: 1) untuk memilih.*";

    // Simpan optionsMap ke sesi user biar bot tahu nomor 1 itu apa pas dibalas
    session.currentOptions = optionsMap;

    await sock.sendMessage(jid, { text: message });
};

const resolveSubMenuResponse = (subMenus, menuId) => {
    const menuData = subMenus?.[menuId];
    if (!menuData) return null;

    if (typeof menuData === 'string') {
        return { text: menuData, hasNestedMenu: false };
    }

    const text = menuData.text || 'Silakan pilih opsi lanjutan:';
    const nestedMenu = menuData.nextMenu;

    if (Array.isArray(nestedMenu) && nestedMenu.length > 0) {
        const rows = nestedMenu.map((row) => ({
            title: row.title,
            id: row.id,
        }));
        return {
            text,
            hasNestedMenu: true,
            nestedMenu: rows,
        };
    }

    return { text, hasNestedMenu: false };
};

const isLongInputFeature = (menuId) => {
    return Array.isArray(LONG_INPUT_MENU_IDS) && LONG_INPUT_MENU_IDS.includes(menuId);
};

const applySessionTimeout = (sock, sessionKey, jid, session, fallbackTimeoutSeconds) => {
    const timeoutSeconds = Number(session.timeoutSeconds) > 0
        ? Number(session.timeoutSeconds)
        : fallbackTimeoutSeconds;
    scheduleSessionTimeout(sock, sessionKey, jid, timeoutSeconds);
};

const sendGreetingAndMainMenu = async (sock, msg, cmsData, session) => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return;

    if (!cmsData.mainMenu || cmsData.mainMenu.length === 0) {
        await sock.sendMessage(jid, {
            text: 'Menu layanan belum dikonfigurasi. Silakan hubungi admin.',
        });
        return;
    }

    const greetingText = cmsData.greetingMessage ? `${cmsData.greetingMessage}\n\n` : '';
    const mainText = `${greetingText}Silakan pilih layanan yang Anda butuhkan:`;

    await sendTextMenu(sock, jid, mainText, cmsData.mainMenu, session);
};

const processWargaInput = async (sock, msg, text, cmsData, session, sessionKey) => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return { endSessionNow: false };

    if (session.awaitingLongInputFor) {
        await sock.sendMessage(jid, {
            text: 'Terima kasih. Laporan Anda sudah kami terima dan akan diproses.',
        });
        await sock.sendMessage(jid, { text: SESSION_END_TEXT });
        await endSession(sock, sessionKey, jid, false);
        return { endSessionNow: true };
    }

    const hasPendingOptions = !!session.currentOptions;

    if (hasPendingOptions && !session.currentOptions[text]) {
        await sock.sendMessage(jid, {
            text: '❌ Pilihan tidak valid. Silakan balas dengan angka yang tersedia pada menu.',
        });
        return { endSessionNow: false };
    }

    // Cek apakah input warga (angka) ada di pilihan sesi saat ini
    let inputId = text;
    if (hasPendingOptions && session.currentOptions[text]) {
        inputId = session.currentOptions[text];
    }

    const response = resolveSubMenuResponse(cmsData.subMenus, inputId);

    if (!response) {
        await sock.sendMessage(jid, {
            text: '❌ Pilihan tidak valid. Silakan pilih layanan yang tersedia.',
        });
        return { endSessionNow: false };
    }

    if (response.hasNestedMenu) {
        // Render sub-menu dalam bentuk teks
        session.awaitingLongInputFor = null;
        await sendTextMenu(sock, jid, response.text, response.nestedMenu, session);
        return { endSessionNow: false };
    } else {
        // Kalau sudah sampai leaf, langsung beri jawaban akhir.
        // Untuk fitur input panjang (contoh pengaduan), beri waktu lebih panjang
        // lalu tunggu input bebas berikutnya.
        session.currentOptions = null;
        await sock.sendMessage(jid, { text: response.text });

        if (isLongInputFeature(inputId)) {
            session.awaitingLongInputFor = inputId;
            session.timeoutSeconds = LONG_INPUT_TIMEOUT_SECONDS;
            return { endSessionNow: false };
        }

        session.awaitingLongInputFor = null;
        await sock.sendMessage(jid, { text: SESSION_END_TEXT });
        await endSession(sock, sessionKey, jid, false);
        return { endSessionNow: true };
    }
};

const handleWargaMessage = async (sock, msg, bodyText = '') => {
    const jid = msg.key.remoteJid;
    if (!jid) return;
    const rawSessionKey = await toSessionKey(jid);
    let sessionKey = rawSessionKey;

    const text = (bodyText || '').trim();
    const normalizedText = text.toLowerCase();

    if (!text) return;

    if (normalizedText === '/setting') {
        await sock.sendMessage(jid, {
            text: 'Akses ditolak. Fitur /setting hanya untuk admin.',
        });
        return;
    }

    const cmsData = await loadCmsData();
    const timeoutSeconds = Number(cmsData.timeoutSeconds) > 0
        ? Number(cmsData.timeoutSeconds)
        : DEFAULT_WARGA_TIMEOUT_SECONDS;
    let existingSession = sessions.get(sessionKey);

    if (!existingSession) {
        const local = String(jid).split('@')[0] || '';
        const aliasedKey = sessionAliasIndex.get(jid) || sessionAliasIndex.get(local);
        if (aliasedKey && sessions.has(aliasedKey)) {
            sessionKey = aliasedKey;
            existingSession = sessions.get(aliasedKey);
        }
    }

    if (!existingSession) {
        const newSession = {
            startedAt: Date.now(),
            timeoutSeconds,
            timeoutId: null,
            currentOptions: null,
            awaitingLongInputFor: null,
            _aliases: new Set(),
        };
        sessions.set(sessionKey, newSession);
        registerAliasesForJid(sessionKey, jid, newSession);

        await sendGreetingAndMainMenu(sock, msg, cmsData, newSession);
        applySessionTimeout(sock, sessionKey, jid, newSession, timeoutSeconds);
        return;
    }
    registerAliasesForJid(sessionKey, jid, existingSession);

    const result = await processWargaInput(sock, msg, text, cmsData, existingSession, sessionKey);
    if (result?.endSessionNow) return;
    applySessionTimeout(sock, sessionKey, jid, existingSession, timeoutSeconds);
};

module.exports = {
    handleWargaMessage,
    sessions,
};
