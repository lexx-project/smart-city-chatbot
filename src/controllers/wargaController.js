const fs = require('fs/promises');
const path = require('path');
const { sendListMessage } = require('../utils/messageHelper');

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

// --- FIX 1: Ngebaca mainMenu langsung dari JSON lu ---
const buildMainMenuSections = (mainMenu) => {
    const rows = (Array.isArray(mainMenu) ? mainMenu : []).map((item) => ({
        title: item.title,
        description: item.description || '',
        id: item.id,
    }));

    return [{ title: 'Daftar Layanan', rows }];
};

// --- FIX 2: Ngebaca nextMenu dari subMenus JSON lu ---
const resolveSubMenuResponse = (subMenus, menuId) => {
    const menuData = subMenus?.[menuId];
    if (!menuData) return null;

    // Kalau di JSON isinya cuma teks biasa (kayak "menu_pengaduan" atau "dukcapil_ktp")
    if (typeof menuData === 'string') {
        return { text: menuData, hasNestedMenu: false };
    }

    // Kalau di JSON isinya Object dengan "nextMenu" (kayak "menu_kependudukan")
    const text = menuData.text || 'Silakan pilih opsi lanjutan:';
    const nestedMenu = menuData.nextMenu;

    if (Array.isArray(nestedMenu) && nestedMenu.length > 0) {
        const rows = nestedMenu.map((row) => ({
            title: row.title,
            description: row.description || '',
            id: row.id,
        }));
        return {
            text,
            hasNestedMenu: true,
            nestedMenu: rows,
            nestedButtonText: menuData.buttonText || 'Pilih Opsi',
            nestedTitle: menuData.title || 'Sub Menu',
        };
    }

    return { text, hasNestedMenu: false };
};

const sendGreetingAndMainMenu = async (sock, msg, cmsData) => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return;

    const sections = buildMainMenuSections(cmsData.mainMenu);
    if (!sections[0].rows.length) {
        await sock.sendMessage(jid, {
            text: 'Menu layanan belum dikonfigurasi. Silakan hubungi admin.',
        });
        return;
    }

    // Gabungin sapaan dan teks utama (tanpa gambar)
    const greetingText = cmsData.greetingMessage ? `${cmsData.greetingMessage}\n\n` : '';
    const mainText = `${greetingText}Silakan tekan tombol di bawah untuk melihat pilihan layanan.`;

    await sendListMessage(
        sock,
        msg,
        'Layanan Publik',
        mainText,
        'Smart Public Service',
        'Pilih Layanan',
        sections
    );
};

const processWargaInput = async (sock, msg, selectedId, text, cmsData) => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return;

    // Ambil ID dari klik button atau ketikan manual
    const inputId = selectedId || text;
    const response = resolveSubMenuResponse(cmsData.subMenus, inputId);

    // Kalau input nggak ada di JSON subMenus
    if (!response) {
        await sock.sendMessage(jid, {
            text: 'Input tidak dikenali. Silakan ketik *halo* untuk kembali ke menu awal.',
        });
        return;
    }

    // Kalau responnya punya sub-menu lagi (List Button kedua)
    if (response.hasNestedMenu) {
        await sendListMessage(
            sock,
            msg,
            response.nestedTitle,
            response.text,
            'Smart Public Service',
            response.nestedButtonText,
            [{ title: response.nestedTitle, rows: response.nestedMenu }]
        );
    } else {
        // Kalau responnya cuma teks balasan akhir
        await sock.sendMessage(jid, { text: response.text });
    }
};

const handleWargaMessage = async (sock, msg, bodyText = '') => {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    // bodyText ini nangkep ID dari tombol yang diklik warga (cth: "menu_kependudukan")
    const text = (bodyText || '').trim();
    const normalizedText = text.toLowerCase();

    if (!text) return;

    const cmsData = await loadCmsData();
    const timeoutSeconds = Number(cmsData.timeoutSeconds) > 0 ? Number(cmsData.timeoutSeconds) : 30;
    const existingSession = sessions.get(jid);

    // Pancingan awal pakai "halo"
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

    // Cegah warga ngirim ID/pesan acak kalau belum ketik halo
    if (!existingSession) {
        await sock.sendMessage(jid, {
            text: 'Sesi belum dimulai. Ketik *halo* untuk memulai dan melihat daftar layanan.',
        });
        return;
    }

    // Lempar ID tombol yang diklik ke proses
    scheduleSessionTimeout(sock, jid, timeoutSeconds);
    await processWargaInput(sock, msg, text, text, cmsData);
    scheduleSessionTimeout(sock, jid, timeoutSeconds);
};

module.exports = {
    handleWargaMessage,
    sessions,
};