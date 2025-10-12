import {
    readDocument,
    writeDocument,
    subscribeToDocument
} from './firebaseClient.js';

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

function normalizeDocumentPath(path) {
    if (typeof path !== 'string') {
        return '';
    }
    const trimmed = path.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed) {
        return '';
    }
    const segments = trimmed.split('/').filter(Boolean);
    if (segments.length % 2 !== 0) {
        throw new Error('El camí del document de Firestore ha de contenir un nombre parell de segments.');
    }
    return segments.join('/');
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
    try {
        const documentPath = normalizeDocumentPath(stored.documentPath);
        if (!documentPath) {
            return null;
        }
        const userUid = typeof stored.userUid === 'string' ? stored.userUid : '';
        const realtime = stored.realtime !== false;
        return { documentPath, userUid, realtime };
    } catch (error) {
        console.error('Invalid database configuration found in storage', error);
        return null;
    }
}

export function saveDatabaseConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('No database configuration provided');
    }
    const storage = getStorage();
    if (!storage) {
        throw new Error('Local storage is not available in this environment');
    }
    const documentPath = normalizeDocumentPath(config.documentPath);
    if (!documentPath) {
        throw new Error('El camí del document de Firestore és obligatori');
    }
    const payload = {
        documentPath,
        userUid: typeof config.userUid === 'string' ? config.userUid : '',
        realtime: config.realtime !== false
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

function mapFirebaseError(error, defaultMessage) {
    if (error && typeof error === 'object') {
        const code = error.code || error.errorCode;
        if (code === 'permission-denied' || code === 'auth/permission-denied') {
            const mapped = new Error('The data server denied the request');
            mapped.code = 'permission-denied';
            return mapped;
        }
    }
    return new Error(defaultMessage || 'Unexpected Firebase error');
}

export async function fetchDataFromDatabase(config) {
    if (!config?.documentPath) {
        throw new Error('No database configuration is available');
    }
    try {
        const data = await readDocument(config.documentPath);
        if (!data || typeof data !== 'object') {
            return {};
        }
        return data;
    } catch (error) {
        console.error('Error fetching Firestore document', error);
        throw mapFirebaseError(error, 'Error recuperant les dades de Firebase');
    }
}

export async function saveDataToDatabase(config, data) {
    if (!config?.documentPath) {
        throw new Error('No database configuration is available');
    }
    try {
        await writeDocument(config.documentPath, data);
        return { ok: true };
    } catch (error) {
        console.error('Error saving Firestore document', error);
        throw mapFirebaseError(error, 'Error desant les dades a Firebase');
    }
}

export async function testDatabaseConnection(config) {
    if (!config?.documentPath) {
        throw new Error('No database configuration is available');
    }
    try {
        const data = await readDocument(config.documentPath);
        return { ok: true, exists: Boolean(data && typeof data === 'object') };
    } catch (error) {
        console.error('Error testing Firestore document access', error);
        throw mapFirebaseError(error, 'Error comprovant l\'accés a Firebase');
    }
}

export function subscribeToDatabaseDocument(config, onData, onError) {
    if (!config?.documentPath) {
        throw new Error('No database configuration is available');
    }
    return subscribeToDocument(config.documentPath, onData, onError);
}
