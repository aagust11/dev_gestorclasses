import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut,
    setPersistence,
    browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let firebaseApp = null;
let firebaseAuth = null;
let firestoreDb = null;
let initPromise = null;
let authReadyResolve;
let authReadyReject;
let authReadyResolved = false;
let currentUser = null;
const authListeners = new Set();

const authReadyPromise = new Promise((resolve, reject) => {
    authReadyResolve = resolve;
    authReadyReject = reject;
});

authReadyPromise.catch(() => {
    // Prevent unhandled rejection warnings in environments where the
    // consumer does not attach a catch handler.
});

function getFirebaseConfig() {
    if (typeof window === 'undefined') {
        return null;
    }
    const config = window.__GESTOR_CLASSES_FIREBASE_CONFIG__;
    if (!config || typeof config !== 'object') {
        console.warn('[firebase] Missing window.__GESTOR_CLASSES_FIREBASE_CONFIG__ configuration. Firebase features are disabled.');
        return null;
    }
    const requiredKeys = ['apiKey', 'authDomain', 'projectId'];
    const hasAllKeys = requiredKeys.every(key => typeof config[key] === 'string' && config[key].length > 0);
    if (!hasAllKeys) {
        console.warn('[firebase] Invalid Firebase configuration. Expected apiKey, authDomain and projectId. Firebase features are disabled.');
        return null;
    }
    return config;
}

function ensureInitPromise() {
    if (initPromise) {
        return initPromise;
    }
    const config = getFirebaseConfig();
    if (!config) {
        initPromise = Promise.resolve(null);
        authReadyResolve?.(null);
        authReadyResolved = true;
        return initPromise;
    }

    initPromise = (async () => {
        try {
            firebaseApp = initializeApp(config);
            firebaseAuth = getAuth(firebaseApp);
            await setPersistence(firebaseAuth, browserLocalPersistence);
            firestoreDb = getFirestore(firebaseApp);

            onAuthStateChanged(firebaseAuth, user => {
                currentUser = user || null;
                if (!authReadyResolved) {
                    authReadyResolve?.(currentUser);
                    authReadyResolved = true;
                }
                authListeners.forEach(listener => {
                    try {
                        listener(currentUser);
                    } catch (error) {
                        console.error('[firebase] Error in auth state listener', error);
                    }
                });
            });

            return { app: firebaseApp, auth: firebaseAuth, db: firestoreDb };
        } catch (error) {
            authReadyReject?.(error);
            authReadyResolved = true;
            console.error('[firebase] Initialization failed', error);
            throw error;
        }
    })();

    return initPromise;
}

export async function initFirebase() {
    return await ensureInitPromise();
}

export async function waitForFirebaseAuthReady() {
    await ensureInitPromise();
    try {
        return await authReadyPromise;
    } catch (error) {
        console.error('[firebase] Auth readiness failed', error);
        return null;
    }
}

export function onFirebaseUserChanged(callback) {
    if (typeof callback !== 'function') {
        return () => {};
    }
    authListeners.add(callback);
    if (authReadyResolved) {
        try {
            callback(currentUser);
        } catch (error) {
            console.error('[firebase] Error while notifying listener', error);
        }
    }
    return () => {
        authListeners.delete(callback);
    };
}

export function getFirebaseUser() {
    return currentUser;
}

function assertFirebaseAvailable() {
    if (!firebaseAuth || !firestoreDb) {
        throw new Error('Firebase has not been initialized. Provide window.__GESTOR_CLASSES_FIREBASE_CONFIG__.');
    }
}

export async function signInWithGoogle() {
    await ensureInitPromise();
    assertFirebaseAvailable();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return await signInWithPopup(firebaseAuth, provider);
}

export async function signOutFromFirebase() {
    await ensureInitPromise();
    if (!firebaseAuth) {
        return;
    }
    await signOut(firebaseAuth);
}

export async function readDocument(documentPath) {
    await ensureInitPromise();
    assertFirebaseAvailable();
    if (typeof documentPath !== 'string' || documentPath.trim().length === 0) {
        throw new Error('Invalid Firestore document path');
    }
    const normalized = documentPath.trim().replace(/^\/+|\/+$/g, '');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length % 2 !== 0) {
        throw new Error('Firestore document paths must have an even number of segments');
    }
    const docRef = doc(firestoreDb, ...segments);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) {
        return null;
    }
    return snapshot.data();
}

export async function writeDocument(documentPath, data) {
    await ensureInitPromise();
    assertFirebaseAvailable();
    if (typeof data !== 'object' || data === null) {
        throw new Error('Data to persist in Firestore must be an object');
    }
    const normalized = documentPath.trim().replace(/^\/+|\/+$/g, '');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length % 2 !== 0) {
        throw new Error('Firestore document paths must have an even number of segments');
    }
    const docRef = doc(firestoreDb, ...segments);
    await setDoc(docRef, data, { merge: false });
}

export function subscribeToDocument(documentPath, onData, onError) {
    if (!firestoreDb) {
        throw new Error('Firestore has not been initialized');
    }
    const normalized = documentPath.trim().replace(/^\/+|\/+$/g, '');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length % 2 !== 0) {
        throw new Error('Firestore document paths must have an even number of segments');
    }
    const docRef = doc(firestoreDb, ...segments);
    return onSnapshot(docRef, snapshot => {
        if (typeof onData === 'function') {
            try {
                onData(snapshot.exists() ? snapshot.data() : null);
            } catch (error) {
                console.error('[firebase] Error processing realtime snapshot', error);
            }
        }
    }, error => {
        if (typeof onError === 'function') {
            onError(error);
        } else {
            console.error('[firebase] Error in realtime subscription', error);
        }
    });
}
