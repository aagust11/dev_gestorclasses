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
    dataFileHandle: null,
    dataFileName: '',
    dataPersistenceSupported: isFilePersistenceSupported,
    dataPersistenceStatus: isFilePersistenceSupported ? 'unconfigured' : 'unsupported',
    dataPersistenceError: null,
};

const pendingTemplateSync = new Set();

export function isTemplateActivity(activity) {
    return Boolean(activity && activity.type === 'class' && activity.isTemplate);
}

export function scheduleTemplateSync(templateId) {
    if (!templateId || typeof templateId !== 'string') {
        return;
    }
    pendingTemplateSync.add(templateId);
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

function cloneCompetenciesList(competencies = []) {
    if (!Array.isArray(competencies)) {
        return [];
    }
    return competencies.map(comp => ({
        id: comp?.id || generateId('competency'),
        code: typeof comp?.code === 'string' ? comp.code : '',
        description: typeof comp?.description === 'string' ? comp.description : '',
        criteria: Array.isArray(comp?.criteria)
            ? comp.criteria.map(criterion => ({
                id: criterion?.id || generateId('criterion'),
                code: typeof criterion?.code === 'string' ? criterion.code : '',
                description: typeof criterion?.description === 'string' ? criterion.description : '',
            }))
            : [],
    }));
}

function cloneCriteriaRefs(criteriaRefs = []) {
    if (!Array.isArray(criteriaRefs)) {
        return [];
    }
    return criteriaRefs.map(ref => ({
        competencyId: ref?.competencyId || '',
        criterionId: ref?.criterionId || '',
    }));
}

function synchronizeTemplateData(templateId) {
    const template = state.activities.find(activity => activity.id === templateId);
    if (!isTemplateActivity(template)) {
        return;
    }

    const children = state.activities.filter(activity => (
        activity.type === 'class'
        && !activity.isTemplate
        && activity.templateId === templateId
    ));
    const childIds = new Set(children.map(child => child.id));

    const templateCompetencies = cloneCompetenciesList(template.competencies || []);
    template.competencies = cloneCompetenciesList(template.competencies || []);
    children.forEach(child => {
        child.competencies = cloneCompetenciesList(templateCompetencies);
    });

    const templateActivities = state.learningActivities.filter(activity => activity.classId === templateId);
    const templateActivityIds = new Set();

    const now = new Date().toISOString();

    templateActivities.forEach(activity => {
        templateActivityIds.add(activity.id);
        activity.isTemplateSource = true;
        if (activity.templateSourceId) {
            delete activity.templateSourceId;
        }
        activity.criteriaRefs = cloneCriteriaRefs(activity.criteriaRefs);
        activity.rubric = normalizeRubricStructure(activity.rubric);
        const weightValue = Number.parseFloat(activity.weight);
        activity.weight = Number.isFinite(weightValue) && weightValue >= 0 ? weightValue : 1;
        const isValidStatus = Object.values(LEARNING_ACTIVITY_STATUS).includes(activity.status);
        const statusIsManual = Boolean(activity.statusIsManual && isValidStatus);
        activity.statusIsManual = statusIsManual;
        const computedStatus = statusIsManual && isValidStatus
            ? activity.status
            : calculateLearningActivityStatus(activity);
        activity.status = computedStatus;
        if (!activity.createdAt) {
            activity.createdAt = now;
        }
        activity.updatedAt = now;
    });

    state.learningActivities = state.learningActivities.filter(activity => {
        if (activity.classId === templateId) {
            return true;
        }
        if (!activity.templateSourceId) {
            return true;
        }
        if (!templateActivityIds.has(activity.templateSourceId)) {
            return false;
        }
        if (!childIds.has(activity.classId)) {
            return false;
        }
        return true;
    });

    const childActivityIndex = new Map();
    state.learningActivities.forEach(activity => {
        if (!activity.templateSourceId) {
            return;
        }
        const key = `${activity.classId}|||${activity.templateSourceId}`;
        childActivityIndex.set(key, activity);
    });

    templateActivities.forEach(sourceActivity => {
        const weightValue = Number.parseFloat(sourceActivity.weight);
        const normalizedWeight = Number.isFinite(weightValue) && weightValue >= 0 ? weightValue : 1;
        const clonedCriteriaRefs = cloneCriteriaRefs(sourceActivity.criteriaRefs);
        const clonedRubric = normalizeRubricStructure(sourceActivity.rubric);
        const statusIsManual = Boolean(sourceActivity.statusIsManual && Object.values(LEARNING_ACTIVITY_STATUS).includes(sourceActivity.status));
        const status = statusIsManual
            ? sourceActivity.status
            : calculateLearningActivityStatus({
                startDate: sourceActivity.startDate,
                endDate: sourceActivity.endDate,
                status: sourceActivity.status,
            });

        children.forEach(child => {
            const key = `${child.id}|||${sourceActivity.id}`;
            const existing = childActivityIndex.get(key);
            if (existing) {
                existing.title = typeof sourceActivity.title === 'string' ? sourceActivity.title : '';
                existing.shortCode = typeof sourceActivity.shortCode === 'string' ? sourceActivity.shortCode : '';
                existing.description = typeof sourceActivity.description === 'string' ? sourceActivity.description : '';
                existing.criteriaRefs = cloneCriteriaRefs(clonedCriteriaRefs);
                existing.startDate = sourceActivity.startDate || '';
                existing.endDate = sourceActivity.endDate || '';
                existing.rubric = normalizeRubricStructure(clonedRubric);
                existing.statusIsManual = statusIsManual;
                existing.status = statusIsManual ? status : calculateLearningActivityStatus(existing);
                existing.weight = normalizedWeight;
                existing.templateSourceId = sourceActivity.id;
                existing.isTemplateSource = false;
                if (!existing.createdAt) {
                    existing.createdAt = now;
                }
                existing.updatedAt = now;
            } else {
                state.learningActivities.push({
                    id: generateId('learning-activity'),
                    classId: child.id,
                    title: typeof sourceActivity.title === 'string' ? sourceActivity.title : '',
                    shortCode: typeof sourceActivity.shortCode === 'string' ? sourceActivity.shortCode : '',
                    description: typeof sourceActivity.description === 'string' ? sourceActivity.description : '',
                    criteriaRefs: cloneCriteriaRefs(clonedCriteriaRefs),
                    createdAt: now,
                    updatedAt: now,
                    startDate: sourceActivity.startDate || '',
                    endDate: sourceActivity.endDate || '',
                    rubric: normalizeRubricStructure(clonedRubric),
                    status: statusIsManual ? status : calculateLearningActivityStatus({
                        startDate: sourceActivity.startDate,
                        endDate: sourceActivity.endDate,
                        status,
                    }),
                    statusIsManual: statusIsManual,
                    weight: normalizedWeight,
                    templateSourceId: sourceActivity.id,
                    isTemplateSource: false,
                });
            }
        });
    });

    const templateConfig = ensureSavedEvaluationConfig(templateId) || createDefaultEvaluationConfig();
    const normalizedConfig = cloneEvaluationConfig(templateConfig);
    children.forEach(child => {
        state.evaluationSettings[child.id] = cloneEvaluationConfig(normalizedConfig);
        state.evaluationSettingsDraft[child.id] = cloneEvaluationConfig(normalizedConfig);
    });
}

function applyPendingTemplateSyncs() {
    if (pendingTemplateSync.size === 0) {
        return;
    }
    const toSync = Array.from(pendingTemplateSync);
    pendingTemplateSync.clear();
    toSync.forEach(id => synchronizeTemplateData(id));
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

            const rawScoring = item?.scoring && typeof item.scoring === 'object'
                ? item.scoring
                : {};
            const mode = rawScoring.mode === 'numeric' ? 'numeric' : 'competency';
            const parsedMax = Number(rawScoring.maxScore);
            const normalizedScoring = mode === 'numeric'
                ? {
                    mode: 'numeric',
                    maxScore: Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 10,
                }
                : { mode: 'competency', maxScore: null };

            return {
                id: item?.id || generateId('rubric-item'),
                competencyId: item?.competencyId || '',
                criterionId: item?.criterionId || '',
                weight: typeof item?.weight === 'number' && !Number.isNaN(item.weight) ? item.weight : 1,
                generalComment: typeof item?.generalComment === 'string' ? item.generalComment : '',
                levelComments: normalizedComments,
                scoring: normalizedScoring,
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
            const scoringMode = item?.scoring?.mode === 'numeric' ? 'numeric' : 'competency';
            if (scoringMode === 'numeric') {
                if (value && typeof value === 'object' && value.mode === 'numeric') {
                    return Number.isFinite(Number(value.value));
                }
                if (typeof value === 'number') {
                    return Number.isFinite(value);
                }
                if (typeof value === 'string') {
                    const parsed = Number(value.replace(',', '.'));
                    return Number.isFinite(parsed);
                }
                return false;
            }
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

function populateStateFromPersistedData(parsedData = {}, { resetUIState = true } = {}) {
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
            templateSourceId: typeof activity?.templateSourceId === 'string' && activity.templateSourceId
                ? activity.templateSourceId
                : null,
            isTemplateSource: Boolean(activity?.isTemplateSource),
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
        const isClass = activity.type === 'class';
        const isTemplate = isClass && Boolean(activity.isTemplate);
        activity.isTemplate = isTemplate;

        if (!Array.isArray(activity.studentIds)) {
            activity.studentIds = [];
        }

        if (isTemplate) {
            activity.templateId = null;
        } else if (isClass && typeof activity.templateId === 'string' && activity.templateId && activity.templateId !== activity.id) {
            const exists = state.activities.some(candidate => (
                candidate.id === activity.templateId
                && candidate.type === 'class'
                && Boolean(candidate.isTemplate)
            ));
            activity.templateId = exists ? activity.templateId : null;
        } else {
            activity.templateId = null;
        }

        if (!activity.competencies) {
            activity.competencies = [];
        }

        activity.competencies.forEach(competency => {
            if (!competency.criteria) {
                competency.criteria = [];
            }
        });
    });

    state.activities
        .filter(isTemplateActivity)
        .forEach(activity => synchronizeTemplateData(activity.id));

    if (resetUIState) {
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
}

async function persistDataToFile(handle) {
    if (!handle) {
        throw new Error('No file handle configured');
    }
    const payload = buildPersistedDataPayload();
    const serialized = JSON.stringify(payload, null, 2);
    await writeDataToFile(handle, serialized);
}

async function loadDataFromHandle(handle, options = {}) {
    if (!handle) {
        throw new Error('No file handle configured');
    }
    const content = await readDataFromFile(handle);
    if (!content || content.trim().length === 0) {
        populateStateFromPersistedData({}, options);
        return;
    }
    try {
        const parsedData = JSON.parse(content);
        populateStateFromPersistedData(parsedData, options);
        state.dataPersistenceStatus = 'ready';
        state.dataPersistenceError = null;
    } catch (error) {
        console.error('Error parsing data file', error);
        state.dataPersistenceStatus = 'error';
        state.dataPersistenceError = error.message || String(error);
    }
}

let saveTimeout;
export async function saveState() {
    applyPendingTemplateSyncs();

    state.learningActivities.forEach(activity => {
        if (!activity || activity.statusIsManual) {
            return;
        }
        const computedStatus = calculateLearningActivityStatus(activity);
        activity.status = computedStatus;
    });

    if (state.dataFileHandle) {
        try {
            await persistDataToFile(state.dataFileHandle);
            state.dataPersistenceStatus = 'saved';
            state.dataPersistenceError = null;
        } catch (error) {
            console.error('Error saving data to file', error);
            state.dataPersistenceStatus = 'error';
            state.dataPersistenceError = error.message || String(error);
        }
    } else if (state.dataPersistenceSupported) {
        state.dataPersistenceStatus = 'unconfigured';
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
    if (!state.dataPersistenceSupported) {
        populateStateFromPersistedData({});
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

export async function refreshDataFromFile() {
    if (!state.dataPersistenceSupported || !state.dataFileHandle) {
        return;
    }

    try {
        const hasPermission = await ensureFilePermission(state.dataFileHandle);
        if (!hasPermission) {
            state.dataPersistenceStatus = 'permission-denied';
            state.dataPersistenceError = null;
            return;
        }
        await loadDataFromHandle(state.dataFileHandle, { resetUIState: false });
    } catch (error) {
        console.error('Error reloading data file', error);
        state.dataPersistenceStatus = 'error';
        state.dataPersistenceError = error.message || String(error);
    }
}

export async function pickExistingDataFile() {
    if (!state.dataPersistenceSupported) {
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
    if (!state.dataPersistenceSupported) {
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
    if (state.dataPersistenceSupported) {
        try {
            await clearSavedFileHandle();
        } catch (error) {
            console.error('Error clearing stored file handle', error);
        }
    }
    state.dataPersistenceStatus = state.dataPersistenceSupported ? 'unconfigured' : 'unsupported';
    state.dataPersistenceError = null;
}
