const CONFIG_STORAGE_KEY = 'gestorClassesDatabaseConfig';
const MODE_STORAGE_KEY = 'gestorClassesPersistenceMode';

function getStorage() {
    if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
    }
    if (typeof localStorage !== 'undefined') {
        return localStorage;
    }
    return null;
}

function safeParse(value) {
    if (!value) {
        return null;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        console.error('Error parsing stored database configuration', error);
        return null;
    }
}

function normalizeBaseUrl(url) {
    if (typeof url !== 'string') {
        return '';
    }
    return url.replace(/\/$/, '');
}

export function getStoredPersistenceMode() {
    const storage = getStorage();
    if (!storage) {
        return 'file';
    }
    const stored = storage.getItem(MODE_STORAGE_KEY);
    if (stored === 'database' || stored === 'file') {
        return stored;
    }
    return 'file';
}

export function savePersistenceMode(mode) {
    const storage = getStorage();
    if (!storage) {
        return;
    }
    if (mode === 'database' || mode === 'file') {
        storage.setItem(MODE_STORAGE_KEY, mode);
    } else {
        storage.removeItem(MODE_STORAGE_KEY);
    }
}

export function getStoredDatabaseConfig() {
    const storage = getStorage();
    if (!storage) {
        return null;
    }
    const stored = safeParse(storage.getItem(CONFIG_STORAGE_KEY));
    if (!stored || typeof stored !== 'object') {
        return null;
    }
    const baseUrl = normalizeBaseUrl(stored.baseUrl);
    const authToken = typeof stored.authToken === 'string' ? stored.authToken : '';
    if (!baseUrl) {
        return null;
    }
    return { baseUrl, authToken };
}

export function saveDatabaseConfig(config) {
    if (!config || typeof config !== 'object') {
        return;
    }
    const storage = getStorage();
    if (!storage) {
        throw new Error('Local storage is not available in this environment');
    }
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
        throw new Error('El camp de l\'URL de l\'API és obligatori');
    }
    const payload = {
        baseUrl,
        authToken: typeof config.authToken === 'string' ? config.authToken : ''
    };
    storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(payload));
    return payload;
}

export function clearDatabaseConfig() {
    const storage = getStorage();
    if (!storage) {
        return;
    }
    storage.removeItem(CONFIG_STORAGE_KEY);
}

function buildHeaders(config) {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (config.authToken) {
        headers['Authorization'] = `Bearer ${config.authToken}`;
    }
    return headers;
}

export async function fetchDataFromDatabase(config) {
    if (!config?.baseUrl) {
        throw new Error('No database configuration is available');
    }
    const endpoint = `${normalizeBaseUrl(config.baseUrl)}/data`;
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: buildHeaders(config),
        credentials: 'include'
    });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            const error = new Error('The data server denied the request');
            error.code = 'permission-denied';
            throw error;
        }
        throw new Error(`Error recuperant les dades: ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') {
        return {};
    }
    if (payload.data && typeof payload.data === 'object') {
        return payload.data;
    }
    return payload;
}

export async function saveDataToDatabase(config, data) {
    if (!config?.baseUrl) {
        throw new Error('No database configuration is available');
    }
    const endpoint = `${normalizeBaseUrl(config.baseUrl)}/data`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(config),
        credentials: 'include',
        body: JSON.stringify({ data })
    });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            const error = new Error('The data server denied the request');
            error.code = 'permission-denied';
            throw error;
        }
        throw new Error(`Error desant les dades: ${response.status}`);
    }
    return await response.json();
}

export async function testDatabaseConnection(config) {
    if (!config?.baseUrl) {
        throw new Error('No database configuration is available');
    }
    const endpoint = `${normalizeBaseUrl(config.baseUrl)}/status`;
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: buildHeaders(config),
        credentials: 'include'
    });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            const error = new Error('The data server denied the request');
            error.code = 'permission-denied';
            throw error;
        }
        throw new Error(`Error comprovant l'estat de la base de dades: ${response.status}`);
    }
    return await response.json();
}
