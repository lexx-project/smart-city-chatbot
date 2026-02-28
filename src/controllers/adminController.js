const { isAdminJid, listAdminJids } = require('../services/adminService');
const { displayAdminNumber } = require('../services/lidService');

const handleAdminMessage = async (sock, msg, bodyText = '') => {
    const jid = msg?.key?.remoteJid;
    if (!jid) return false;

    const text = String(bodyText || '').trim();
    if (!text) return false;

    if (text.toLowerCase() !== '/listadmin') return false;

    const isAdmin = await isAdminJid(jid);
    if (!isAdmin) {
        await sock.sendMessage(jid, { text: 'Akses ditolak. Hanya admin yang bisa menggunakan /listadmin.' });
        return true;
    }

    const admins = await listAdminJids();
    if (!admins.length) {
        await sock.sendMessage(jid, { text: 'Daftar admin kosong.' });
        return true;
    }

    const lines = [];
    for (let index = 0; index < admins.length; index += 1) {
        const numberOnly = await displayAdminNumber(admins[index]);
        lines.push(`${index + 1}. ${numberOnly || admins[index]}`);
    }

    await sock.sendMessage(jid, { text: `Daftar admin saat ini:\n\n${lines.join('\n')}` });
    return true;
};

module.exports = {
    handleAdminMessage,
};
