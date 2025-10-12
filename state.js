// state.js: Gestiona el estado global y la persistencia de datos.

import { createDefaultEvaluationConfig, normalizeEvaluationConfig, cloneEvaluationConfig } from './evaluation.js';
import { t } from './i18n.js';

const ENCRYPTED_STATE_STORAGE_KEY = 'teacherDashboardDataEncrypted';
const LEGACY_STATE_STORAGE_KEY = 'teacherDashboardData';
const ENCRYPTION_METADATA_STORAGE_KEY = 'teacherDashboardEncryptionMetadata';
const DEFAULT_PBKDF2_ITERATIONS = 250000;
const MIN_ENCRYPTION_PASSWORD_LENGTH = 8;

let encryptionKey = null;
let encryptionMetadataCache = null;
let encryptionMetadataLoaded = false;

const pastelColors = ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF'];

// El estado central de la aplicación.
export const LEARNING_ACTIVITY_STATUS = {
    SCHEDULED: 'scheduled',
    OPEN_SUBMISSIONS: 'open_submissions',
    PENDING_REVIEW: 'pending_review',
    CORRECTED: 'corrected'
};

export const RUBRIC_LEVELS = ['NA', 'AS', 'AN', 'AE'];

export const state = {
    activeView: 'schedule',
    activities: [],
    learningActivities: [],
    students: [],
    timeSlots: [],
    schedule: {},
    scheduleOverrides: [],
    classEntries: {},
    currentDate: new Date(),
    courseStartDate: '', // Mantenido por retrocompatibilidad, pero los trimestres tienen prioridad.
    courseEndDate: '',   // Mantenido por retrocompatibilidad.
    terms: [],
    selectedTermId: 'all',
    holidays: [],
    selectedActivity: null,
    selectedStudentId: null,
    selectedCompetency: null,
    editingTimeSlotId: null,
    editingActivityId: null,
    settingsActiveTab: 'calendar', // NUEVO: Pestaña activa en la vista de configuración
    studentTimelineFilter: 'all',
    learningActivityDraft: null,
    expandedLearningActivityClassIds: [],
    expandedCompetencyClassIds: [],
    learningActivityGuideVisible: false,
    learningActivityCriteriaModalOpen: false,
    pendingCompetencyHighlightId: null,
    activeLearningActivityRubricId: null,
    learningActivityRubricTab: 'configuration',
    learningActivityRubricFilter: '',
    evaluationActiveTab: 'activities',
    selectedEvaluationClassId: null,
    evaluationSelectedTermId: 'all',
    termGradeCalculationMode: 'dates',
    learningActivityRubricReturnView: null,
    pendingEvaluationHighlightActivityId: null,
    evaluationSettings: {},
    evaluationSettingsDraft: {},
    settingsEvaluationSelectedClassId: null,
    evaluationSettingsFeedback: {},
    termGradeRecords: {},
    termGradeExpandedCompetencies: {},
};

function getLocalStorageInstance() {
    if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
    }
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage;
        }
    } catch (error) {
        console.warn('LocalStorage no está disponible en este contexto.', error);
    }
    return null;
}

function translateMessage(key, fallback) {
    try {
        const translated = t(key);
        if (typeof translated === 'string' && !translated.startsWith('[')) {
            return translated;
        }
    } catch (error) {
        console.warn('No se pudo obtener la traducción para', key, error);
    }
    return fallback;
}

function showAlertMessage(message) {
    if (!message) {
        return;
    }
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(message);
        return;
    }
    if (typeof alert === 'function') {
        alert(message);
        return;
    }
    console.warn(message);
}

function requestPasswordInput(message) {
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        return window.prompt(message);
    }
    if (typeof prompt === 'function') {
        return prompt(message);
    }
    throw new Error('No hay disponible un mecanismo para solicitar la contraseña de cifrado.');
}

function getCrypto() {
    const cryptoRef = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : null;
    if (cryptoRef && cryptoRef.subtle && typeof cryptoRef.getRandomValues === 'function') {
        return cryptoRef;
    }
    throw new Error('La API Web Crypto no está disponible en este entorno.');
}

function readMetadataFromStorage() {
    const storage = getLocalStorageInstance();
    if (!storage) {
        return null;
    }
    const raw = storage.getItem(ENCRYPTION_METADATA_STORAGE_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (error) {
        console.warn('No se pudo parsear la metainformación de cifrado almacenada.', error);
    }
    return null;
}

function persistKeyMetadata(metadata) {
    const storage = getLocalStorageInstance();
    if (!storage) {
        return;
    }
    if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) {
        storage.removeItem(ENCRYPTION_METADATA_STORAGE_KEY);
        return;
    }
    storage.setItem(ENCRYPTION_METADATA_STORAGE_KEY, JSON.stringify(metadata));
}

function getEncryptionMetadata() {
    if (!encryptionMetadataLoaded) {
        encryptionMetadataCache = readMetadataFromStorage() || {};
        encryptionMetadataLoaded = true;
    }
    if (!encryptionMetadataCache || typeof encryptionMetadataCache !== 'object') {
        encryptionMetadataCache = {};
    }
    return encryptionMetadataCache;
}

function mergeMetadataHint(metadataHint) {
    if (!metadataHint || typeof metadataHint !== 'object') {
        return;
    }
    const metadata = getEncryptionMetadata();
    let updated = false;

    const hintSalt = typeof metadataHint.salt === 'string'
        ? metadataHint.salt
        : (typeof metadataHint.keySalt === 'string' ? metadataHint.keySalt : null);
    const hintIterations = Number.isFinite(metadataHint.iterations)
        ? metadataHint.iterations
        : (Number.isFinite(metadataHint.keyIterations) ? metadataHint.keyIterations : null);

    if (hintSalt && metadata.salt !== hintSalt) {
        metadata.salt = hintSalt;
        if (metadata.key) {
            delete metadata.key;
            encryptionKey = null;
        }
        updated = true;
    }

    if (hintIterations && metadata.iterations !== hintIterations) {
        metadata.iterations = hintIterations;
        updated = true;
    }

    if (updated) {
        persistKeyMetadata(metadata);
    }
}

function invalidateStoredKey() {
    const metadata = getEncryptionMetadata();
    if (metadata.key) {
        delete metadata.key;
        persistKeyMetadata(metadata);
    }
    encryptionKey = null;
}

function encodeBase64Binary(binary) {
    if (typeof globalThis !== 'undefined' && typeof globalThis.btoa === 'function') {
        return globalThis.btoa(binary);
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(binary, 'binary').toString('base64');
    }
    throw new Error('No hay soporte para convertir a base64.');
}

function decodeBase64Binary(base64) {
    if (typeof globalThis !== 'undefined' && typeof globalThis.atob === 'function') {
        return globalThis.atob(base64);
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(base64, 'base64').toString('binary');
    }
    throw new Error('No hay soporte para decodificar base64.');
}

function arrayBufferToBase64(buffer) {
    if (!buffer) {
        return '';
    }
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || []);
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    return encodeBase64Binary(binary);
}

function base64ToArrayBuffer(base64) {
    if (!base64 || typeof base64 !== 'string') {
        throw new Error('Cadena base64 inválida.');
    }
    const binary = decodeBase64Binary(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function base64ToUint8Array(base64) {
    return new Uint8Array(base64ToArrayBuffer(base64));
}

async function importKeyFromBase64(base64Key) {
    const cryptoRef = getCrypto();
    const keyBuffer = base64ToArrayBuffer(base64Key);
    return cryptoRef.subtle.importKey(
        'raw',
        keyBuffer,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
}

async function deriveAesKeyFromPassword(password, saltBytes, iterations) {
    const cryptoRef = getCrypto();
    const encoder = new TextEncoder();
    const baseKey = await cryptoRef.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return cryptoRef.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations,
            hash: 'SHA-256',
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

async function promptForNewEncryptionKey({ metadata, reasonKey }) {
    const metadataRef = metadata || getEncryptionMetadata();
    const cryptoRef = getCrypto();
    let saltBytes = null;

    if (metadataRef.salt) {
        try {
            saltBytes = base64ToUint8Array(metadataRef.salt);
        } catch (error) {
            console.warn('No se pudo usar la sal almacenada, se generará una nueva.', error);
            saltBytes = null;
        }
    }

    if (!saltBytes) {
        saltBytes = cryptoRef.getRandomValues(new Uint8Array(16));
        metadataRef.salt = arrayBufferToBase64(saltBytes.buffer);
    }

    const iterations = Number.isFinite(metadataRef.iterations) ? metadataRef.iterations : DEFAULT_PBKDF2_ITERATIONS;
    metadataRef.iterations = iterations;

    while (true) {
        const promptMessage = translateMessage(reasonKey || 'encryption_password_prompt', 'Introduce la contraseña de cifrado para tus datos (mínimo 8 caracteres).');
        const password = requestPasswordInput(promptMessage);
        if (password === null) {
            throw new Error('Encryption password input cancelled');
        }

        const trimmed = password.trim();
        if (!trimmed) {
            showAlertMessage(translateMessage('encryption_password_empty', 'La contraseña no puede estar vacía.'));
            continue;
        }
        if (trimmed.length < MIN_ENCRYPTION_PASSWORD_LENGTH) {
            showAlertMessage(translateMessage('encryption_password_too_short', 'La contraseña debe tener al menos 8 caracteres.'));
            continue;
        }

        try {
            const derivedKey = await deriveAesKeyFromPassword(trimmed, saltBytes, iterations);
            const exportedKey = await cryptoRef.subtle.exportKey('raw', derivedKey);
            metadataRef.key = arrayBufferToBase64(exportedKey);
            persistKeyMetadata(metadataRef);
            encryptionMetadataCache = metadataRef;
            encryptionKey = derivedKey;
            return derivedKey;
        } catch (error) {
            console.error('Error al derivar la clave de cifrado.', error);
            showAlertMessage(translateMessage('encryption_password_generation_error', 'No fue posible generar la clave de cifrado, inténtalo de nuevo.'));
        }
    }
}

async function ensureEncryptionKey({ metadataHint = null, forcePrompt = false, reasonKey } = {}) {
    if (metadataHint) {
        mergeMetadataHint(metadataHint);
    }

    if (!forcePrompt && encryptionKey) {
        return encryptionKey;
    }

    const metadata = getEncryptionMetadata();

    if (!forcePrompt && metadata.key) {
        try {
            encryptionKey = await importKeyFromBase64(metadata.key);
            return encryptionKey;
        } catch (error) {
            console.warn('No se pudo importar la clave de cifrado almacenada, se solicitará una nueva.', error);
            invalidateStoredKey();
        }
    }

    return promptForNewEncryptionKey({ metadata, reasonKey });
}

function storeLocalEncryptedPayload(payload) {
    const storage = getLocalStorageInstance();
    if (!storage) {
        return;
    }
    storage.setItem(ENCRYPTED_STATE_STORAGE_KEY, JSON.stringify(payload));
}

function loadLocalEncryptedPayload() {
    const storage = getLocalStorageInstance();
    if (!storage) {
        return null;
    }
    const raw = storage.getItem(ENCRYPTED_STATE_STORAGE_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (error) {
        console.warn('No se pudo parsear el estado cifrado local, se eliminará.', error);
        storage.removeItem(ENCRYPTED_STATE_STORAGE_KEY);
    }
    return null;
}

function loadLegacyPlainState() {
    const storage = getLocalStorageInstance();
    if (!storage) {
        return null;
    }
    const raw = storage.getItem(LEGACY_STATE_STORAGE_KEY);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        console.warn('No se pudo parsear el estado sin cifrar almacenado.', error);
    }
    return null;
}

function removeLegacyPlainState() {
    const storage = getLocalStorageInstance();
    if (!storage) {
        return;
    }
    storage.removeItem(LEGACY_STATE_STORAGE_KEY);
}

async function encryptStatePayload(data, key) {
    const cryptoRef = getCrypto();
    const encoder = new TextEncoder();
    const iv = cryptoRef.getRandomValues(new Uint8Array(12));
    const payloadBuffer = encoder.encode(JSON.stringify(data));
    const cipherBuffer = await cryptoRef.subtle.encrypt({ name: 'AES-GCM', iv }, key, payloadBuffer);

    const metadata = getEncryptionMetadata();

    return {
        version: 1,
        iv: arrayBufferToBase64(iv.buffer),
        data: arrayBufferToBase64(cipherBuffer),
        salt: metadata.salt,
        iterations: metadata.iterations || DEFAULT_PBKDF2_ITERATIONS,
    };
}

async function decryptStatePayload(payload, key) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Payload de cifrado inválido.');
    }
    const cryptoRef = getCrypto();
    const iv = base64ToUint8Array(payload.iv);
    const cipherBuffer = base64ToArrayBuffer(payload.data);
    const decryptedBuffer = await cryptoRef.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuffer);
    const decoder = new TextDecoder();
    const jsonString = decoder.decode(decryptedBuffer);
    return JSON.parse(jsonString);
}

async function attemptDecryptionWithRetry(payload, reasonKey) {
    if (!payload || typeof payload !== 'object' || !payload.data || !payload.iv) {
        return null;
    }

    try {
        const key = await ensureEncryptionKey({ metadataHint: payload, reasonKey });
        return await decryptStatePayload(payload, key);
    } catch (error) {
        if (error && error.message === 'Encryption password input cancelled') {
            return null;
        }
        console.warn('No se pudo descifrar el estado con la clave almacenada.', error);
    }

    invalidateStoredKey();

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const key = await ensureEncryptionKey({ metadataHint: payload, forcePrompt: true, reasonKey: reasonKey || 'encryption_password_prompt_retry' });
            return await decryptStatePayload(payload, key);
        } catch (error) {
            if (error && error.message === 'Encryption password input cancelled') {
                return null;
            }
            console.warn(`Intento ${attempt + 1} de descifrado fallido.`, error);
            showAlertMessage(translateMessage('encryption_password_invalid', 'No fue posible descifrar los datos con esa contraseña. Inténtalo de nuevo.'));
            invalidateStoredKey();
        }
    }

    return null;
}

async function fetchRemoteState() {
    if (typeof fetch !== 'function') {
        return null;
    }
    try {
        const response = await fetch('/api/state', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            credentials: 'include',
        });
        if (response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`Error ${response.status} al obtener el estado cifrado.`);
        }
        const payload = await response.json();
        if (payload && typeof payload === 'object') {
            return payload;
        }
    } catch (error) {
        console.warn('No se pudo obtener el estado cifrado desde el servidor.', error);
    }
    return null;
}

function persistRemoteState(payload) {
    if (typeof fetch !== 'function') {
        return Promise.resolve();
    }
    return fetch('/api/state', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
    }).then(response => {
        if (!response.ok) {
            throw new Error(`Error ${response.status} al guardar el estado cifrado.`);
        }
    }).catch(error => {
        console.warn('No se pudo sincronizar el estado cifrado con el servidor.', error);
    });
}

function ensureSavedEvaluationConfig(classId) {
    if (!classId) {
        return null;
    }
    const existing = state.evaluationSettings[classId];
    if (existing) {
        const normalized = normalizeEvaluationConfig(existing);
        state.evaluationSettings[classId] = normalized;
        return normalized;
    }
    const created = createDefaultEvaluationConfig();
    state.evaluationSettings[classId] = created;
    return created;
}

export function ensureEvaluationDraft(classId) {
    if (!classId) {
        return null;
    }
    const saved = ensureSavedEvaluationConfig(classId);
    if (!state.evaluationSettingsDraft[classId]) {
        state.evaluationSettingsDraft[classId] = cloneEvaluationConfig(saved);
    }
    return state.evaluationSettingsDraft[classId];
}

export function persistEvaluationDraft(classId) {
    if (!classId || !state.evaluationSettingsDraft[classId]) {
        return null;
    }
    const normalized = normalizeEvaluationConfig(state.evaluationSettingsDraft[classId]);
    state.evaluationSettings[classId] = cloneEvaluationConfig(normalized);
    state.evaluationSettingsDraft[classId] = cloneEvaluationConfig(normalized);
    return state.evaluationSettings[classId];
}

export function resetEvaluationDraftToDefault(classId) {
    if (!classId) {
        return null;
    }
    const defaults = createDefaultEvaluationConfig();
    state.evaluationSettingsDraft[classId] = cloneEvaluationConfig(defaults);
    return state.evaluationSettingsDraft[classId];
}

function generateId(prefix = 'id') {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const random = Math.random().toString(16).slice(2, 10);
    return `${prefix}-${Date.now()}-${random}`;
}

function normalizeRubricStructure(rawRubric) {
    const rubric = rawRubric && typeof rawRubric === 'object' ? rawRubric : {};
    const normalized = {
        items: Array.isArray(rubric.items) ? rubric.items.map(item => {
            const levelComments = item?.levelComments && typeof item.levelComments === 'object'
                ? item.levelComments
                : {};
            const normalizedComments = {};
            RUBRIC_LEVELS.forEach(level => {
                normalizedComments[level] = typeof levelComments[level] === 'string' ? levelComments[level] : '';
            });

            return {
                id: item?.id || generateId('rubric-item'),
                competencyId: item?.competencyId || '',
                criterionId: item?.criterionId || '',
                weight: typeof item?.weight === 'number' && !Number.isNaN(item.weight) ? item.weight : 1,
                generalComment: typeof item?.generalComment === 'string' ? item.generalComment : '',
                levelComments: normalizedComments,
            };
        }) : [],
        evaluations: {}
    };

    if (rubric?.evaluations && typeof rubric.evaluations === 'object') {
        Object.entries(rubric.evaluations).forEach(([studentId, evaluation]) => {
            if (!studentId) return;
            const normalizedEvaluation = evaluation && typeof evaluation === 'object' ? evaluation : {};
            const flags = normalizedEvaluation.flags && typeof normalizedEvaluation.flags === 'object'
                ? normalizedEvaluation.flags
                : {};
            normalized.evaluations[studentId] = {
                scores: normalizedEvaluation.scores && typeof normalizedEvaluation.scores === 'object'
                    ? { ...normalizedEvaluation.scores }
                    : {},
                comment: typeof normalizedEvaluation.comment === 'string' ? normalizedEvaluation.comment : '',
                flags: {
                    notPresented: Boolean(flags.notPresented),
                    deliveredLate: Boolean(flags.deliveredLate)
                }
            };
        });
    }

    return normalized;
}

function parseDateValue(dateString, endOfDay = false) {
    if (!dateString) return null;
    const date = new Date(`${dateString}T${endOfDay ? '23:59:59' : '00:00:00'}`);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date;
}

function getLearningActivityStudentIds(activity) {
    if (!activity || !activity.classId) {
        return [];
    }
    const targetClass = state.activities.find(a => a.id === activity.classId);
    if (!targetClass || !Array.isArray(targetClass.studentIds)) {
        return [];
    }
    return targetClass.studentIds.filter(id => typeof id === 'string' && id);
}

function isLearningActivityFullyCorrected(activity) {
    if (!activity || !activity.rubric) {
        return false;
    }

    const rubric = activity.rubric;
    const rubricItems = Array.isArray(rubric.items) ? rubric.items : [];
    if (rubricItems.length === 0) {
        return false;
    }

    const evaluations = rubric.evaluations && typeof rubric.evaluations === 'object'
        ? rubric.evaluations
        : {};

    const studentIds = getLearningActivityStudentIds(activity);
    if (studentIds.length === 0) {
        return false;
    }

    return studentIds.every(studentId => {
        const evaluation = evaluations[studentId];
        if (!evaluation || typeof evaluation !== 'object') {
            return false;
        }

        const flags = evaluation.flags && typeof evaluation.flags === 'object'
            ? evaluation.flags
            : {};

        if (flags.notPresented) {
            return true;
        }

        const scores = evaluation.scores && typeof evaluation.scores === 'object'
            ? evaluation.scores
            : {};

        return rubricItems.every(item => {
            const value = scores[item.id];
            return typeof value === 'string' && RUBRIC_LEVELS.includes(value);
        });
    });
}

export function calculateLearningActivityStatus(activity, referenceDate = new Date()) {
    if (!activity) {
        return LEARNING_ACTIVITY_STATUS.SCHEDULED;
    }

    if (activity.statusIsManual && Object.values(LEARNING_ACTIVITY_STATUS).includes(activity.status)) {
        return activity.status;
    }

    if (isLearningActivityFullyCorrected(activity)) {
        return LEARNING_ACTIVITY_STATUS.CORRECTED;
    }

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    const endDate = parseDateValue(activity.endDate, true);
    if (endDate && today > endDate) {
        return LEARNING_ACTIVITY_STATUS.PENDING_REVIEW;
    }

    const startDate = parseDateValue(activity.startDate, false);
    if (startDate && today >= startDate) {
        return LEARNING_ACTIVITY_STATUS.OPEN_SUBMISSIONS;
    }

    const existingStatus = activity.status;
    if (!activity.startDate && !activity.endDate && Object.values(LEARNING_ACTIVITY_STATUS).includes(existingStatus)) {
        return existingStatus;
    }

    return LEARNING_ACTIVITY_STATUS.SCHEDULED;
}

export function createEmptyRubric() {
    return normalizeRubricStructure({ items: [], evaluations: {} });
}

export function normalizeRubric(rubric) {
    return normalizeRubricStructure(rubric);
}

export function getRandomPastelColor() {
    const usedColors = state.activities.map(a => a.color);
    const availableColors = pastelColors.filter(c => !usedColors.includes(c));
    return availableColors.length > 0 ? availableColors[0] : pastelColors[Math.floor(Math.random() * pastelColors.length)];
}

let saveTimeout;
export async function saveState() {
    state.learningActivities.forEach(activity => {
        if (!activity || activity.statusIsManual) {
            return;
        }
        const computedStatus = calculateLearningActivityStatus(activity);
        activity.status = computedStatus;
    });

    const dataToSave = {
        activities: state.activities,
        learningActivities: state.learningActivities,
        students: state.students,
        timeSlots: state.timeSlots,
        schedule: state.schedule,
        scheduleOverrides: state.scheduleOverrides,
        classEntries: state.classEntries,
        courseStartDate: state.courseStartDate,
        courseEndDate: state.courseEndDate,
        terms: state.terms,
        selectedTermId: state.selectedTermId,
        holidays: state.holidays,
        settingsActiveTab: state.settingsActiveTab,
        studentTimelineFilter: state.studentTimelineFilter,
        evaluationActiveTab: state.evaluationActiveTab,
        selectedEvaluationClassId: state.selectedEvaluationClassId,
        evaluationSelectedTermId: state.evaluationSelectedTermId,
        termGradeCalculationMode: state.termGradeCalculationMode,
        evaluationSettings: state.evaluationSettings,
        settingsEvaluationSelectedClassId: state.settingsEvaluationSelectedClassId,
        termGradeRecords: state.termGradeRecords,
        termGradeExpandedCompetencies: state.termGradeExpandedCompetencies,
    };

    try {
        const key = await ensureEncryptionKey();
        const encryptedPayload = await encryptStatePayload(dataToSave, key);
        storeLocalEncryptedPayload(encryptedPayload);
        removeLegacyPlainState();
        persistRemoteState(encryptedPayload);
    } catch (error) {
        console.error('No se pudo cifrar el estado antes de guardarlo. Se usará una copia local sin cifrar como respaldo.', error);
        const storage = getLocalStorageInstance();
        if (storage) {
            storage.setItem(LEGACY_STATE_STORAGE_KEY, JSON.stringify(dataToSave));
        }
    }

    const indicator = document.getElementById('save-indicator');
    if (indicator) {
        indicator.classList.add('show');
        lucide.createIcons({
            nodes: [indicator.querySelector('i')]
        });

        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            indicator.classList.remove('show');
        }, 1500);
    }
}

export async function loadState() {
    let parsedData = null;

    const remotePayload = await fetchRemoteState();
    if (remotePayload) {
        mergeMetadataHint(remotePayload);
        parsedData = await attemptDecryptionWithRetry(remotePayload, 'encryption_password_prompt_existing');
        if (parsedData) {
            storeLocalEncryptedPayload(remotePayload);
        }
    }

    if (!parsedData) {
        const localPayload = loadLocalEncryptedPayload();
        if (localPayload) {
            mergeMetadataHint(localPayload);
            parsedData = await attemptDecryptionWithRetry(localPayload, 'encryption_password_prompt_retry');
        }
    }

    if (!parsedData) {
        parsedData = loadLegacyPlainState();
    }

    if (parsedData) {
        applyStateFromParsedData(parsedData);
        removeLegacyPlainState();
        return true;
    }

    return false;
}

function applyStateFromParsedData(parsedData) {
    if (!parsedData || typeof parsedData !== 'object') {
        return;
    }

    state.activities = parsedData.activities || [];
    state.learningActivities = (parsedData.learningActivities || []).map(activity => {
        const normalized = {
            ...activity,
            criteriaRefs: Array.isArray(activity?.criteriaRefs) ? activity.criteriaRefs : [],
            createdAt: activity?.createdAt || new Date().toISOString(),
            updatedAt: activity?.updatedAt || activity?.createdAt || new Date().toISOString(),
            startDate: activity?.startDate || '',
            endDate: activity?.endDate || '',
            weight: typeof activity?.weight === 'number' && !Number.isNaN(activity.weight)
                ? activity.weight
                : 1,
            statusIsManual: Boolean(activity?.statusIsManual),
            shortCode: typeof activity?.shortCode === 'string' ? activity.shortCode : '',
        };
        normalized.rubric = normalizeRubricStructure(activity?.rubric);
        normalized.status = calculateLearningActivityStatus(normalized);
        return normalized;
    });
    state.students = parsedData.students || [];
    state.timeSlots = parsedData.timeSlots || [];
    state.schedule = parsedData.schedule || {};
    state.scheduleOverrides = parsedData.scheduleOverrides || [];
    state.classEntries = parsedData.classEntries || {};
    state.courseStartDate = parsedData.courseStartDate || '';
    state.courseEndDate = parsedData.courseEndDate || '';
    state.terms = parsedData.terms || [];
    state.selectedTermId = parsedData.selectedTermId || 'all';
    state.holidays = parsedData.holidays || [];
    state.settingsActiveTab = parsedData.settingsActiveTab || 'calendar';
    state.studentTimelineFilter = parsedData.studentTimelineFilter || 'all';
    state.evaluationActiveTab = parsedData.evaluationActiveTab || 'activities';
    state.selectedEvaluationClassId = parsedData.selectedEvaluationClassId || null;
    state.evaluationSelectedTermId = parsedData.evaluationSelectedTermId || 'all';
    state.termGradeCalculationMode = parsedData.termGradeCalculationMode === 'accumulated'
        ? 'accumulated'
        : 'dates';

    const rawEvaluationSettings = parsedData.evaluationSettings || {};
    state.evaluationSettings = {};
    Object.entries(rawEvaluationSettings).forEach(([classId, config]) => {
        if (!classId) return;
        state.evaluationSettings[classId] = normalizeEvaluationConfig(config);
    });

    state.evaluationSettingsDraft = {};
    Object.entries(state.evaluationSettings).forEach(([classId, config]) => {
        state.evaluationSettingsDraft[classId] = cloneEvaluationConfig(config);
    });

    state.settingsEvaluationSelectedClassId = parsedData.settingsEvaluationSelectedClassId || null;
    state.termGradeRecords = parsedData.termGradeRecords && typeof parsedData.termGradeRecords === 'object'
        ? parsedData.termGradeRecords
        : {};
    state.termGradeExpandedCompetencies = (parsedData.termGradeExpandedCompetencies && typeof parsedData.termGradeExpandedCompetencies === 'object')
        ? parsedData.termGradeExpandedCompetencies
        : {};
    state.evaluationSettingsFeedback = {};

    state.activities.forEach(activity => {
        if (!activity.competencies) {
            activity.competencies = [];
        }

        activity.competencies.forEach(competency => {
            if (!competency.criteria) {
                competency.criteria = [];
            }
        });
    });

    state.learningActivityDraft = null;
    state.expandedLearningActivityClassIds = [];
    state.expandedCompetencyClassIds = [];
    state.learningActivityGuideVisible = false;
    state.learningActivityCriteriaModalOpen = false;
    state.pendingCompetencyHighlightId = null;
    state.activeLearningActivityRubricId = null;
    state.learningActivityRubricTab = 'configuration';
}

export async function regenerateEncryptionKey() {
    const metadata = getEncryptionMetadata();
    delete metadata.key;
    delete metadata.salt;
    metadata.iterations = DEFAULT_PBKDF2_ITERATIONS;
    persistKeyMetadata(metadata);
    encryptionMetadataCache = metadata;
    encryptionKey = null;

    const key = await ensureEncryptionKey({ forcePrompt: true, reasonKey: 'encryption_password_prompt_rotation' });
    await saveState();
    return key;
}

export function clearPersistedStateStorage() {
    const storage = getLocalStorageInstance();
    if (storage) {
        storage.removeItem(LEGACY_STATE_STORAGE_KEY);
        storage.removeItem(ENCRYPTED_STATE_STORAGE_KEY);
        storage.removeItem(ENCRYPTION_METADATA_STORAGE_KEY);
    }
    encryptionKey = null;
    encryptionMetadataCache = null;
    encryptionMetadataLoaded = false;
}
