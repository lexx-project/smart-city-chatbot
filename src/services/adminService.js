const nestClient = require('../api/nestClient');

const extractPhoneDigits = (value = '') => String(value).split('@')[0].replace(/\D/g, '');

const pickAdminList = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    const candidates = [payload.admins, payload.items, payload.results, payload.data];
    for (const item of candidates) {
        if (Array.isArray(item)) return item;
    }

    return [];
};

const toAdminValue = (entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return String(entry).trim();
    if (!entry || typeof entry !== 'object') return '';

    const value =
        entry.jid ||
        entry.phone ||
        entry.phoneNumber ||
        entry.msisdn ||
        entry.number ||
        entry.whatsapp ||
        entry.whatsappNumber ||
        '';

    return String(value).trim();
};

const listAdminJids = async () => {
    try {
        const response = await nestClient.get('/bot-admins');
        const list = pickAdminList(response?.data)
            .map(toAdminValue)
            .filter(Boolean);

        return Array.from(new Set(list));
    } catch (error) {
        console.error('[ADMIN_LIST_API_ERROR]', error?.message || error);
        return [];
    }
};

const isAdminJid = async (jid) => {
    const senderDigits = extractPhoneDigits(jid);
    if (!senderDigits) return false;

    const admins = await listAdminJids();
    return admins.some((admin) => extractPhoneDigits(admin) === senderDigits);
};

const getAdminSettings = async () => {
    try {
        const response = await nestClient.get('/bot-settings');
        const payload = response?.data;

        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
                return payload.data;
            }
            return payload;
        }

        return {};
    } catch (error) {
        console.error('[ADMIN_SETTINGS_API_ERROR]', error?.message || error);
        return {};
    }
};

module.exports = {
    isAdminJid,
    getAdminSettings,
    listAdminJids,
};
