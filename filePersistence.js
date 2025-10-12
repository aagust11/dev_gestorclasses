const DB_NAME = 'gestorClassesPersistence';
const STORE_NAME = 'fileHandles';
const HANDLE_KEY = 'dataFile';
const DATA_FILE_NAME = 'gestor-classes-data.json';

const supportsFileSystemAccess = typeof window !== 'undefined'
    && ('showOpenFilePicker' in window || 'chooseFileSystemEntries' in window);

function getPywebviewBridge() {
    if (typeof window === 'undefined') {
        return null;
    }
    return window.pywebview?.api || null;
}

function isPywebviewContext() {
    if (typeof window === 'undefined') {
        return false;
    }
    if (window.pywebview?.api || window.pywebview) {
        return true;
    }
    const userAgent = window.navigator?.userAgent || '';
    return userAgent.toLowerCase().includes('pywebview');
}

function isPywebviewAvailable() {
    return Boolean(getPywebviewBridge());
}

function createPywebviewHandle(name = DATA_FILE_NAME) {
    return {
        name,
        kind: 'pywebview-data-file'
    };
}

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

export function isFilePersistenceSupported() {
    return supportsFileSystemAccess || isPywebviewContext();
}

export async function getSavedFileHandle() {
    if (isPywebviewAvailable()) {
        try {
            const bridge = getPywebviewBridge();
            const result = await bridge.get_saved_file_handle();
            if (!result || !result.configured) {
                return null;
            }
            return createPywebviewHandle(result.name || DATA_FILE_NAME);
        } catch (error) {
            console.error('Error retrieving saved file handle from Python bridge', error);
            return null;
        }
    }
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
    if (isPywebviewAvailable()) {
        const bridge = getPywebviewBridge();
        const result = await bridge.save_file_handle();
        if (!result?.success) {
            throw new Error(result?.error || 'Unable to save data file configuration');
        }
        return true;
    }
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
    if (isPywebviewAvailable()) {
        const bridge = getPywebviewBridge();
        const result = await bridge.clear_saved_file_handle();
        if (!result?.success) {
            throw new Error(result?.error || 'Unable to clear data file configuration');
        }
        return true;
    }
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
    if (isPywebviewAvailable()) {
        const bridge = getPywebviewBridge();
        const result = await bridge.request_existing_data_file();
        if (!result?.success) {
            throw new Error(result?.error || 'The data file does not exist');
        }
        return createPywebviewHandle(result.name || DATA_FILE_NAME);
    }
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
    if (isPywebviewAvailable()) {
        const bridge = getPywebviewBridge();
        const result = await bridge.request_new_data_file();
        if (!result?.success) {
            throw new Error(result?.error || 'Unable to create data file');
        }
        return createPywebviewHandle(result.name || DATA_FILE_NAME);
    }
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
    if (isPywebviewAvailable() || handle?.kind === 'pywebview-data-file') {
        return true;
    }
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
    if (isPywebviewAvailable() || handle?.kind === 'pywebview-data-file') {
        const bridge = getPywebviewBridge();
        const result = await bridge.read_data_file();
        if (!result?.success) {
            throw new Error(result?.error || 'Unable to read data file');
        }
        return result.data || '';
    }
    if (!handle) {
        throw new Error('No file handle provided');
    }
    const file = await handle.getFile();
    return await file.text();
}

export async function writeDataToFile(handle, data) {
    if (isPywebviewAvailable() || handle?.kind === 'pywebview-data-file') {
        const bridge = getPywebviewBridge();
        const result = await bridge.write_data_file(data);
        if (!result?.success) {
            throw new Error(result?.error || 'Unable to write data file');
        }
        return true;
    }
    if (!handle) {
        throw new Error('No file handle provided');
    }
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
}
