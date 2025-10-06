// state.js: Gestiona el estado global y la persistencia de datos.

const pastelColors = ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF'];

// El estado central de la aplicación.
export const LEARNING_ACTIVITY_STATUS = {
    SCHEDULED: 'scheduled',
    OPEN_SUBMISSIONS: 'open_submissions',
    PENDING_REVIEW: 'pending_review',
    CORRECTED: 'corrected'
};

export const RUBRIC_LEVELS = ['NP', 'NA', 'AS', 'AN', 'AE'];

export const EVALUATION_METHODS = {
    WEIGHTED: 'weighted',
    MAJORITY: 'majority'
};

export const DEFAULT_COMPETENCIAL_LEVEL_VALUES = {
    NP: 0,
    NA: 1,
    AS: 2,
    AN: 3,
    AE: 4
};

export const DEFAULT_COMPETENCIAL_MINIMUMS = {
    AS: 1.5,
    AN: 2.5,
    AE: 3.5
};

export const DEFAULT_MAX_NOT_ACHIEVED = {
    competencies: {
        term: 0,
        course: 0
    },
    criteria: {
        term: 0,
        course: 0
    }
};

export function createDefaultCompetencialConfig() {
    return {
        levelValues: { ...DEFAULT_COMPETENCIAL_LEVEL_VALUES },
        minimumThresholds: { ...DEFAULT_COMPETENCIAL_MINIMUMS },
        maxNotAchieved: {
            competencies: { ...DEFAULT_MAX_NOT_ACHIEVED.competencies },
            criteria: { ...DEFAULT_MAX_NOT_ACHIEVED.criteria }
        },
        termEvaluationMethod: EVALUATION_METHODS.WEIGHTED,
        globalEvaluation: {
            mode: 'term-average',
            competencyWeights: {}
        }
    };
}

export function createDefaultEvaluationSettings() {
    return {
        evaluationType: 'competencial',
        competencial: createDefaultCompetencialConfig()
    };
}

export function normalizeCompetencialConfig(rawConfig) {
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const levelValues = config.levelValues && typeof config.levelValues === 'object'
        ? { ...DEFAULT_COMPETENCIAL_LEVEL_VALUES, ...config.levelValues }
        : { ...DEFAULT_COMPETENCIAL_LEVEL_VALUES };

    Object.keys(DEFAULT_COMPETENCIAL_LEVEL_VALUES).forEach(level => {
        const value = levelValues[level];
        levelValues[level] = typeof value === 'number' && !Number.isNaN(value)
            ? value
            : DEFAULT_COMPETENCIAL_LEVEL_VALUES[level];
    });

    const minimumThresholds = config.minimumThresholds && typeof config.minimumThresholds === 'object'
        ? { ...DEFAULT_COMPETENCIAL_MINIMUMS, ...config.minimumThresholds }
        : { ...DEFAULT_COMPETENCIAL_MINIMUMS };

    Object.keys(DEFAULT_COMPETENCIAL_MINIMUMS).forEach(level => {
        const value = minimumThresholds[level];
        minimumThresholds[level] = typeof value === 'number' && !Number.isNaN(value)
            ? value
            : DEFAULT_COMPETENCIAL_MINIMUMS[level];
    });

    const maxNotAchieved = {
        competencies: { ...DEFAULT_MAX_NOT_ACHIEVED.competencies },
        criteria: { ...DEFAULT_MAX_NOT_ACHIEVED.criteria }
    };

    if (config.maxNotAchieved && typeof config.maxNotAchieved === 'object') {
        ['competencies', 'criteria'].forEach(group => {
            const groupValue = config.maxNotAchieved?.[group];
            if (groupValue && typeof groupValue === 'object') {
                ['term', 'course'].forEach(scope => {
                    const rawValue = groupValue?.[scope];
                    const parsed = parseInt(rawValue, 10);
                    maxNotAchieved[group][scope] = Number.isInteger(parsed) && parsed >= 0
                        ? parsed
                        : DEFAULT_MAX_NOT_ACHIEVED[group][scope];
                });
            }
        });
    }

    const method = config.termEvaluationMethod;
    const normalizedMethod = Object.values(EVALUATION_METHODS).includes(method)
        ? method
        : EVALUATION_METHODS.WEIGHTED;

    const rawGlobal = config.globalEvaluation && typeof config.globalEvaluation === 'object'
        ? config.globalEvaluation
        : {};

    const mode = rawGlobal.mode === 'course-competencies' ? 'course-competencies' : 'term-average';
    const competencyWeights = {};
    if (rawGlobal.competencyWeights && typeof rawGlobal.competencyWeights === 'object') {
        Object.entries(rawGlobal.competencyWeights).forEach(([competencyId, weight]) => {
            const parsed = parseFloat(weight);
            if (typeof competencyId === 'string' && competencyId && Number.isFinite(parsed) && parsed >= 0) {
                competencyWeights[competencyId] = parsed;
            }
        });
    }

    return {
        levelValues,
        minimumThresholds,
        maxNotAchieved,
        termEvaluationMethod: normalizedMethod,
        globalEvaluation: {
            mode,
            competencyWeights
        }
    };
}

export function normalizeEvaluationSettings(rawSettings) {
    const settings = rawSettings && typeof rawSettings === 'object'
        ? rawSettings
        : createDefaultEvaluationSettings();

    const evaluationType = settings.evaluationType === 'numerica'
        ? 'numerica'
        : 'competencial';

    return {
        evaluationType,
        competencial: normalizeCompetencialConfig(settings.competencial)
    };
}

export function ensureEvaluationSettingsForClass(classId) {
    if (!classId) return createDefaultEvaluationSettings();
    if (!state.evaluationSettings[classId]) {
        state.evaluationSettings[classId] = createDefaultEvaluationSettings();
    } else {
        state.evaluationSettings[classId] = normalizeEvaluationSettings(state.evaluationSettings[classId]);
    }
    return state.evaluationSettings[classId];
}

export function getEvaluationSettingsForClass(classId) {
    return ensureEvaluationSettingsForClass(classId);
}

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
    evaluationSelectedTermId: 'global',
    evaluationSettings: {},
    evaluationResults: {},
    learningActivityRubricReturnView: null,
};

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
            const type = item?.type === 'section' ? 'section' : 'criterion';
            const id = item?.id || generateId('rubric-item');

            if (type === 'section') {
                return {
                    id,
                    type: 'section',
                    sectionTitle: typeof item?.sectionTitle === 'string' ? item.sectionTitle : '',
                };
            }

            const levelComments = item?.levelComments && typeof item.levelComments === 'object'
                ? item.levelComments
                : {};
            const normalizedComments = {};
            RUBRIC_LEVELS.forEach(level => {
                normalizedComments[level] = typeof levelComments[level] === 'string' ? levelComments[level] : '';
            });

            return {
                id,
                type: 'criterion',
                competencyId: item?.competencyId || '',
                criterionId: item?.criterionId || '',
                weight: typeof item?.weight === 'number' && !Number.isNaN(item.weight) ? item.weight : 1,
                levelComments: normalizedComments,
                generalGuidance: typeof item?.generalGuidance === 'string' ? item.generalGuidance : '',
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
    if (!activity) return [];
    const classId = activity.classId;
    const classData = classId
        ? state.activities.find(entry => entry.id === classId && entry.type === 'class')
        : null;
    const classStudentIds = Array.isArray(classData?.studentIds) ? classData.studentIds : [];
    const activityStudentIds = Array.isArray(activity.studentIds) ? activity.studentIds : [];
    const uniqueIds = new Set([...classStudentIds, ...activityStudentIds]);
    uniqueIds.delete(undefined);
    uniqueIds.delete(null);
    uniqueIds.delete('');
    return Array.from(uniqueIds);
}

function hasStudentCompleteEvaluation(rubric, studentId, requiredItemIds) {
    if (!studentId || !rubric) return false;
    const evaluations = rubric.evaluations && typeof rubric.evaluations === 'object'
        ? rubric.evaluations
        : {};
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

    if (!Array.isArray(requiredItemIds) || requiredItemIds.length === 0) {
        return false;
    }

    const scores = evaluation.scores && typeof evaluation.scores === 'object'
        ? evaluation.scores
        : {};

    return requiredItemIds.every(itemId => {
        const value = scores[itemId];
        return typeof value === 'string' && value.trim().length > 0;
    });
}

export function isLearningActivityFullyAssessed(activity) {
    if (!activity) return false;

    const studentsToEvaluate = getLearningActivityStudentIds(activity);
    if (studentsToEvaluate.length === 0) {
        return false;
    }

    const rubric = activity.rubric && typeof activity.rubric === 'object'
        ? activity.rubric
        : null;
    const rubricItems = Array.isArray(rubric?.items)
        ? rubric.items.filter(item => item && typeof item.id === 'string' && item.id.length > 0)
        : [];

    if (rubricItems.length === 0) {
        return false;
    }

    const requiredItemIds = rubricItems.map(item => item.id);

    return studentsToEvaluate.every(studentId =>
        hasStudentCompleteEvaluation(rubric, studentId, requiredItemIds)
    );
}

export function calculateLearningActivityStatus(activity, referenceDate = new Date()) {
    if (!activity) {
        return LEARNING_ACTIVITY_STATUS.SCHEDULED;
    }

    if (isLearningActivityFullyAssessed(activity)) {
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
    if (existingStatus && !Object.values(LEARNING_ACTIVITY_STATUS).includes(existingStatus)) {
        return existingStatus;
    }

    return LEARNING_ACTIVITY_STATUS.SCHEDULED;
}

export function recalculateLearningActivityStatus(activity, referenceDate = new Date()) {
    const status = calculateLearningActivityStatus(activity, referenceDate);
    if (activity && activity.status !== status) {
        activity.status = status;
    }
    return status;
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
        evaluationSettings: state.evaluationSettings,
        evaluationResults: state.evaluationResults,
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
                weight: typeof activity?.weight === 'number' && !Number.isNaN(activity.weight) ? activity.weight : 1,
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
        const savedEvaluationTerm = parsedData.evaluationSelectedTermId;
        state.evaluationSelectedTermId = savedEvaluationTerm === 'all'
            ? 'global'
            : (savedEvaluationTerm || 'global');
        state.evaluationSettings = parsedData.evaluationSettings || {};
        state.evaluationResults = parsedData.evaluationResults || {};
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
    });

    Object.keys(state.evaluationSettings).forEach(classId => {
        state.evaluationSettings[classId] = normalizeEvaluationSettings(state.evaluationSettings[classId]);
    });

    state.activities
        .filter(activity => activity.type === 'class')
        .forEach(activity => ensureEvaluationSettingsForClass(activity.id));

    Object.entries(state.evaluationResults || {}).forEach(([classId, perClass]) => {
        if (!state.evaluationSettings[classId]) {
            delete state.evaluationResults[classId];
            return;
        }
        if (perClass && typeof perClass === 'object' && perClass.all && !perClass.global) {
            perClass.global = perClass.all;
            delete perClass.all;
        }
        Object.entries(perClass || {}).forEach(([termId, snapshot]) => {
            if (!snapshot || typeof snapshot !== 'object') {
                delete perClass[termId];
                return;
            }
            if (!snapshot.overrides || typeof snapshot.overrides !== 'object') {
                snapshot.overrides = { final: {} };
            }
            if (!snapshot.overrides.final || typeof snapshot.overrides.final !== 'object') {
                snapshot.overrides.final = {};
            }
            Object.values(snapshot.overrides.final).forEach(entry => {
                if (entry && typeof entry === 'object' && typeof entry.comment !== 'string') {
                    entry.comment = '';
                }
            });
        });
    });

    state.learningActivityDraft = null;
    state.expandedLearningActivityClassIds = [];
    state.learningActivityGuideVisible = false;
    state.learningActivityCriteriaModalOpen = false;
    state.pendingCompetencyHighlightId = null;
    state.activeLearningActivityRubricId = null;
    state.learningActivityRubricTab = 'configuration';
}
