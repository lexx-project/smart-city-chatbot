const fs = require('fs/promises');
const path = require('path');
const { DEFAULT_WARGA_TIMEOUT_SECONDS } = require('../../settings');

const CMS_DATA_PATH = path.join(__dirname, '../config/cms-data.json');
const DEFAULT_TIMEOUT_TEXT = 'Terima kasih telah menghubungi kami. Sesi Anda telah berakhir karena tidak ada aktivitas. Silakan kirim pesan lagi untuk memulai sesi baru.';
const DEFAULT_SESSION_END_TEXT = 'Terima kasih sudah menggunakan layanan Smart Public Service. Sampai jumpa.';
const DEFAULT_LONG_INPUT_TIMEOUT_SECONDS = 180;
const DEFAULT_LONG_INPUT_MENU_IDS = ['menu_pengaduan'];

const loadCmsData = async () => {
    const raw = await fs.readFile(CMS_DATA_PATH, 'utf-8');
    return JSON.parse(raw);
};

const saveCmsData = async (data) => {
    await fs.writeFile(CMS_DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
};

const getMainMenu = (cmsData) => (Array.isArray(cmsData?.mainMenu) ? cmsData.mainMenu : []);

const getEnabledMainMenu = (cmsData) => getMainMenu(cmsData).filter((item) => item?.enabled !== false);

const getTimeoutSeconds = (cmsData) => {
    const value = Number(cmsData?.timeoutSeconds);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_WARGA_TIMEOUT_SECONDS;
};

const getTimeoutText = (cmsData) => cmsData?.timeoutText || DEFAULT_TIMEOUT_TEXT;

const getSessionEndText = (cmsData) => cmsData?.sessionEndText || DEFAULT_SESSION_END_TEXT;
const getLongInputTimeoutSeconds = (cmsData) => {
    const value = Number(cmsData?.longInputTimeoutSeconds);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_LONG_INPUT_TIMEOUT_SECONDS;
};
const getLongInputMenuIds = (cmsData) => {
    if (Array.isArray(cmsData?.longInputMenuIds) && cmsData.longInputMenuIds.length > 0) {
        return cmsData.longInputMenuIds;
    }
    return DEFAULT_LONG_INPUT_MENU_IDS;
};

module.exports = {
    loadCmsData,
    saveCmsData,
    getMainMenu,
    getEnabledMainMenu,
    getTimeoutSeconds,
    getTimeoutText,
    getSessionEndText,
    getLongInputTimeoutSeconds,
    getLongInputMenuIds,
};
