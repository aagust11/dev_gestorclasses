const DB_NAME = 'gestorClassesPersistence';
const STORE_NAME = 'fileHandles';
const HANDLE_KEY = 'dataFile';

const DEFAULT_DATA_FILE_NAME = 'gestor-classes-data.jspn';
const isPywebview = typeof window !== 'undefined'
    && typeof window.pywebview === 'object'
    && typeof window.pywebview.api === 'object';

function buildPywebviewHandle(info = {}) {
    return {
        id: 'pywebview-data-file',
        name: info.name || DEFAULT_DATA_FILE_NAME,
        kind: 'pywebview',
        __pywebview: true,
    };
}

const supportsFileSystemAccess = isPywebview || (typeof window !== 'undefined'
    && ('showOpenFilePicker' in window || 'chooseFileSystemEntries' in window));

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
    if (isPywebview) {
        try {
            if (typeof window.pywebview.api.ensure_data_file === 'function') {
                const info = await window.pywebview.api.ensure_data_file();
                return buildPywebviewHandle(info || {});
            }
        } catch (error) {
            console.error('Error retrieving pywebview data file info', error);
        }
        return buildPywebviewHandle();
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
    if (handle?.__pywebview) {
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
    if (isPywebview) {
        try {
            if (typeof window.pywebview.api.reset_data_file === 'function') {
                await window.pywebview.api.reset_data_file();
            }
        } catch (error) {
            console.error('Error resetting pywebview data file', error);
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
    if (isPywebview) {
        try {
            if (typeof window.pywebview.api.ensure_data_file === 'function') {
                const info = await window.pywebview.api.ensure_data_file();
                return buildPywebviewHandle(info || {});
            }
        } catch (error) {
            console.error('Error ensuring pywebview data file', error);
            throw error;
        }
        return buildPywebviewHandle();
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

export async function requestNewDataFile(suggestedName = DEFAULT_DATA_FILE_NAME) {
    if (isPywebview) {
        try {
            if (typeof window.pywebview.api.ensure_data_file === 'function') {
                const info = await window.pywebview.api.ensure_data_file();
                return buildPywebviewHandle(info || {});
            }
        } catch (error) {
            console.error('Error creating pywebview data file', error);
            throw error;
        }
        return buildPywebviewHandle();
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
    if (handle?.__pywebview) {
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
    if (handle?.__pywebview) {
        if (typeof window.pywebview?.api?.read_data_file === 'function') {
            return await window.pywebview.api.read_data_file();
        }
        return '';
    }
    if (!handle) {
        throw new Error('No file handle provided');
    }
    const file = await handle.getFile();
    return await file.text();
}

export async function writeDataToFile(handle, data) {
    if (handle?.__pywebview) {
        if (typeof window.pywebview?.api?.write_data_file !== 'function') {
            throw new Error('pywebview data bridge not available');
        }
        await window.pywebview.api.write_data_file(String(data ?? ''));
        return;
    }
    if (!handle) {
        throw new Error('No file handle provided');
    }
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
}
