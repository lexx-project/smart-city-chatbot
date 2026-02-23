const fs = require('fs/promises');
const path = require('path');
const { sendListMessage, extractMessageText, extractSelectedId } = require('../utils/messageHelper');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const SUPERADMIN_JID = process.env.SUPERADMIN_JID || '6281234567890@s.whatsapp.net';

const adminSessions = new Map();

const ADMIN_MENU = {
    UPDATE_GREETING: 'admin:update_greeting',
    UPDATE_MAIN_MENU: 'admin:update_main_menu',
    UPDATE_SUBMENU: 'admin:update_submenu',
    UPDATE_TIMEOUT: 'admin:update_timeout',
};

const loadCmsData = async () => {
    const raw = await fs.readFile(CMS_DATA_PATH, 'utf-8');
    return JSON.parse(raw);
};

const saveCmsData = async (nextData) => {
    await fs.writeFile(CMS_DATA_PATH, JSON.stringify(nextData, null, 2), 'utf-8');
};

const sendAdminMenu = async (sock, jid) => {
    const sections = [
        {
            title: 'Pengaturan CMS',
            rows: [
                { header: 'Sapaan', title: 'Ubah Sapaan Awal', description: 'Ganti pesan sapaan pertama ke warga', id: ADMIN_MENU.UPDATE_GREETING },
                { header: 'Menu', title: 'Ubah List Menu Utama', description: 'Perbarui daftar menu utama', id: ADMIN_MENU.UPDATE_MAIN_MENU },
                { header: 'Sub-Menu', title: 'Ubah Respon Sub-Menu', description: 'Perbarui respon per sub-menu', id: ADMIN_MENU.UPDATE_SUBMENU },
                { header: 'Timeout', title: 'Ubah Waktu Timeout (Detik)', description: 'Atur batas waktu sesi warga', id: ADMIN_MENU.UPDATE_TIMEOUT },
            ],
        },
    ];

    await sendListMessage(
        sock,
        jid,
        'CMS Superadmin',
        'Pilih pengaturan yang ingin diubah:',
        'Smart Public Service',
        'Pilih Menu',
        sections
    );
};

const handleTimeoutInput = async (sock, jid, text) => {
    const asNumber = Number(text);

    if (!Number.isInteger(asNumber) || asNumber <= 0 || asNumber > 3600) {
        await sock.sendMessage(jid, {
            text: 'Input tidak valid. Masukkan angka detik 1 sampai 3600.',
        });
        return;
    }

    const cmsData = await loadCmsData();
    cmsData.timeoutSeconds = asNumber;
    await saveCmsData(cmsData);

    adminSessions.delete(jid);

    await sock.sendMessage(jid, {
        text: `Berhasil. Timeout sesi warga diperbarui menjadi ${asNumber} detik.`,
    });
};

const handleAdminMessage = async (sock, msg) => {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    if (jid !== SUPERADMIN_JID) return;

    const message = msg.message || {};
    const text = extractMessageText(message);
    const selectedId = extractSelectedId(message);
    const adminState = adminSessions.get(jid);

    if (text === '!admin') {
        adminSessions.delete(jid);
        await sendAdminMenu(sock, jid);
        return;
    }

    if (adminState?.state === 'awaiting_timeout_seconds') {
        await handleTimeoutInput(sock, jid, text);
        return;
    }

    if (!selectedId) return;

    switch (selectedId) {
        case ADMIN_MENU.UPDATE_TIMEOUT:
            adminSessions.set(jid, { state: 'awaiting_timeout_seconds' });
            await sock.sendMessage(jid, {
                text: 'Masukkan timeout baru dalam detik (contoh: 30).',
            });
            break;
        case ADMIN_MENU.UPDATE_GREETING:
            await sock.sendMessage(jid, {
                text: 'Fitur Ubah Sapaan Awal siap diiterasi pada sprint berikutnya.',
            });
            break;
        case ADMIN_MENU.UPDATE_MAIN_MENU:
            await sock.sendMessage(jid, {
                text: 'Fitur Ubah List Menu Utama siap diiterasi pada sprint berikutnya.',
            });
            break;
        case ADMIN_MENU.UPDATE_SUBMENU:
            await sock.sendMessage(jid, {
                text: 'Fitur Ubah Respon Sub-Menu siap diiterasi pada sprint berikutnya.',
            });
            break;
        default:
            break;
    }
};

module.exports = {
    handleAdminMessage,
    SUPERADMIN_JID,
};
