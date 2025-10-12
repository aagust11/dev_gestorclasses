const DB_NAME = 'gestorClassesPersistence';
const STORE_NAME = 'fileHandles';
const HANDLE_KEY = 'dataFile';

const supportsFileSystemAccess = typeof window !== 'undefined'
    && ('showOpenFilePicker' in window || 'chooseFileSystemEntries' in window);

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export const isFilePersistenceSupported = supportsFileSystemAccess;

export async function getSavedFileHandle() {
    if (!supportsFileSystemAccess) {
        return null;
    }
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(HANDLE_KEY);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Error retrieving saved file handle', error);
        return null;
    }
}

export async function saveFileHandle(handle) {
    if (!supportsFileSystemAccess) {
        return false;
    }
    const db = await openDb();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(handle, HANDLE_KEY);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

export async function clearSavedFileHandle() {
    if (!supportsFileSystemAccess) {
        return false;
    }
    const db = await openDb();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(HANDLE_KEY);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

export async function requestExistingDataFile() {
    if (!supportsFileSystemAccess || !window.showOpenFilePicker) {
        throw new Error('File System Access API not available');
    }
    const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
            {
                description: 'JSON files',
                accept: { 'application/json': ['.json'] }
            }
        ]
    });
    return handle;
}

export async function requestNewDataFile(suggestedName = 'gestor-classes-dades.json') {
    if (!supportsFileSystemAccess || !window.showSaveFilePicker) {
        throw new Error('File System Access API not available');
    }
    const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
            {
                description: 'JSON files',
                accept: { 'application/json': ['.json'] }
            }
        ]
    });
    return handle;
}

export async function ensureFilePermission(handle) {
    if (!handle) return false;
    if (typeof handle.queryPermission === 'function' && typeof handle.requestPermission === 'function') {
        let permission = await handle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
            return true;
        }
        if (permission === 'denied') {
            return false;
        }
        permission = await handle.requestPermission({ mode: 'readwrite' });
        return permission === 'granted';
    }
    return true;
}

export async function readDataFromFile(handle) {
    if (!handle) {
        throw new Error('No file handle provided');
    }
    const file = await handle.getFile();
    return await file.text();
}

export async function writeDataToFile(handle, data) {
    if (!handle) {
        throw new Error('No file handle provided');
    }
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
}
