// state.js: Gestiona el estado global y la persistencia de datos.

const pastelColors = ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF'];

// El estado central de la aplicación.
export const LEARNING_ACTIVITY_STATUS = {
    SCHEDULED: 'scheduled',
    OPEN_SUBMISSIONS: 'open_submissions',
    PENDING_REVIEW: 'pending_review'
};

export const RUBRIC_LEVELS = ['NA', 'AS', 'AN', 'AE'];

export const EVALUATION_TYPES = {
    COMPETENCIAL: 'competencial',
    NUMERICAL: 'numerical'
};

export const TERM_EVALUATION_METHODS = {
    WEIGHTED_AVERAGE: 'weighted_average',
    MAJORITY: 'majority'
};

export const COMPETENCIAL_LEVEL_ORDER = ['NP', 'NA', 'AS', 'AN', 'AE'];
const COMPETENCIAL_LEVELS_WITH_MINIMUMS = ['NA', 'AS', 'AN', 'AE'];

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
    learningActivityGuideVisible: false,
    learningActivityCriteriaModalOpen: false,
    pendingCompetencyHighlightId: null,
    activeLearningActivityRubricId: null,
    learningActivityRubricTab: 'configuration',
    learningActivityRubricFilter: '',
    evaluationActiveTab: 'activities',
    selectedEvaluationClassId: null,
    evaluationSelectedTermId: 'all',
    learningActivityRubricReturnView: null,
};

export function createDefaultEvaluationSettings() {
    return {
        type: EVALUATION_TYPES.COMPETENCIAL,
        competencial: {
            levelValues: {
                NP: 0,
                NA: 1,
                AS: 2,
                AN: 3,
                AE: 4
            },
            levelMinimums: {
                NA: 0,
                AS: 5,
                AN: 7,
                AE: 9
            },
            maxNotAchieved: {
                term: 0,
                course: 0
            },
            termEvaluationMethod: TERM_EVALUATION_METHODS.WEIGHTED_AVERAGE
        },
        numerical: {}
    };
}

export function normalizeEvaluationSettings(rawSettings) {
    const defaults = createDefaultEvaluationSettings();
    const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};

    const normalized = {
        type: Object.values(EVALUATION_TYPES).includes(settings.type)
            ? settings.type
            : defaults.type,
        competencial: { ...defaults.competencial },
        numerical: settings.numerical && typeof settings.numerical === 'object'
            ? { ...settings.numerical }
            : {}
    };

    const competencial = settings.competencial && typeof settings.competencial === 'object'
        ? settings.competencial
        : {};

    const levelValues = competencial.levelValues && typeof competencial.levelValues === 'object'
        ? competencial.levelValues
        : {};

    COMPETENCIAL_LEVEL_ORDER.forEach(level => {
        const value = parseFloat(levelValues[level]);
        normalized.competencial.levelValues[level] = Number.isFinite(value)
            ? value
            : defaults.competencial.levelValues[level];
    });

    const levelMinimums = competencial.levelMinimums && typeof competencial.levelMinimums === 'object'
        ? competencial.levelMinimums
        : {};

    COMPETENCIAL_LEVELS_WITH_MINIMUMS.forEach(level => {
        const value = parseFloat(levelMinimums[level]);
        if (level === 'NA') {
            normalized.competencial.levelMinimums[level] = 0;
            return;
        }
        normalized.competencial.levelMinimums[level] = Number.isFinite(value)
            ? value
            : defaults.competencial.levelMinimums[level];
    });

    const maxNotAchieved = competencial.maxNotAchieved && typeof competencial.maxNotAchieved === 'object'
        ? competencial.maxNotAchieved
        : {};

    const termMax = parseInt(maxNotAchieved.term, 10);
    const courseMax = parseInt(maxNotAchieved.course, 10);

    normalized.competencial.maxNotAchieved = {
        term: Number.isFinite(termMax) && termMax >= 0 ? termMax : defaults.competencial.maxNotAchieved.term,
        course: Number.isFinite(courseMax) && courseMax >= 0 ? courseMax : defaults.competencial.maxNotAchieved.course
    };

    normalized.competencial.termEvaluationMethod = Object.values(TERM_EVALUATION_METHODS).includes(competencial.termEvaluationMethod)
        ? competencial.termEvaluationMethod
        : defaults.competencial.termEvaluationMethod;

    if (settings && typeof settings === 'object') {
        settings.type = normalized.type;
        settings.competencial = normalized.competencial;
        settings.numerical = normalized.numerical;
        return settings;
    }

    return normalized;
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

export function calculateLearningActivityStatus(activity, referenceDate = new Date()) {
    if (!activity) {
        return LEARNING_ACTIVITY_STATUS.SCHEDULED;
    }

    if (activity.statusIsManual && Object.values(LEARNING_ACTIVITY_STATUS).includes(activity.status)) {
        return activity.status;
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
export function saveState() {
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
        settingsActiveTab: state.settingsActiveTab, // Guardar la pestaña activa
        studentTimelineFilter: state.studentTimelineFilter,
        evaluationActiveTab: state.evaluationActiveTab,
        selectedEvaluationClassId: state.selectedEvaluationClassId,
        evaluationSelectedTermId: state.evaluationSelectedTermId,
    };
    localStorage.setItem('teacherDashboardData', JSON.stringify(dataToSave));
    
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

export function loadState() {
    const savedData = localStorage.getItem('teacherDashboardData');
    if (savedData) {
        const parsedData = JSON.parse(savedData);
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
        state.settingsActiveTab = parsedData.settingsActiveTab || 'calendar'; // Cargar la pestaña activa
        state.studentTimelineFilter = parsedData.studentTimelineFilter || 'all';
        state.evaluationActiveTab = parsedData.evaluationActiveTab || 'activities';
        state.selectedEvaluationClassId = parsedData.selectedEvaluationClassId || null;
        state.evaluationSelectedTermId = parsedData.evaluationSelectedTermId || 'all';
    }

    state.activities.forEach(activity => {
        if (!activity.competencies) {
            activity.competencies = [];
        }

        activity.competencies.forEach(competency => {
            if (!competency.criteria) {
                competency.criteria = [];
            }
        });

        if (activity.type === 'class') {
            activity.evaluationSettings = normalizeEvaluationSettings(activity.evaluationSettings);
        }
    });

    state.learningActivityDraft = null;
    state.expandedLearningActivityClassIds = [];
    state.learningActivityGuideVisible = false;
    state.learningActivityCriteriaModalOpen = false;
    state.pendingCompetencyHighlightId = null;
    state.activeLearningActivityRubricId = null;
    state.learningActivityRubricTab = 'configuration';
}
