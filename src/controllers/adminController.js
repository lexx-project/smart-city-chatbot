const fs = require('fs/promises');
const path = require('path');
const { sendListMessage } = require('../utils/messageHelper');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const SUPERADMIN_JID = process.env.SUPERADMIN_JID || '6281234567890@s.whatsapp.net';

const loadCmsData = async () => {
    const raw = await fs.readFile(CMS_DATA_PATH, 'utf-8');
    return JSON.parse(raw);
};

const buildMainMenuSections = (mainMenu) => {
    const rows = (Array.isArray(mainMenu) ? mainMenu : []).map((item, index) => ({
        title: item.title || `Menu ${index + 1}`,
        description: item.description || '',
        id: item.id || `menu_${index + 1}`,
    }));

    return [{ title: 'Menu Layanan Publik', rows }];
};

const sendMainListMenu = async (sock, msg, cmsData) => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return;

    const sections = buildMainMenuSections(cmsData.mainMenu);
    if (!sections[0].rows.length) {
        await sock.sendMessage(jid, {
            text: 'Menu layanan belum dikonfigurasi. Silakan hubungi admin.',
        });
        return;
    }

    if (cmsData.greetingMessage) {
        await sock.sendMessage(jid, { text: cmsData.greetingMessage });
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

const handleAdminMessage = async (sock, msg, bodyText = '') => {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    if (jid !== SUPERADMIN_JID) return;

    const text = (bodyText || '').trim();
    if (text.toLowerCase() !== 'halo') return;

    const cmsData = await loadCmsData();
    await sendMainListMenu(sock, msg, cmsData);
};

module.exports = {
    handleAdminMessage,
    SUPERADMIN_JID,
};
