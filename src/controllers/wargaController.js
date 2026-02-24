const fs = require('fs/promises');
const path = require('path');
// Import sendListMessage kita matikan sementara karena pakai teks biasa
// const { sendListMessage } = require('../utils/messageHelper');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const sessions = new Map();

const TIMEOUT_TEXT = 'Terima kasih telah menghubungi kami. Sesi Anda telah berakhir karena tidak ada aktivitas. Silakan kirim *halo* lagi untuk memulai sesi baru.';

const loadCmsData = async () => {
    const raw = await fs.readFile(CMS_DATA_PATH, 'utf-8');
    return JSON.parse(raw);
};

const clearSessionTimer = (jid) => {
    const session = sessions.get(jid);
    if (!session?.timeoutId) return;
    clearTimeout(session.timeoutId);
};

const endSession = async (sock, jid, sendTimeoutMessage = false) => {
    clearSessionTimer(jid);
    sessions.delete(jid);

    if (sendTimeoutMessage) {
        await sock.sendMessage(jid, { text: TIMEOUT_TEXT });
    }
};

const scheduleSessionTimeout = (sock, jid, timeoutSeconds) => {
    clearSessionTimer(jid);

    const timeoutId = setTimeout(async () => {
        try {
            await endSession(sock, jid, true);
        } catch (error) {
            console.error('[WARGA_TIMEOUT_ERROR]', error);
        }
    }, timeoutSeconds * 1000);

    const current = sessions.get(jid) || {};
    sessions.set(jid, {
        ...current,
        timeoutId,
        timeoutSeconds,
        updatedAt: Date.now(),
    });
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

const processWargaInput = async (sock, msg, text, cmsData, session) => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return;

    // Cek apakah input warga (angka) ada di pilihan sesi saat ini
    let inputId = text; 
    if (session.currentOptions && session.currentOptions[text]) {
        inputId = session.currentOptions[text];
    }

    const response = resolveSubMenuResponse(cmsData.subMenus, inputId);

    if (!response) {
        await sock.sendMessage(jid, {
            text: '❌ Pilihan tidak valid. Silakan balas dengan angka yang ada di menu, atau ketik *halo* untuk kembali ke awal.',
        });
        return;
    }

    if (response.hasNestedMenu) {
        // Render sub-menu dalam bentuk teks
        await sendTextMenu(sock, jid, response.text, response.nestedMenu, session);
    } else {
        // Kalau udah mentok di info akhir, bersihin opsi
        session.currentOptions = null;
        await sock.sendMessage(jid, { text: response.text });
    }
};

const handleWargaMessage = async (sock, msg, bodyText = '') => {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    const text = (bodyText || '').trim();
    const normalizedText = text.toLowerCase();

    if (!text) return;

    const cmsData = await loadCmsData();
    const timeoutSeconds = Number(cmsData.timeoutSeconds) > 0 ? Number(cmsData.timeoutSeconds) : 30;
    let existingSession = sessions.get(jid);

    if (normalizedText === 'halo') {
        const newSession = {
            ...(existingSession || {}),
            startedAt: existingSession?.startedAt || Date.now(),
            timeoutSeconds,
            timeoutId: existingSession?.timeoutId || null,
            currentOptions: null // Reset opsi saat mulai baru
        };
        sessions.set(jid, newSession);
        
        await sendGreetingAndMainMenu(sock, msg, cmsData, newSession);
        scheduleSessionTimeout(sock, jid, timeoutSeconds);
        return;
    }

    if (!existingSession) {
        await sock.sendMessage(jid, {
            text: 'Sesi belum dimulai. Ketik *halo* untuk memulai dan melihat daftar layanan.',
        });
        return;
    }

    scheduleSessionTimeout(sock, jid, timeoutSeconds);
    await processWargaInput(sock, msg, text, cmsData, existingSession);
    scheduleSessionTimeout(sock, jid, timeoutSeconds);
};

module.exports = {
    handleWargaMessage,
    sessions,
};