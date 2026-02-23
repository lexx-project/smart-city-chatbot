const fs = require('fs/promises');
const path = require('path');
const { sendListMessage } = require('../utils/messageHelper');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const sessions = new Map();

const TIMEOUT_TEXT = 'Terima kasih telah menghubungi kami. Sesi Anda telah berakhir karena tidak ada aktivitas. Silakan kirim pesan lagi untuk memulai sesi baru.';

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

const buildMainMenuSections = (mainMenu) => {
    const rows = (Array.isArray(mainMenu) ? mainMenu : []).map((item, index) => ({
        title: item.title || `Menu ${index + 1}`,
        description: item.description || '',
        id: item.id || `menu_${index + 1}`,
    }));

    return [{ title: 'Menu Layanan Publik', rows }];
};

const normalizeRows = (rows) => (Array.isArray(rows) ? rows : []).map((row, index) => ({
    title: row.title || `Opsi ${index + 1}`,
    description: row.description || '',
    id: row.id || `opsi_${index + 1}`,
}));

const resolveSubMenuResponse = (subMenus, menuId) => {
    const menuData = subMenus?.[menuId];
    if (!menuData) return null;

    if (typeof menuData === 'string') {
        return { text: menuData, hasNestedMenu: false };
    }

    const text = menuData.text || 'Permintaan Anda sedang diproses.';
    const nestedMenu = menuData.nextMenu;

    if (Array.isArray(nestedMenu) && nestedMenu.length > 0) {
        return {
            text,
            hasNestedMenu: true,
            nestedMenu: normalizeRows(nestedMenu),
            nestedButtonText: menuData.buttonText || 'Pilih Opsi Lanjutan',
            nestedTitle: menuData.title || 'Sub Menu Layanan',
            nestedFooter: menuData.footer || 'Silakan pilih layanan berikutnya',
        };
    }

    return { text, hasNestedMenu: false };
};

const sendGreetingAndMainMenu = async (sock, msg, cmsData) => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return;

    if (cmsData.greetingMessage) {
        await sock.sendMessage(jid, { text: cmsData.greetingMessage });
    }

    const sections = buildMainMenuSections(cmsData.mainMenu);
    if (!sections[0].rows.length) {
        await sock.sendMessage(jid, {
            text: 'Menu layanan belum dikonfigurasi. Silakan hubungi admin.',
        });
        return;
    }

    await sendListMessage(
        sock,
        msg,
        'Layanan Publik',
        'Silakan pilih layanan yang Anda butuhkan.',
        'Smart Public Service',
        'Pilih Layanan',
        sections
    );
};

const processWargaInput = async (sock, msg, selectedId, text, cmsData) => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return;

    if (!selectedId && !text) return;

    const normalizedSelectedId = selectedId || text.toLowerCase().replace(/\s+/g, '_');
    const response = resolveSubMenuResponse(cmsData.subMenus, normalizedSelectedId);

    if (!response) {
        await sock.sendMessage(jid, {
            text: 'Input tidak dikenali. Silakan pilih menu yang tersedia.',
        });
        return;
    }

    await sock.sendMessage(jid, { text: response.text });

    if (response.hasNestedMenu) {
        await sendListMessage(
            sock,
            msg,
            response.nestedTitle,
            'Pilih sub-layanan di bawah ini:',
            response.nestedFooter,
            response.nestedButtonText,
            [{ title: 'Sub Menu', rows: response.nestedMenu }]
        );
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
    const existingSession = sessions.get(jid);

    if (normalizedText === 'halo') {
        sessions.set(jid, {
            ...(existingSession || {}),
            startedAt: existingSession?.startedAt || Date.now(),
            timeoutSeconds,
            timeoutId: existingSession?.timeoutId || null,
        });
        await sendGreetingAndMainMenu(sock, msg, cmsData);
        scheduleSessionTimeout(sock, jid, timeoutSeconds);
        return;
    }

    if (!existingSession) {
        await sock.sendMessage(jid, {
            text: 'Ketik *halo* untuk memulai dan melihat daftar layanan.',
        });
        return;
    }

    scheduleSessionTimeout(sock, jid, timeoutSeconds);
    await processWargaInput(sock, msg, text, text, cmsData);
    scheduleSessionTimeout(sock, jid, timeoutSeconds);
};

module.exports = {
    handleWargaMessage,
    sessions,
};
