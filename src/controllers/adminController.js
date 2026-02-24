const fs = require('fs/promises');
const path = require('path');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const SUPERADMIN_JID = process.env.SUPERADMIN_JID || '6281234567890@s.whatsapp.net';

const loadCmsData = async () => {
    const raw = await fs.readFile(CMS_DATA_PATH, 'utf-8');
    return JSON.parse(raw);
};

const sendTextMenu = async (sock, jid, textBlock, menuArray) => {
    let message = `${textBlock}\n\n`;
    (Array.isArray(menuArray) ? menuArray : []).forEach((item, index) => {
        const num = index + 1;
        const title = item?.title || `Menu ${num}`;
        const desc = item?.description ? ` - ${item.description}` : '';
        message += `*${num}.* ${title}${desc}\n`;
    });
    message += '\n👉 Balas dengan angka atau ketik *halo* untuk tampilkan menu lagi.';
    await sock.sendMessage(jid, { text: message });
};

const sendMainTextMenu = async (sock, msg, cmsData) => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return;

    const mainMenu = Array.isArray(cmsData.mainMenu) ? cmsData.mainMenu : [];
    if (!mainMenu.length) {
        await sock.sendMessage(jid, {
            text: 'Menu layanan belum dikonfigurasi. Silakan hubungi admin.',
        });
        return;
    }

    const greeting = cmsData.greetingMessage ? `${cmsData.greetingMessage}\n\n` : '';
    await sendTextMenu(sock, jid, `${greeting}Daftar layanan saat ini:`, mainMenu);
};

const handleAdminMessage = async (sock, msg, bodyText = '') => {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    if (jid !== SUPERADMIN_JID) return;

    const text = (bodyText || '').trim();
    if (text.toLowerCase() !== 'halo') return;

    const cmsData = await loadCmsData();
    await sendMainTextMenu(sock, msg, cmsData);
};

module.exports = {
    handleAdminMessage,
    SUPERADMIN_JID,
};
