const fs = require('fs/promises');
const path = require('path');
const { SESSION_DIR, SUPERADMIN_JID, ADMIN_FLOW_TIMEOUT_MS } = require('../../settings');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const adminSessions = new Map();

const ADMIN_STATE = {
    IDLE: 'IDLE',
    SETTINGS_MENU: 'SETTINGS_MENU',
    WAITING_SESSION_END_TEXT: 'WAITING_SESSION_END_TEXT',
    WAITING_TIMEOUT_TEXT: 'WAITING_TIMEOUT_TEXT',
    WAITING_TIMEOUT_SECONDS: 'WAITING_TIMEOUT_SECONDS',
    WAITING_MENU_TOGGLE: 'WAITING_MENU_TOGGLE',
    WAITING_MENU_REORDER: 'WAITING_MENU_REORDER',
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

const listAdminJids = async () => {
    const cmsData = await loadCmsData();
    const dynamicAdmins = Array.isArray(cmsData.adminJids) ? cmsData.adminJids : [];
    return Array.from(new Set([SUPERADMIN_JID, ...dynamicAdmins]));
};

const displayAdminNumber = async (jid) => {
    const value = String(jid || '').trim();
    if (!value) return '';

    if (value.endsWith('@lid')) {
        const local = jidLocal(value);
        const mapped = await resolvePhoneFromLid(local);
        return mapped || local;
    }

    return jidLocal(value).replace(/\D/g, '');
};

const removeAdminJid = async (candidate) => {
    const cmsData = await loadCmsData();
    const current = Array.isArray(cmsData.adminJids) ? cmsData.adminJids : [];
    if (!current.length) return { removed: false, remaining: current };

    const raw = String(candidate || '').trim();
    const digits = raw.replace(/\D/g, '');
    const targets = new Set();

    if (raw.includes('@')) targets.add(raw);
    if (digits) {
        targets.add(`${digits}@s.whatsapp.net`);
        const lid = await resolveLidFromPhone(digits);
        if (lid) targets.add(`${lid}@lid`);
    }

    const next = current.filter((jid) => !targets.has(jid));
    const removed = next.length !== current.length;
    cmsData.adminJids = next;
    await saveCmsData(cmsData);
    return { removed, remaining: next };
};

const getMainMenu = (cmsData) => (Array.isArray(cmsData?.mainMenu) ? cmsData.mainMenu : []);

const sendSettingsMenu = async (sock, jid, cmsData) => {
    const globalTimeout = Number(cmsData?.timeoutSeconds) > 0 ? Number(cmsData.timeoutSeconds) : 30;
    const menuEnabledCount = getMainMenu(cmsData).filter((item) => item.enabled !== false).length;

    const text = [
        'Panel Pengaturan Admin',
        '',
        `1. Ubah Pesan Penutup (${cmsData?.sessionEndText ? 'aktif' : 'default'})`,
        `2. Ubah Pesan Timeout (${cmsData?.timeoutText ? 'aktif' : 'default'})`,
        `3. Ubah Timeout (${globalTimeout} detik)`,
        `4. Aktif/Nonaktifkan Menu (${menuEnabledCount}/${getMainMenu(cmsData).length} aktif)`,
        '5. Ubah Urutan Menu',
        '',
        'Balas angka 1-5. Ketik /batal untuk keluar.',
    ].join('\n');

    await sock.sendMessage(jid, { text });
    adminSessions.set(jid, { state: ADMIN_STATE.SETTINGS_MENU, timeoutId: null });
    scheduleAdminFlowTimeout(sock, jid);
};

const formatMainMenuStatus = (mainMenu) => {
    return mainMenu
        .map((item, index) => `${index + 1}. ${item.title} (${item.enabled === false ? 'nonaktif' : 'aktif'}) [${item.id}]`)
        .join('\n');
};

const handleSettingsState = async (sock, jid, text, session, cmsData) => {
    if (session.state === ADMIN_STATE.WAITING_SESSION_END_TEXT) {
        cmsData.sessionEndText = text;
        await saveCmsData(cmsData);
        clearAdminFlowTimer(jid);
        adminSessions.set(jid, { state: ADMIN_STATE.IDLE, timeoutId: null });
        await sock.sendMessage(jid, { text: 'Berhasil memperbarui pesan penutup.' });
        return true;
    }

    if (session.state === ADMIN_STATE.WAITING_TIMEOUT_TEXT) {
        cmsData.timeoutText = text;
        await saveCmsData(cmsData);
        clearAdminFlowTimer(jid);
        adminSessions.set(jid, { state: ADMIN_STATE.IDLE, timeoutId: null });
        await sock.sendMessage(jid, { text: 'Berhasil memperbarui pesan timeout.' });
        return true;
    }

    if (session.state === ADMIN_STATE.WAITING_TIMEOUT_SECONDS) {
        const seconds = Number(text);
        if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) {
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, { text: 'Nilai tidak valid. Masukkan angka 10-3600 detik.' });
            return true;
        }

        cmsData.timeoutSeconds = seconds;
        await saveCmsData(cmsData);
        clearAdminFlowTimer(jid);
        adminSessions.set(jid, { state: ADMIN_STATE.IDLE, timeoutId: null });
        await sock.sendMessage(jid, { text: `Berhasil. Timeout sesi warga diubah ke ${seconds} detik.` });
        return true;
    }

    if (session.state === ADMIN_STATE.WAITING_MENU_TOGGLE) {
        const match = text.trim().match(/^(\d+)\s+(\S+)$/);
        if (!match) {
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, { text: 'Format salah. Gunakan: <nomor_menu> <on/off>. Contoh: 2 off' });
            return true;
        }

        const index = Number(match[1]) - 1;
        const action = match[2].toLowerCase();
        const mainMenu = getMainMenu(cmsData);
        const target = mainMenu[index];
        if (!target) {
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, { text: 'Nomor menu tidak ditemukan.' });
            return true;
        }

        let enabled = null;
        if (['on', 'aktif', 'enable', '1'].includes(action)) enabled = true;
        if (['off', 'nonaktif', 'disable', '0'].includes(action)) enabled = false;
        if (enabled === null) {
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, { text: 'Aksi tidak valid. Gunakan on/off.' });
            return true;
        }

        target.enabled = enabled;
        cmsData.mainMenu = mainMenu;
        await saveCmsData(cmsData);
        clearAdminFlowTimer(jid);
        adminSessions.set(jid, { state: ADMIN_STATE.IDLE, timeoutId: null });
        await sock.sendMessage(jid, {
            text: `Berhasil. Menu "${target.title}" sekarang ${enabled ? 'aktif' : 'nonaktif'}.`,
        });
        return true;
    }

    if (session.state === ADMIN_STATE.WAITING_MENU_REORDER) {
        const mainMenu = getMainMenu(cmsData);
        const nums = text
            .split(/[,\s]+/)
            .map((item) => Number(item.trim()))
            .filter((item) => Number.isInteger(item));

        const isValidLength = nums.length === mainMenu.length;
        const allInRange = nums.every((num) => num >= 1 && num <= mainMenu.length);
        const unique = new Set(nums).size === nums.length;
        if (!isValidLength || !allInRange || !unique) {
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, {
                text: `Urutan tidak valid. Masukkan tepat ${mainMenu.length} angka unik. Contoh: 2,1,3`,
            });
            return true;
        }

        const reordered = nums.map((num) => mainMenu[num - 1]);
        cmsData.mainMenu = reordered;
        await saveCmsData(cmsData);
        clearAdminFlowTimer(jid);
        adminSessions.set(jid, { state: ADMIN_STATE.IDLE, timeoutId: null });
        await sock.sendMessage(jid, { text: 'Berhasil. Urutan menu utama telah diperbarui.' });
        return true;
    }

    return false;
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
        await sendSettingsMenu(sock, jid, cmsData);
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
            await sock.sendMessage(jid, { text: 'Format salah. Gunakan: /addadmin 628xxxxxxxxxx' });
            return true;
        }

        const admins = await addAdminJid(targetJid);
        await sock.sendMessage(jid, {
            text: `Berhasil menambahkan admin: ${targetJid}\nTotal admin dinamis: ${admins.length}`,
        });
        return true;
    }

    if (normalized === '/listadmin') {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: 'Akses ditolak. Hanya admin yang bisa menggunakan /listadmin.' });
            return true;
        }

        const admins = await listAdminJids();
        const lines = [];
        for (let index = 0; index < admins.length; index += 1) {
            const numberOnly = await displayAdminNumber(admins[index]);
            lines.push(`${index + 1}. ${numberOnly || '-'}`);
        }
        await sock.sendMessage(jid, { text: `Daftar admin saat ini:\n\n${lines.join('\n')}` });
        return true;
    }

    if (normalized.startsWith('/deladmin')) {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: 'Akses ditolak. Hanya admin yang bisa menggunakan /deladmin.' });
            return true;
        }

        const candidate = text.split(/\s+/)[1] || '';
        if (!candidate) {
            await sock.sendMessage(jid, { text: 'Format salah. Gunakan: /deladmin 628xxxxxxxxxx' });
            return true;
        }

        const targetJid = normalizeToJid(candidate);
        if (targetJid === SUPERADMIN_JID) {
            await sock.sendMessage(jid, { text: 'Superadmin utama tidak bisa dihapus.' });
            return true;
        }

        const result = await removeAdminJid(candidate);
        if (!result.removed) {
            await sock.sendMessage(jid, { text: 'Nomor admin tidak ditemukan di daftar admin dinamis.' });
            return true;
        }

        await sock.sendMessage(jid, { text: `Berhasil menghapus admin: ${candidate}` });
        return true;
    }

    if (normalized === '/menuadmin') {
        if (!isAdmin) {
            await sock.sendMessage(jid, { text: 'Akses ditolak. Hanya admin yang bisa menggunakan /menuadmin.' });
            return true;
        }

        await sock.sendMessage(jid, {
            text: [
                'Daftar command admin:',
                '',
                '1. /menuadmin',
                '2. /setting',
                '3. /addadmin',
                '4. /listadmin',
                '5. /deladmin',
                '6. /batal',
            ].join('\n'),
        });
        return true;
    }

    if (!isAdmin) return false;

    const handledState = await handleSettingsState(sock, jid, text, session, cmsData);
    if (handledState) return true;

    if (session.state === ADMIN_STATE.SETTINGS_MENU) {
        if (text === '1') {
            adminSessions.set(jid, { state: ADMIN_STATE.WAITING_SESSION_END_TEXT, timeoutId: session.timeoutId || null });
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, { text: 'Kirim teks baru untuk pesan penutup sesi warga.' });
            return true;
        }

        if (text === '2') {
            adminSessions.set(jid, { state: ADMIN_STATE.WAITING_TIMEOUT_TEXT, timeoutId: session.timeoutId || null });
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, { text: 'Kirim teks baru untuk pesan timeout sesi warga.' });
            return true;
        }

        if (text === '3') {
            adminSessions.set(jid, { state: ADMIN_STATE.WAITING_TIMEOUT_SECONDS, timeoutId: session.timeoutId || null });
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, { text: 'Masukkan timeout sesi warga (detik), rentang 10-3600.' });
            return true;
        }

        if (text === '4') {
            const mainMenu = getMainMenu(cmsData);
            adminSessions.set(jid, { state: ADMIN_STATE.WAITING_MENU_TOGGLE, timeoutId: session.timeoutId || null });
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, {
                text: [
                    'Aktif/nonaktifkan menu utama.',
                    '',
                    formatMainMenuStatus(mainMenu),
                    '',
                    'Format balasan: <nomor_menu> <on/off>. Contoh: 2 off',
                ].join('\n'),
            });
            return true;
        }

        if (text === '5') {
            const mainMenu = getMainMenu(cmsData);
            adminSessions.set(jid, { state: ADMIN_STATE.WAITING_MENU_REORDER, timeoutId: session.timeoutId || null });
            scheduleAdminFlowTimeout(sock, jid);
            await sock.sendMessage(jid, {
                text: [
                    'Ubah urutan menu utama.',
                    '',
                    formatMainMenuStatus(mainMenu),
                    '',
                    `Masukkan urutan baru (${mainMenu.length} angka) dipisah koma. Contoh: 2,1,3`,
                ].join('\n'),
            });
            return true;
        }

        scheduleAdminFlowTimeout(sock, jid);
        await sock.sendMessage(jid, { text: 'Pilihan tidak valid. Balas angka 1-5.' });
        return true;
    }

    return false;
};

module.exports = {
    handleAdminMessage,
    SUPERADMIN_JID,
};
