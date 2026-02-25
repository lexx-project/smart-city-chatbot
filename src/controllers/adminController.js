const fs = require('fs/promises');
const path = require('path');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const SESSION_DIR = path.join(__dirname, '../../session');
const SUPERADMIN_JID = process.env.SUPERADMIN_JID || '62882009391607@s.whatsapp.net';
const adminSessions = new Map();
const ADMIN_FLOW_TIMEOUT_MS = 60 * 1000;

const ADMIN_STATE = {
    IDLE: 'IDLE',
    SETTINGS_MENU: 'SETTINGS_MENU',
    WAITING_GREETING: 'WAITING_GREETING',
};

const normalizeToJid = (value = '') => {
    const digits = String(value).replace(/\D/g, '');
    if (!digits) return '';
    return `${digits}@s.whatsapp.net`;
};

const jidLocal = (jid = '') => String(jid).split('@')[0] || '';

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

const resolveLidFromPhone = async (phoneDigits) => {
    const directPath = path.join(SESSION_DIR, `lid-mapping-${phoneDigits}.json`);
    const mapped = await readJsonStringFile(directPath);
    return String(mapped || '').replace(/\D/g, '');
};

const buildActorTokens = async (jid) => {
    const tokens = new Set();
    if (!jid) return tokens;

    const local = jidLocal(jid);
    if (local) tokens.add(local);
    tokens.add(jid);

    if (jid.endsWith('@lid')) {
        const phone = await resolvePhoneFromLid(local);
        if (phone) {
            tokens.add(phone);
            tokens.add(`${phone}@s.whatsapp.net`);
        }
    } else if (jid.endsWith('@s.whatsapp.net')) {
        const lid = await resolveLidFromPhone(local);
        if (lid) {
            tokens.add(lid);
            tokens.add(`${lid}@lid`);
        }
    }

    return tokens;
};

const loadCmsData = async () => {
    const raw = await fs.readFile(CMS_DATA_PATH, 'utf-8');
    return JSON.parse(raw);
};

const saveCmsData = async (data) => {
    await fs.writeFile(CMS_DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
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

const clearAdminFlowTimer = (jid) => {
    const session = adminSessions.get(jid);
    if (!session?.timeoutId) return;
    clearTimeout(session.timeoutId);
};

const scheduleAdminFlowTimeout = (sock, jid) => {
    clearAdminFlowTimer(jid);

    const timeoutId = setTimeout(async () => {
        try {
            adminSessions.set(jid, { state: ADMIN_STATE.IDLE, timeoutId: null });
            await sock.sendMessage(jid, {
                text: 'Timeout 60 detik. Proses /setting dibatalkan otomatis.',
            });
        } catch (error) {
            console.error('[ADMIN_TIMEOUT_ERROR]', error);
        }
    }, ADMIN_FLOW_TIMEOUT_MS);

    const current = adminSessions.get(jid) || { state: ADMIN_STATE.IDLE };
    current.timeoutId = timeoutId;
    adminSessions.set(jid, current);
};

const sendSettingsMenu = async (sock, jid) => {
    await sendTextMenu(sock, jid, 'Panel Pengaturan Admin', [
        { title: 'Ubah Pesan Awal Warga', description: 'Edit greeting message saat user pertama chat' },
        { title: 'Lihat Pesan Awal Saat Ini', description: 'Tampilkan nilai greeting message aktif' },
    ]);
    adminSessions.set(jid, { state: ADMIN_STATE.SETTINGS_MENU, timeoutId: null });
    scheduleAdminFlowTimeout(sock, jid);
};

const isAdminJid = async (jid, cmsData) => {
    if (!jid) return false;
    const configuredAdmins = Array.isArray(cmsData?.adminJids) ? cmsData.adminJids : [];
    const allowed = [SUPERADMIN_JID, ...configuredAdmins].filter(Boolean);
    const actorTokens = await buildActorTokens(jid);

    for (const candidate of allowed) {
        const candidateJid = String(candidate).trim();
        if (!candidateJid) continue;
        const candidateLocal = jidLocal(candidateJid);

        if (actorTokens.has(candidateJid) || actorTokens.has(candidateLocal)) return true;
    }

    return false;
};

const addAdminJid = async (targetJid) => {
    const cmsData = await loadCmsData();
    const current = Array.isArray(cmsData.adminJids) ? cmsData.adminJids : [];
    if (!current.includes(targetJid)) current.push(targetJid);

    const phoneDigits = jidLocal(targetJid);
    const lid = await resolveLidFromPhone(phoneDigits);
    if (lid) {
        const lidJid = `${lid}@lid`;
        if (!current.includes(lidJid)) current.push(lidJid);
    }

    cmsData.adminJids = current;
    await saveCmsData(cmsData);
    return cmsData.adminJids;
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
    if (!jid) return false;

    const text = (bodyText || '').trim();
    if (!text) return false;
    const normalized = text.toLowerCase();
    const cmsData = await loadCmsData();
    const isAdmin = await isAdminJid(jid, cmsData);
    const session = adminSessions.get(jid) || { state: ADMIN_STATE.IDLE };

    if (normalized === '/batal') {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: 'Akses ditolak. Hanya admin yang bisa menggunakan command ini.' });
            return true;
        }
        clearAdminFlowTimer(jid);
        adminSessions.set(jid, { state: ADMIN_STATE.IDLE, timeoutId: null });
        await sock.sendMessage(jid, { text: 'Proses admin dibatalkan.' });
        return true;
    }

    if (normalized === '/setting') {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: 'Akses ditolak. Hanya admin yang bisa mengakses /setting.' });
            return true;
        }
        await sendSettingsMenu(sock, jid);
        return true;
    }

    if (normalized.startsWith('/addadmin')) {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: 'Akses ditolak. Hanya admin yang bisa menggunakan /addadmin.' });
            return true;
        }

        const candidate = text.split(/\s+/)[1] || '';
        const targetJid = normalizeToJid(candidate);

        if (!targetJid) {
            await sock.sendMessage(jid, {
                text: 'Format salah. Gunakan: /addadmin 628xxxxxxxxxx',
            });
            return true;
        }

        const admins = await addAdminJid(targetJid);
        await sock.sendMessage(jid, {
            text: `Berhasil menambahkan admin: ${targetJid}\nTotal admin dinamis: ${admins.length}`,
        });
        return true;
    }

    if (session.state === ADMIN_STATE.WAITING_GREETING) {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: 'Akses ditolak. Hanya admin yang bisa mengubah pengaturan.' });
            return true;
        }
        const cmsData = await loadCmsData();
        cmsData.greetingMessage = text;
        await saveCmsData(cmsData);
        clearAdminFlowTimer(jid);
        adminSessions.set(jid, { state: ADMIN_STATE.IDLE, timeoutId: null });
        await sock.sendMessage(jid, {
            text: `Berhasil. Pesan awal warga diperbarui menjadi:\n\n${cmsData.greetingMessage}`,
        });
        return true;
    }

    if (session.state === ADMIN_STATE.SETTINGS_MENU) {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: 'Akses ditolak. Hanya admin yang bisa mengubah pengaturan.' });
            return true;
        }
        if (text === '1') {
            adminSessions.set(jid, { state: ADMIN_STATE.WAITING_GREETING, timeoutId: session.timeoutId || null });
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, {
                text: 'Kirim teks pesan awal baru untuk warga. Ketik */batal* jika ingin membatalkan.',
            });
            return true;
        }

        if (text === '2') {
            const cmsData = await loadCmsData();
            await sock.sendMessage(jid, {
                text: `Pesan awal saat ini:\n\n${cmsData.greetingMessage || '(kosong)'}`,
            });
            clearAdminFlowTimer(jid);
            adminSessions.set(jid, { state: ADMIN_STATE.IDLE, timeoutId: null });
            return true;
        }

        scheduleAdminFlowTimeout(sock, jid);
        await sock.sendMessage(jid, {
            text: 'Pilihan tidak valid. Balas *1* atau *2*.',
        });
        return true;
    }

    // Admin tetap mengikuti alur warga untuk chat normal.
    // Controller admin hanya meng-handle command khusus admin.
    if (!isAdmin) return false;
    return false;
};

module.exports = {
    handleAdminMessage,
    SUPERADMIN_JID,
};
