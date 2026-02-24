const fs = require('fs/promises');
const path = require('path');
// Import sendListMessage kita matikan sementara karena pakai teks biasa
// const { sendListMessage } = require('../utils/messageHelper');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const sessions = new Map();

const TIMEOUT_TEXT = 'Terima kasih telah menghubungi kami. Sesi Anda telah berakhir karena tidak ada aktivitas. Silakan kirim pesan lagi untuk memulai sesi baru.';
const SESSION_END_TEXT = 'Terima kasih sudah menggunakan layanan Smart Public Service. Sampai jumpa.';
const CONTINUE_YES_ID = '__continue_yes';
const CONTINUE_NO_ID = '__continue_no';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    // Keep the same session object reference so nested menu option mapping
    // (currentOptions) is not lost between timer refreshes.
    const current = sessions.get(jid) || {};
    current.timeoutId = timeoutId;
    current.timeoutSeconds = timeoutSeconds;
    current.updatedAt = Date.now();
    sessions.set(jid, current);
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

const sendCompletionConfirmation = async (sock, jid, session) => {
    await sendTextMenu(
        sock,
        jid,
        'Apakah Anda ingin melanjutkan transaksi?',
        [
            { title: 'Ya, kembali ke menu utama', id: CONTINUE_YES_ID },
            { title: 'Tidak, selesai', id: CONTINUE_NO_ID },
        ],
        session
    );
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
    if (!jid) return { endSessionNow: false };

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

    if (inputId === CONTINUE_YES_ID) {
        session.currentOptions = null;
        await sendGreetingAndMainMenu(sock, msg, cmsData, session);
        return { endSessionNow: false };
    }

    if (inputId === CONTINUE_NO_ID) {
        await sock.sendMessage(jid, { text: SESSION_END_TEXT });
        await endSession(sock, jid, false);
        return { endSessionNow: true };
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
        await sendTextMenu(sock, jid, response.text, response.nestedMenu, session);
        return { endSessionNow: false };
    } else {
        // Kalau udah mentok di info akhir, bersihin opsi
        session.currentOptions = null;
        await sock.sendMessage(jid, { text: response.text });
        await wait(3000);
        await sendCompletionConfirmation(sock, jid, session);
        return { endSessionNow: false };
    }
};

const handleWargaMessage = async (sock, msg, bodyText = '') => {
    const jid = msg.key.remoteJid;
    if (!jid) return;

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
    const timeoutSeconds = Number(cmsData.timeoutSeconds) > 0 ? Number(cmsData.timeoutSeconds) : 30;
    const existingSession = sessions.get(jid);

    if (!existingSession) {
        const newSession = {
            startedAt: Date.now(),
            timeoutSeconds,
            timeoutId: null,
            currentOptions: null
        };
        sessions.set(jid, newSession);

        await sendGreetingAndMainMenu(sock, msg, cmsData, newSession);
        scheduleSessionTimeout(sock, jid, timeoutSeconds);
        return;
    }

    const result = await processWargaInput(sock, msg, text, cmsData, existingSession);
    if (result?.endSessionNow) return;
    scheduleSessionTimeout(sock, jid, timeoutSeconds);
};

module.exports = {
    handleWargaMessage,
    sessions,
};
