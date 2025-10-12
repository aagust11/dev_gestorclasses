// state.js: Gestiona el estado global y la persistencia de datos.

import { createDefaultEvaluationConfig, normalizeEvaluationConfig, cloneEvaluationConfig } from './evaluation.js';
import {
    isFilePersistenceSupported,
    getSavedFileHandle,
    saveFileHandle,
    clearSavedFileHandle,
    requestExistingDataFile,
    requestNewDataFile,
    ensureFilePermission,
    readDataFromFile,
    writeDataToFile
} from './filePersistence.js';
import {
    getStoredDatabaseConfig,
    saveDatabaseConfig,
    clearDatabaseConfig,
    fetchDataFromDatabase,
    saveDataToDatabase,
    testDatabaseConnection,
    subscribeToDatabaseDocument,
    getStoredPersistenceMode,
    savePersistenceMode
} from './databasePersistence.js';

const pastelColors = ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF'];

function buildDefaultFirestoreDocumentPath(uid) {
    if (!uid) {
        return '';
    }
    return `users/${uid}/gestorClasses`;
}

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
    dataFileHandle: null,
    dataFileName: '',
    dataPersistenceMode: 'file',
    databaseConfig: null,
    filePersistenceSupported: isFilePersistenceSupported,
    dataPersistenceSupported: isFilePersistenceSupported,
    dataPersistenceStatus: isFilePersistenceSupported ? 'unconfigured' : 'unsupported',
    dataPersistenceError: null,
    firebaseUser: null,
};

let databaseRealtimeUnsubscribe = null;

function updatePersistenceSupportFlag() {
    state.filePersistenceSupported = isFilePersistenceSupported;
    if (state.dataPersistenceMode === 'database') {
        state.dataPersistenceSupported = true;
    } else {
        state.dataPersistenceSupported = isFilePersistenceSupported;
    }
}

function triggerRenderEvent() {
    if (typeof document !== 'undefined') {
        document.dispatchEvent(new Event('render'));
    }
}

function detachDatabaseRealtimeSubscription() {
    if (typeof databaseRealtimeUnsubscribe === 'function') {
        try {
            databaseRealtimeUnsubscribe();
        } catch (error) {
            console.error('Error detaching database realtime subscription', error);
        }
    }
    databaseRealtimeUnsubscribe = null;
}

function attachDatabaseRealtimeSubscription(config) {
    detachDatabaseRealtimeSubscription();
    if (!config?.documentPath || config.realtime === false) {
        return;
    }
    try {
        databaseRealtimeUnsubscribe = subscribeToDatabaseDocument(
            config,
            data => {
                if (state.dataPersistenceMode !== 'database') {
                    return;
                }
                if (!data || typeof data !== 'object') {
                    populateStateFromPersistedData({});
                } else {
                    populateStateFromPersistedData(data);
                }
                state.dataPersistenceStatus = 'ready';
                state.dataPersistenceError = null;
                triggerRenderEvent();
            },
            error => {
                console.error('Realtime database subscription error', error);
                if (error?.code === 'permission-denied') {
                    state.dataPersistenceStatus = 'permission-denied';
                    state.dataPersistenceError = null;
                } else {
                    state.dataPersistenceStatus = 'error';
                    state.dataPersistenceError = error?.message || String(error);
                }
                triggerRenderEvent();
            }
        );
    } catch (error) {
        console.error('Error subscribing to database document', error);
    }
}

function isDatabasePersistenceActive() {
    return state.dataPersistenceMode === 'database'
        && Boolean(state.databaseConfig?.documentPath)
        && Boolean(state.firebaseUser?.uid);
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

function buildPersistedDataPayload() {
    return {
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
}

function populateStateFromPersistedData(parsedData = {}) {
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
    state.learningActivityRubricFilter = '';
    state.learningActivityRubricReturnView = null;
    state.pendingEvaluationHighlightActivityId = null;
}

async function persistDataToFile(handle) {
    if (!handle) {
        throw new Error('No file handle configured');
    }
    const payload = buildPersistedDataPayload();
    const serialized = JSON.stringify(payload, null, 2);
    await writeDataToFile(handle, serialized);
}

async function persistDataToDatabase(config) {
    if (!config) {
        throw new Error('No database configuration provided');
    }
    const payload = buildPersistedDataPayload();
    await saveDataToDatabase(config, payload);
}

async function loadDataFromHandle(handle) {
    if (!handle) {
        throw new Error('No file handle configured');
    }
    const content = await readDataFromFile(handle);
    if (!content || content.trim().length === 0) {
        populateStateFromPersistedData({});
        return;
    }
    try {
        const parsedData = JSON.parse(content);
        populateStateFromPersistedData(parsedData);
        state.dataPersistenceStatus = 'ready';
        state.dataPersistenceError = null;
    } catch (error) {
        console.error('Error parsing data file', error);
        state.dataPersistenceStatus = 'error';
        state.dataPersistenceError = error.message || String(error);
    }
}

async function loadDataFromDatabase(config) {
    if (!config) {
        throw new Error('No database configuration provided');
    }
    const data = await fetchDataFromDatabase(config);
    if (!data || typeof data !== 'object') {
        populateStateFromPersistedData({});
    } else {
        populateStateFromPersistedData(data);
    }
    state.dataPersistenceStatus = 'ready';
    state.dataPersistenceError = null;
    attachDatabaseRealtimeSubscription(config);
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

    if (state.dataPersistenceMode === 'database') {
        if (isDatabasePersistenceActive()) {
            try {
                await persistDataToDatabase(state.databaseConfig);
                state.dataPersistenceStatus = 'saved';
                state.dataPersistenceError = null;
            } catch (error) {
                console.error('Error saving data to database', error);
                if (error?.code === 'permission-denied') {
                    state.dataPersistenceStatus = 'permission-denied';
                    state.dataPersistenceError = null;
                } else {
                    state.dataPersistenceStatus = 'error';
                    state.dataPersistenceError = error.message || String(error);
                }
            }
        } else {
            state.dataPersistenceStatus = 'unconfigured';
            state.dataPersistenceError = null;
        }
    } else if (state.dataFileHandle) {
        try {
            await persistDataToFile(state.dataFileHandle);
            state.dataPersistenceStatus = 'saved';
            state.dataPersistenceError = null;
        } catch (error) {
            console.error('Error saving data to file', error);
            state.dataPersistenceStatus = 'error';
            state.dataPersistenceError = error.message || String(error);
        }
    } else if (isFilePersistenceSupported) {
        state.dataPersistenceStatus = 'unconfigured';
        state.dataPersistenceError = null;
    } else {
        state.dataPersistenceStatus = 'unsupported';
        state.dataPersistenceError = null;
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
    const storedMode = getStoredPersistenceMode();
    state.dataPersistenceMode = state.firebaseUser ? 'database' : storedMode;
    if (state.firebaseUser && storedMode !== 'database') {
        savePersistenceMode('database');
    }
    state.databaseConfig = getStoredDatabaseConfig();
    updatePersistenceSupportFlag();

    if (state.dataPersistenceMode === 'database') {
        state.dataFileHandle = null;
        state.dataFileName = '';
        if (!state.firebaseUser) {
            detachDatabaseRealtimeSubscription();
            populateStateFromPersistedData({});
            state.dataPersistenceStatus = 'unauthenticated';
            state.dataPersistenceError = null;
            return;
        }

        if (!state.databaseConfig || state.databaseConfig.userUid !== state.firebaseUser.uid) {
            const defaultDocumentPath = buildDefaultFirestoreDocumentPath(state.firebaseUser.uid);
            try {
                await configureDatabasePersistence({
                    documentPath: defaultDocumentPath,
                    userUid: state.firebaseUser.uid,
                    realtime: true
                });
                state.dataPersistenceStatus = 'ready';
                state.dataPersistenceError = null;
            } catch (error) {
                console.error('Error configuring database persistence', error);
                populateStateFromPersistedData({});
                if (error?.code === 'permission-denied') {
                    state.dataPersistenceStatus = 'permission-denied';
                    state.dataPersistenceError = null;
                } else {
                    state.dataPersistenceStatus = 'error';
                    state.dataPersistenceError = error.message || String(error);
                }
            }
            return;
        }

        try {
            await loadDataFromDatabase(state.databaseConfig);
        } catch (error) {
            console.error('Error loading data from database', error);
            populateStateFromPersistedData({});
            detachDatabaseRealtimeSubscription();
            if (error?.code === 'permission-denied') {
                state.dataPersistenceStatus = 'permission-denied';
                state.dataPersistenceError = null;
            } else {
                state.dataPersistenceStatus = 'error';
                state.dataPersistenceError = error.message || String(error);
            }
        }
        return;
    }

    detachDatabaseRealtimeSubscription();
    if (!isFilePersistenceSupported) {
        state.dataPersistenceSupported = false;
        state.dataFileHandle = null;
        state.dataFileName = '';
        populateStateFromPersistedData({});
        state.dataPersistenceStatus = 'unsupported';
        state.dataPersistenceError = null;
        return;
    }

    try {
        const savedHandle = await getSavedFileHandle();
        if (savedHandle) {
            const hasPermission = await ensureFilePermission(savedHandle);
            if (hasPermission) {
                state.dataFileHandle = savedHandle;
                state.dataFileName = savedHandle.name || '';
                await loadDataFromHandle(savedHandle);
            } else {
                populateStateFromPersistedData({});
                state.dataFileHandle = null;
                state.dataFileName = savedHandle.name || '';
                state.dataPersistenceStatus = 'permission-denied';
                state.dataPersistenceError = null;
            }
        } else {
            populateStateFromPersistedData({});
            state.dataFileHandle = null;
            state.dataFileName = '';
            state.dataPersistenceStatus = 'unconfigured';
            state.dataPersistenceError = null;
        }
    } catch (error) {
        console.error('Error loading data from configured file', error);
        state.dataPersistenceStatus = 'error';
        state.dataPersistenceError = error.message || String(error);
    }
}

export function resetStateToDefaults() {
    populateStateFromPersistedData({});
}

export async function pickExistingDataFile() {
    if (state.dataPersistenceMode !== 'file') {
        return false;
    }
    if (!isFilePersistenceSupported) {
        return false;
    }

    try {
        const handle = await requestExistingDataFile();
        if (!handle) {
            return false;
        }
        const hasPermission = await ensureFilePermission(handle);
        if (!hasPermission) {
            state.dataPersistenceStatus = 'permission-denied';
            state.dataPersistenceError = null;
            return false;
        }
        state.dataFileHandle = handle;
        state.dataFileName = handle.name || '';
        await saveFileHandle(handle);
        await loadDataFromHandle(handle);
        return true;
    } catch (error) {
        console.error('Error selecting data file', error);
        state.dataPersistenceStatus = 'error';
        state.dataPersistenceError = error.message || String(error);
        return false;
    }
}

export async function createDataFileWithCurrentState() {
    if (state.dataPersistenceMode !== 'file') {
        return false;
    }
    if (!isFilePersistenceSupported) {
        return false;
    }

    try {
        const handle = await requestNewDataFile();
        if (!handle) {
            return false;
        }
        const hasPermission = await ensureFilePermission(handle);
        if (!hasPermission) {
            state.dataPersistenceStatus = 'permission-denied';
            state.dataPersistenceError = null;
            return false;
        }
        state.dataFileHandle = handle;
        state.dataFileName = handle.name || '';
        await saveFileHandle(handle);
        await persistDataToFile(handle);
        state.dataPersistenceStatus = 'saved';
        state.dataPersistenceError = null;
        return true;
    } catch (error) {
        console.error('Error creating data file', error);
        state.dataPersistenceStatus = 'error';
        state.dataPersistenceError = error.message || String(error);
        return false;
    }
}

export async function reloadDataFromConfiguredFile() {
    if (state.dataPersistenceMode !== 'file') {
        return false;
    }
    if (!state.dataFileHandle) {
        return false;
    }
    try {
        await loadDataFromHandle(state.dataFileHandle);
        state.dataPersistenceStatus = 'ready';
        state.dataPersistenceError = null;
        return true;
    } catch (error) {
        console.error('Error reloading data file', error);
        state.dataPersistenceStatus = 'error';
        state.dataPersistenceError = error.message || String(error);
        return false;
    }
}

export async function clearConfiguredDataFile() {
    state.dataFileHandle = null;
    state.dataFileName = '';
    if (isFilePersistenceSupported) {
        try {
            await clearSavedFileHandle();
        } catch (error) {
            console.error('Error clearing stored file handle', error);
        }
    }
    if (state.dataPersistenceMode === 'file') {
        state.dataPersistenceStatus = isFilePersistenceSupported ? 'unconfigured' : 'unsupported';
        state.dataPersistenceError = null;
    }
}

export async function configureDatabasePersistence(config) {
    const configWithUser = {
        ...config,
        userUid: config?.userUid || state.firebaseUser?.uid || ''
    };
    const normalized = saveDatabaseConfig(configWithUser);
    state.databaseConfig = normalized;
    state.dataPersistenceMode = 'database';
    savePersistenceMode('database');
    updatePersistenceSupportFlag();
    try {
        await loadDataFromDatabase(normalized);
        return true;
    } catch (error) {
        console.error('Error configuring database persistence', error);
        detachDatabaseRealtimeSubscription();
        if (error?.code === 'permission-denied') {
            state.dataPersistenceStatus = 'permission-denied';
            state.dataPersistenceError = null;
        } else {
            state.dataPersistenceStatus = 'error';
            state.dataPersistenceError = error.message || String(error);
        }
        throw error;
    }
}

export async function reloadDataFromDatabase() {
    if (!isDatabasePersistenceActive()) {
        return false;
    }
    try {
        await loadDataFromDatabase(state.databaseConfig);
        return true;
    } catch (error) {
        console.error('Error reloading data from database', error);
        detachDatabaseRealtimeSubscription();
        if (error?.code === 'permission-denied') {
            state.dataPersistenceStatus = 'permission-denied';
            state.dataPersistenceError = null;
        } else {
            state.dataPersistenceStatus = 'error';
            state.dataPersistenceError = error.message || String(error);
        }
        return false;
    }
}

export function clearDatabasePersistenceConfig() {
    clearDatabaseConfig();
    state.databaseConfig = null;
    detachDatabaseRealtimeSubscription();
    if (state.dataPersistenceMode === 'database') {
        state.dataPersistenceStatus = 'unconfigured';
        state.dataPersistenceError = null;
    }
    updatePersistenceSupportFlag();
}

export async function switchDataPersistenceMode(mode) {
    if (mode !== 'file' && mode !== 'database') {
        return false;
    }
    if (state.dataPersistenceMode === mode) {
        return true;
    }
    state.dataPersistenceMode = mode;
    savePersistenceMode(mode);
    updatePersistenceSupportFlag();

    if (mode === 'database') {
        if (!state.databaseConfig) {
            state.dataPersistenceStatus = 'unconfigured';
            state.dataPersistenceError = null;
            return true;
        }
        if (!state.firebaseUser?.uid) {
            state.dataPersistenceStatus = 'unauthenticated';
            state.dataPersistenceError = null;
            return true;
        }
        try {
            await loadDataFromDatabase(state.databaseConfig);
            return true;
        } catch (error) {
            console.error('Error switching to database persistence', error);
            if (error?.code === 'permission-denied') {
                state.dataPersistenceStatus = 'permission-denied';
                state.dataPersistenceError = null;
            } else {
                state.dataPersistenceStatus = 'error';
                state.dataPersistenceError = error.message || String(error);
            }
            return false;
        }
    }

    detachDatabaseRealtimeSubscription();

    if (!isFilePersistenceSupported) {
        state.dataFileHandle = null;
        state.dataFileName = '';
        state.dataPersistenceStatus = 'unsupported';
        state.dataPersistenceError = null;
        return true;
    }

    if (state.dataFileHandle) {
        const success = await reloadDataFromConfiguredFile();
        return success;
    }

    state.dataFileName = '';
    state.dataPersistenceStatus = 'unconfigured';
    state.dataPersistenceError = null;
    return true;
}

export async function testDatabasePersistence(config) {
    const targetConfig = config || state.databaseConfig;
    if (!targetConfig) {
        throw new Error('No database configuration is available');
    }
    return await testDatabaseConnection(targetConfig);
}

export function getDefaultFirebaseDocumentPath() {
    return buildDefaultFirestoreDocumentPath(state.firebaseUser?.uid || '');
}

export function applyFirebaseUser(user) {
    if (user && typeof user === 'object') {
        state.firebaseUser = {
            uid: user.uid,
            displayName: user.displayName || '',
            email: user.email || ''
        };
        return;
    }

    state.firebaseUser = null;
    if (state.dataPersistenceMode === 'database') {
        detachDatabaseRealtimeSubscription();
        populateStateFromPersistedData({});
        state.dataPersistenceStatus = 'unauthenticated';
        state.dataPersistenceError = null;
    }
}
