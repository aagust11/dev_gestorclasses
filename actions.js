// actions.js: Define toda la lógica de las acciones del usuario.

import {
    state,
    saveState,
    getRandomPastelColor,
    LEARNING_ACTIVITY_STATUS,
    calculateLearningActivityStatus,
    createEmptyRubric,
    normalizeRubric,
    RUBRIC_LEVELS,
    ensureEvaluationSettingsForClass,
    normalizeEvaluationSettings,
    recalculateLearningActivityStatus
} from './state.js';
import { computeClassTermEvaluation, computeClassGlobalEvaluation } from './evaluation.js';
import { showModal, showInfoModal, findNextClassSession, getCurrentTermDateRange, STUDENT_ATTENDANCE_STATUS, createEmptyStudentAnnotation, normalizeStudentAnnotation, showTextInputModal, formatDate } from './utils.js';
import { t } from './i18n.js';

function generateRubricItemId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const random = Math.random().toString(16).slice(2, 10);
    return `rubric-item-${Date.now()}-${random}`;
}

function ensureLearningActivityRubric(activity) {
    if (!activity) return null;
    if (!activity.rubric) {
        activity.rubric = createEmptyRubric();
    } else {
        activity.rubric = normalizeRubric(activity.rubric);
    }
    return activity.rubric;
}

function ensureRubricEvaluation(rubric, studentId) {
    if (!rubric || !studentId) return null;
    if (!rubric.evaluations[studentId]) {
        rubric.evaluations[studentId] = {
            scores: {},
            comment: '',
            flags: { notPresented: false, deliveredLate: false }
        };
    } else {
        const evaluation = rubric.evaluations[studentId];
        if (!evaluation.scores || typeof evaluation.scores !== 'object') {
            evaluation.scores = {};
        }
        if (typeof evaluation.comment !== 'string') {
            evaluation.comment = '';
        }
        if (!evaluation.flags || typeof evaluation.flags !== 'object') {
            evaluation.flags = { notPresented: false, deliveredLate: false };
        } else {
            evaluation.flags.notPresented = Boolean(evaluation.flags.notPresented);
            evaluation.flags.deliveredLate = Boolean(evaluation.flags.deliveredLate);
        }
    }
    return rubric.evaluations[studentId];
}

function createDefaultLevelComments() {
    const comments = {};
    RUBRIC_LEVELS.forEach(level => {
        comments[level] = '';
    });
    return comments;
}

function makeCriterionKey(competencyId = '', criterionId = '') {
    return `${competencyId}|||${criterionId}`;
}

function ensureActivityHasCriterionRef(activity, competencyId, criterionId) {
    if (!activity) return false;
    if (!Array.isArray(activity.criteriaRefs)) {
        activity.criteriaRefs = [];
    }

    const exists = activity.criteriaRefs.some(ref =>
        ref.competencyId === competencyId && ref.criterionId === criterionId
    );

    if (!exists) {
        activity.criteriaRefs.push({ competencyId, criterionId });
        return true;
    }

    return false;
}

function removeCriterionRefFromActivity(activity, competencyId, criterionId) {
    if (!activity) return false;
    if (!Array.isArray(activity.criteriaRefs)) {
        activity.criteriaRefs = [];
        return false;
    }

    const originalLength = activity.criteriaRefs.length;
    activity.criteriaRefs = activity.criteriaRefs.filter(ref =>
        !(ref.competencyId === competencyId && ref.criterionId === criterionId)
    );

    return originalLength !== activity.criteriaRefs.length;
}

function cleanRubricEvaluations(rubric, removedItemIds = []) {
    if (!rubric || !Array.isArray(removedItemIds) || removedItemIds.length === 0) {
        return;
    }

    const evaluations = rubric.evaluations;
    if (!evaluations || typeof evaluations !== 'object') {
        return;
    }

    Object.values(evaluations).forEach(evaluation => {
        if (!evaluation || typeof evaluation !== 'object') {
            return;
        }
        const scores = evaluation.scores;
        if (!scores || typeof scores !== 'object') {
            return;
        }
        removedItemIds.forEach(itemId => {
            if (itemId in scores) {
                delete scores[itemId];
            }
        });
    });
}

function ensureRubricHasItemForCriterion(rubric, competencyId, criterionId) {
    if (!rubric) return null;

    const exists = Array.isArray(rubric.items)
        ? rubric.items.some(item => item.type !== 'section' && item.competencyId === competencyId && item.criterionId === criterionId)
        : false;

    if (exists) {
        return null;
    }

    const newItem = {
        id: generateRubricItemId(),
        type: 'criterion',
        competencyId,
        criterionId,
        weight: 1,
        levelComments: createDefaultLevelComments(),
        generalGuidance: '',
    };

    rubric.items.push(newItem);
    return newItem;
}

function removeRubricItemsForCriterion(rubric, competencyId, criterionId) {
    if (!rubric || !Array.isArray(rubric.items)) {
        return [];
    }

    const removedIds = [];
    rubric.items = rubric.items.filter(item => {
        const matches = item.type !== 'section' && item.competencyId === competencyId && item.criterionId === criterionId;
        if (matches) {
            removedIds.push(item.id);
        }
        return !matches;
    });

    cleanRubricEvaluations(rubric, removedIds);
    return removedIds;
}

function getEvaluationTermKey(termId) {
    if (!termId || termId === 'all') {
        return 'global';
    }
    return termId;
}

function ensureEvaluationResultSnapshot(classId, termId = 'global') {
    if (!classId) return null;
    const key = getEvaluationTermKey(termId);
    if (!state.evaluationResults[classId]) {
        state.evaluationResults[classId] = {};
    }
    if (!state.evaluationResults[classId][key]) {
        state.evaluationResults[classId][key] = {
            computedAt: null,
            data: null,
            overrides: { final: {} }
        };
    } else {
        const snapshot = state.evaluationResults[classId][key];
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
    }
    return state.evaluationResults[classId][key];
}

function getTermRangeById(termId) {
    if (!termId || termId === 'all' || termId === 'global') {
        return null;
    }
    const term = state.terms.find(entry => entry.id === termId);
    if (!term) {
        return null;
    }
    const start = new Date(`${term.startDate}T00:00:00`);
    const end = new Date(`${term.endDate}T23:59:59`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
    }
    return { start, end };
}

function syncRubricWithActivityCriteria(activity) {
    if (!activity) return;

    const rubric = ensureLearningActivityRubric(activity);
    if (!Array.isArray(activity.criteriaRefs)) {
        activity.criteriaRefs = [];
    }

    const assignedKeys = new Set(activity.criteriaRefs.map(ref => makeCriterionKey(ref.competencyId, ref.criterionId)));

    if (Array.isArray(rubric.items)) {
        rubric.items.forEach(item => {
            if (item.type === 'section') {
                return;
            }
            const key = makeCriterionKey(item.competencyId, item.criterionId);
            if (!assignedKeys.has(key)) {
                ensureActivityHasCriterionRef(activity, item.competencyId, item.criterionId);
                assignedKeys.add(key);
            }
        });
    }

    activity.criteriaRefs.forEach(ref => {
        ensureRubricHasItemForCriterion(rubric, ref.competencyId, ref.criterionId);
    });
}

function escapeRegExp(str) {
    return str.replace(/[-/\^$*+?.()|[\]{}]/g, '\$&');
}

function getCompetencyBaseIdentifier(code) {
    if (typeof code !== 'string') {
        return '';
    }

    let trimmedCode = code.trim();
    if (!trimmedCode) {
        return '';
    }

    if (trimmedCode.toUpperCase().startsWith('CE')) {
        trimmedCode = trimmedCode.slice(2);
    }

    return trimmedCode.replace(/^[-_.\s]+/, '').trim();
}

function getNextCriterionCode(competency) {
    const baseIdentifier = getCompetencyBaseIdentifier(competency?.code);
    const criteria = Array.isArray(competency?.criteria) ? competency.criteria : [];

    let maxIndex = 0;
    const pattern = baseIdentifier ? new RegExp(`^CA${escapeRegExp(baseIdentifier)}\\.(\\d+)$`, 'i') : null;

    criteria.forEach(criterion => {
        if (!criterion?.code) {
            return;
        }

        const code = criterion.code.trim();
        if (!code) {
            return;
        }

        let match = pattern ? code.match(pattern) : null;
        if (!match) {
            match = code.match(/\.([0-9]+)$/) || code.match(/([0-9]+)$/);
        }

        if (match && match[1]) {
            const value = parseInt(match[1], 10);
            if (!Number.isNaN(value)) {
                maxIndex = Math.max(maxIndex, value);
            }
        }
    });

    const nextIndex = (maxIndex || 0) + 1;

    if (baseIdentifier) {
        return `CA${baseIdentifier}.${nextIndex}`;
    }

    return `CA${nextIndex}`;
}

function getNextCompetencyCode(activity) {
    const competencies = Array.isArray(activity?.competencies) ? activity.competencies : [];

    let defaultPrefix = '';
    let maxNumber = 0;
    let maxDigits = 2;

    competencies.forEach(competency => {
        const code = competency?.code;
        if (typeof code !== 'string') {
            return;
        }

        const trimmed = code.trim();
        if (!trimmed) {
            return;
        }

        const baseIdentifier = getCompetencyBaseIdentifier(trimmed);
        if (baseIdentifier) {
            const match = baseIdentifier.match(/^(.*?)(\d+)$/);
            if (match) {
                const [, prefix, digits] = match;
                const value = parseInt(digits, 10);
                if (!Number.isNaN(value)) {
                    if (value >= maxNumber) {
                        defaultPrefix = prefix;
                    }
                    maxNumber = Math.max(maxNumber, value);
                    maxDigits = Math.max(maxDigits, digits.length);
                    return;
                }
            }

            if (!defaultPrefix) {
                defaultPrefix = baseIdentifier;
            }
        }

        const trailingDigitsMatch = trimmed.match(/^(CE.*?)(\d+)$/i);
        if (trailingDigitsMatch) {
            const [, prefixWithCe, digits] = trailingDigitsMatch;
            const value = parseInt(digits, 10);
            if (!Number.isNaN(value)) {
                const prefix = prefixWithCe.replace(/^CE/i, '');
                if (value >= maxNumber) {
                    defaultPrefix = prefix;
                }
                maxNumber = Math.max(maxNumber, value);
                maxDigits = Math.max(maxDigits, digits.length);
            }
        }
    });

    const nextNumber = (maxNumber || 0) + 1;
    const padded = String(nextNumber).padStart(maxDigits, '0');
    const prefix = defaultPrefix || '';
    return `CE${prefix}${padded}`;
}

function computeDefaultEndDate(startDateString) {
    if (!startDateString) {
        return '';
    }

    const startDate = new Date(startDateString + 'T00:00:00');
    if (Number.isNaN(startDate.getTime())) {
        return '';
    }

    startDate.setDate(startDate.getDate() + 6);
    return formatDate(startDate);
}

function showImportSummary(data) {
    const title = t('import_summary_title');
    const content = `
        <ul class="list-disc list-inside space-y-2 text-left">
            <li><strong>${t('import_summary_activities')}:</strong> ${data.activities?.length || 0}</li>
            <li><strong>${t('import_summary_students')}:</strong> ${data.students?.length || 0}</li>
            <li><strong>${t('import_summary_timeslots')}:</strong> ${data.timeSlots?.length || 0}</li>
            <li><strong>${t('import_summary_entries')}:</strong> ${Object.keys(data.classEntries || {}).length}</li>
        </ul>
    `;
    showInfoModal(title, content, () => {
        window.location.reload();
    });
}

function ensureClassEntry(entryId) {
    if (!state.classEntries[entryId]) {
        state.classEntries[entryId] = { planned: '', completed: '', annotations: {} };
    }

    if (!state.classEntries[entryId].annotations) {
        state.classEntries[entryId].annotations = {};
    }

    return state.classEntries[entryId];
}

function ensureStudentAnnotation(entry, studentId, entryId = null) {
    if (!entry.annotations[studentId]) {
        entry.annotations[studentId] = createEmptyStudentAnnotation();
        return entry.annotations[studentId];
    }

    if (typeof entry.annotations[studentId] === 'string' || typeof entry.annotations[studentId] === 'object') {
        entry.annotations[studentId] = normalizeStudentAnnotation(entry.annotations[studentId], entryId);
        return entry.annotations[studentId];
    }

    const current = entry.annotations[studentId];
    current.attendance = current.attendance || null;
    current.positives = Array.isArray(current.positives) ? current.positives : [];
    current.incidents = Array.isArray(current.incidents) ? current.incidents : [];
    current.comments = Array.isArray(current.comments) ? current.comments : [];
    return current;
}

function createAnnotationRecord(content, entryId) {
    return {
        id: crypto.randomUUID(),
        content,
        createdAt: new Date().toISOString(),
        entryId
    };
}

function handleRecordEdit(array, recordId, result) {
    if (!result || !recordId) return false;

    if (result.action === 'delete') {
        const next = array.filter(record => record.id !== recordId);
        if (next.length !== array.length) {
            array.splice(0, array.length, ...next);
            return true;
        }
        return false;
    }

    if (result.action === 'confirm') {
        if (!result.value) {
            const next = array.filter(record => record.id !== recordId);
            if (next.length !== array.length) {
                array.splice(0, array.length, ...next);
                return true;
            }
            return false;
        }

        const record = array.find(item => item.id === recordId);
        if (record && record.content !== result.value) {
            record.content = result.value;
            return true;
        }
    }

    return false;
}

export const actionHandlers = {
    // --- Settings Tab Action ---
    'select-settings-tab': (id, element) => {
        const tabId = element.dataset.tabId;
        if (tabId) {
            state.settingsActiveTab = tabId;
            // No es necesario saveState() aquí, se guarda al renderizar
        }
    },

    'set-evaluation-tab': (id, element) => {
        const tab = element?.dataset?.tab;
        const allowedTabs = ['activities', 'grades', 'term-grades'];
        if (!tab || !allowedTabs.includes(tab)) return;
        state.evaluationActiveTab = tab;

        if (tab === 'grades') {
            const classes = state.activities
                .filter(activity => activity.type === 'class')
                .sort((a, b) => a.name.localeCompare(b.name));
            const hasSelection = classes.some(cls => cls.id === state.selectedEvaluationClassId);
            if (!hasSelection) {
                state.selectedEvaluationClassId = classes[0]?.id || null;
            }
        }
        if (tab === 'term-grades' && state.selectedEvaluationClassId) {
            ensureEvaluationSettingsForClass(state.selectedEvaluationClassId);
        }
    },

    'select-evaluation-class': (id, element) => {
        const classId = element?.dataset?.classId;
        if (classId) {
            state.selectedEvaluationClassId = classId;
            ensureEvaluationSettingsForClass(classId);
        }
    },
    'set-evaluation-term': (id, element) => {
        const value = element?.value || element?.dataset?.termId;
        if (!value || value === 'all' || value === 'global') {
            state.evaluationSelectedTermId = 'global';
        } else {
            state.evaluationSelectedTermId = value;
        }
    },
    'update-evaluation-setting': (id, element) => {
        const classId = element?.dataset?.classId;
        if (!classId) return;
        const current = ensureEvaluationSettingsForClass(classId);
        const section = element?.dataset?.section || 'root';
        const field = element?.dataset?.field;
        let hasChanges = false;

        if (section === 'root' && field === 'evaluationType') {
            const value = element?.value === 'numerica' ? 'numerica' : 'competencial';
            if (current.evaluationType !== value) {
                current.evaluationType = value;
                hasChanges = true;
            }
        } else if (section === 'competencial') {
            if (!current.competencial.globalEvaluation) {
                current.competencial.globalEvaluation = {
                    mode: 'term-average',
                    competencyWeights: {}
                };
            }
            if (field === 'termEvaluationMethod') {
                const value = element?.value === 'majority' ? 'majority' : 'weighted';
                if (current.competencial.termEvaluationMethod !== value) {
                    current.competencial.termEvaluationMethod = value;
                    hasChanges = true;
                }
            } else if (field === 'levelValues') {
                const level = element?.dataset?.level;
                if (level && Object.prototype.hasOwnProperty.call(current.competencial.levelValues, level)) {
                    const parsed = parseFloat(element.value);
                    const nextValue = Number.isFinite(parsed) ? parsed : current.competencial.levelValues[level];
                    if (current.competencial.levelValues[level] !== nextValue) {
                        current.competencial.levelValues[level] = nextValue;
                        hasChanges = true;
                    }
                }
            } else if (field === 'thresholds') {
                const level = element?.dataset?.level;
                if (level && Object.prototype.hasOwnProperty.call(current.competencial.minimumThresholds, level)) {
                    const parsed = parseFloat(element.value);
                    const nextValue = Number.isFinite(parsed) ? parsed : current.competencial.minimumThresholds[level];
                    if (current.competencial.minimumThresholds[level] !== nextValue) {
                        current.competencial.minimumThresholds[level] = nextValue;
                        hasChanges = true;
                    }
                }
            } else if (field === 'maxNotAchieved') {
                const group = element?.dataset?.group;
                const scope = element?.dataset?.scope;
                if (group && scope && current.competencial.maxNotAchieved[group] && Object.prototype.hasOwnProperty.call(current.competencial.maxNotAchieved[group], scope)) {
                    const parsed = parseInt(element.value, 10);
                    const nextValue = Number.isInteger(parsed) && parsed >= 0 ? parsed : current.competencial.maxNotAchieved[group][scope];
                    if (current.competencial.maxNotAchieved[group][scope] !== nextValue) {
                        current.competencial.maxNotAchieved[group][scope] = nextValue;
                        hasChanges = true;
                    }
                }
            } else if (field === 'globalEvaluationMode') {
                const value = element?.value === 'course-competencies' ? 'course-competencies' : 'term-average';
                if (current.competencial.globalEvaluation.mode !== value) {
                    current.competencial.globalEvaluation.mode = value;
                    hasChanges = true;
                }
            } else if (field === 'globalCompetencyWeight') {
                const competencyId = element?.dataset?.competencyId;
                if (competencyId) {
                    const parsed = parseFloat(element.value);
                    const nextValue = Number.isFinite(parsed) && parsed >= 0 ? parsed : (current.competencial.globalEvaluation.competencyWeights[competencyId] ?? 0);
                    if (current.competencial.globalEvaluation.competencyWeights[competencyId] !== nextValue) {
                        current.competencial.globalEvaluation.competencyWeights[competencyId] = nextValue;
                        hasChanges = true;
                    }
                }
            }
        }

        if (hasChanges) {
            state.evaluationSettings[classId] = normalizeEvaluationSettings(current);
            delete state.evaluationResults[classId];
            saveState();
        }
    },
    'calculate-term-grades': (id, element) => {
        const classId = element?.dataset?.classId || state.selectedEvaluationClassId;
        if (!classId) return;
        const classData = state.activities.find(activity => activity.id === classId && activity.type === 'class');
        if (!classData) return;
        const settings = ensureEvaluationSettingsForClass(classId);
        const termId = state.evaluationSelectedTermId || 'global';
        const studentIds = Array.isArray(classData.studentIds) ? classData.studentIds : [];
        const students = state.students.filter(student => studentIds.includes(student.id));
        let result;
        if (termId === 'global') {
            result = computeClassGlobalEvaluation({
                classData,
                students,
                learningActivities: state.learningActivities,
                settings,
                terms: state.terms
            });
        } else {
            const termRange = getTermRangeById(termId);
            result = computeClassTermEvaluation({
                classData,
                students,
                learningActivities: state.learningActivities,
                termRange,
                settings,
            });
        }
        const snapshot = ensureEvaluationResultSnapshot(classId, termId);
        if (!snapshot) return;
        snapshot.data = result;
        snapshot.computedAt = new Date().toISOString();
        snapshot.termId = getEvaluationTermKey(termId);
        saveState();
    },
    'update-term-grade-override': (id, element) => {
        const classId = element?.dataset?.classId;
        const studentId = element?.dataset?.studentId;
        const field = element?.dataset?.field;
        if (!classId || !studentId || !field) return;
        const termId = element?.dataset?.termId || state.evaluationSelectedTermId || 'global';
        const snapshot = ensureEvaluationResultSnapshot(classId, termId);
        if (!snapshot) return;
        const overrides = snapshot.overrides?.final || {};
        snapshot.overrides.final = overrides;
        if (!overrides[studentId]) {
            overrides[studentId] = { numeric: null, qualitative: '', comment: '' };
        } else if (typeof overrides[studentId].comment !== 'string') {
            overrides[studentId].comment = '';
        }
        let changed = false;
        if (field === 'numeric') {
            const raw = element.value;
            if (raw === '') {
                if (overrides[studentId].numeric !== null) {
                    overrides[studentId].numeric = null;
                    changed = true;
                }
            } else {
                const parsed = parseFloat(raw);
                if (Number.isFinite(parsed)) {
                    if (overrides[studentId].numeric !== parsed) {
                        overrides[studentId].numeric = parsed;
                        changed = true;
                    }
                }
            }
        } else if (field === 'qualitative') {
            const value = element.value;
            const nextValue = RUBRIC_LEVELS.includes(value) ? value : '';
            if (overrides[studentId].qualitative !== nextValue) {
                overrides[studentId].qualitative = nextValue;
                changed = true;
            }
        } else if (field === 'comment') {
            const value = typeof element.value === 'string' ? element.value : '';
            if (overrides[studentId].comment !== value) {
                overrides[studentId].comment = value;
                changed = true;
            }
        }

        const overrideEntry = overrides[studentId];
        const numericEmpty = overrideEntry.numeric === null || Number.isNaN(overrideEntry.numeric);
        const qualitativeEmpty = !overrideEntry.qualitative || overrideEntry.qualitative === '';
        const commentEmpty = !overrideEntry.comment || overrideEntry.comment.trim() === '';
        if (numericEmpty && qualitativeEmpty && commentEmpty) {
            delete overrides[studentId];
            changed = true;
        }
        if (changed) {
            saveState();
        }
        return { shouldRerender: field !== 'comment' && changed };
    },

    // --- Load Example Action ---
    'load-example': () => {
        showModal(t('import_data_confirm_title'), t('import_data_confirm_text'), async () => {
            try {
                // --- INICIO DEL CÓDIGO MODIFICADO ---

                // 1. Obtener el idioma actual de la etiqueta <html lang="...">
                const lang = document.documentElement.lang || 'es';

                // 2. Construir la URL del archivo JSON para el idioma detectado.
                const url = `https://raw.githubusercontent.com/jjdeharo/gist/refs/heads/main/diario/demo/${lang}.json`;
                
                let response = await fetch(url);

                // 3. Si el archivo del idioma específico no se encuentra, intentar cargar el de español como alternativa.
                if (!response.ok) {
                    console.warn(`No se pudo cargar ${url}, se usará la versión en español.`);
                    response = await fetch('https://raw.githubusercontent.com/jjdeharo/gist/refs/heads/main/diario/demo/es.json');
                }

                // --- FIN DEL CÓDIGO MODIFICADO ---

                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const data = await response.json();
                state.activities = data.activities || [];
                state.learningActivities = (data.learningActivities || []).map(activity => ({
                    ...activity,
                    criteriaRefs: Array.isArray(activity?.criteriaRefs) ? activity.criteriaRefs : [],
                    createdAt: activity?.createdAt || new Date().toISOString(),
                    updatedAt: activity?.updatedAt || activity?.createdAt || new Date().toISOString(),
                    startDate: activity?.startDate || '',
                    endDate: activity?.endDate || '',
                    weight: typeof activity?.weight === 'number' && !Number.isNaN(activity.weight) ? activity.weight : 1,
                    status: activity?.status || LEARNING_ACTIVITY_STATUS.SCHEDULED,
                }));
                state.students = data.students || [];
                state.timeSlots = data.timeSlots || [];
                state.schedule = data.schedule || {};
                state.scheduleOverrides = data.scheduleOverrides || [];
                state.classEntries = data.classEntries || {};
                state.courseStartDate = data.courseStartDate || '';
                state.courseEndDate = data.courseEndDate || '';
                state.terms = data.terms || [];
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
                state.evaluationSettings = {};
                state.evaluationResults = {};
                state.evaluationSelectedTermId = 'all';

                state.activities
                    .filter(activity => activity.type === 'class')
                    .forEach(activity => {
                        ensureEvaluationSettingsForClass(activity.id);
                    });

                state.learningActivities.forEach(activity => {
                    syncRubricWithActivityCriteria(activity);
                });
                saveState();
                showImportSummary(data);
            } catch (error) {
                console.error('Error loading example data:', error);
                alert(t('import_error_alert'));
            }
        });
    },

    'go-to-class-card': (id, element) => {
        const activityId = element.value;
        if (activityId) {
            const card = document.getElementById(`class-card-${activityId}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.transition = 'outline 0.1s ease-in-out';
                card.style.outline = '3px solid #3b82f6';
                setTimeout(() => {
                    card.style.outline = 'none';
                }, 1500);
            }
        }
    },
    'go-to-competency-card': (id, element) => {
        const activityId = element.value;
        if (activityId) {
            const card = document.getElementById(`competency-card-${activityId}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.transition = 'outline 0.1s ease-in-out';
                card.style.outline = '3px solid #3b82f6';
                setTimeout(() => {
                    card.style.outline = 'none';
                }, 1500);
            }
        }
    },
    'open-learning-activity-editor': (id, element) => {
        const classId = element.dataset.classId;
        if (!classId) return;

        const targetClass = state.activities.find(a => a.id === classId);
        if (!targetClass) return;

        const activityId = element.dataset.learningActivityId;
            if (activityId) {
                const existing = state.learningActivities.find(act => act.id === activityId);
                if (!existing) return;

                syncRubricWithActivityCriteria(existing);
                saveState();

                state.learningActivityDraft = {
                    ...existing,
                    criteriaRefs: Array.isArray(existing.criteriaRefs) ? [...existing.criteriaRefs] : [],
                    isNew: false,
                    startDate: existing.startDate || '',
                    endDate: existing.endDate || '',
                    rubric: normalizeRubric(existing?.rubric),
                    status: existing?.status || LEARNING_ACTIVITY_STATUS.SCHEDULED,
                    weight: typeof existing?.weight === 'number' && !Number.isNaN(existing.weight) ? existing.weight : 1,
                    statusManuallySet: true,
                };
                syncRubricWithActivityCriteria(state.learningActivityDraft);
            } else {
                state.learningActivityDraft = {
                    id: crypto.randomUUID(),
                    classId,
                    title: '',
                    description: '',
                    criteriaRefs: [],
                    isNew: true,
                    startDate: '',
                    endDate: '',
                    rubric: createEmptyRubric(),
                    status: LEARNING_ACTIVITY_STATUS.SCHEDULED,
                    weight: 1,
                    statusManuallySet: false,
                };
                syncRubricWithActivityCriteria(state.learningActivityDraft);
            }

        const todayString = formatDate(new Date());
        if (!state.learningActivityDraft.startDate) {
            state.learningActivityDraft.startDate = todayString;
        }
        if (!state.learningActivityDraft.endDate) {
            state.learningActivityDraft.endDate = computeDefaultEndDate(state.learningActivityDraft.startDate);
        }

        if (!state.learningActivityDraft.statusManuallySet) {
            state.learningActivityDraft.status = calculateLearningActivityStatus(state.learningActivityDraft);
        }

        state.learningActivityGuideVisible = false;
        state.learningActivityCriteriaModalOpen = false;
        state.pendingCompetencyHighlightId = null;
        state.activeView = 'learningActivityEditor';
    },
    'open-learning-activity-quick': () => {
        const selectEl = document.getElementById('activities-quick-nav');
        if (!selectEl) return;
        const classId = selectEl.value;
        if (!classId) return;

        const targetClass = state.activities.find(a => a.id === classId);
        if (!targetClass) return;

        state.learningActivityDraft = {
            id: crypto.randomUUID(),
            classId,
            title: '',
            description: '',
            criteriaRefs: [],
            isNew: true,
            startDate: '',
            endDate: '',
            rubric: createEmptyRubric(),
            status: LEARNING_ACTIVITY_STATUS.SCHEDULED,
            weight: 1,
            statusManuallySet: false,
        };
        syncRubricWithActivityCriteria(state.learningActivityDraft);

        const todayString = formatDate(new Date());
        state.learningActivityDraft.startDate = todayString;
        state.learningActivityDraft.endDate = computeDefaultEndDate(todayString);
        if (!state.learningActivityDraft.statusManuallySet) {
            state.learningActivityDraft.status = calculateLearningActivityStatus(state.learningActivityDraft);
        }

        state.learningActivityGuideVisible = false;
        state.learningActivityCriteriaModalOpen = false;
        state.pendingCompetencyHighlightId = null;
        state.activeView = 'learningActivityEditor';
    },
    'back-to-activities': () => {
        state.learningActivityDraft = null;
        state.learningActivityGuideVisible = false;
        state.learningActivityCriteriaModalOpen = false;
        state.pendingCompetencyHighlightId = null;
        state.activeLearningActivityRubricId = null;
        state.learningActivityRubricTab = 'configuration';
        state.activeView = 'activities';
    },
    'update-learning-activity-title': (id, element) => {
        if (!state.learningActivityDraft) return;
        state.learningActivityDraft.title = element.value;
    },
    'update-learning-activity-description': (id, element) => {
        if (!state.learningActivityDraft) return;
        state.learningActivityDraft.description = element.value;
    },
    'update-learning-activity-start-date': (id, element) => {
        if (!state.learningActivityDraft) return;
        const value = element.value;
        state.learningActivityDraft.startDate = value;

        const endInput = document.getElementById('learning-activity-end-date');

        if (!value) {
            state.learningActivityDraft.endDate = '';
            if (endInput) {
                endInput.value = '';
            }
            return;
        }

        const computedEnd = computeDefaultEndDate(value);
        state.learningActivityDraft.endDate = computedEnd;
        if (endInput) {
            endInput.value = computedEnd;
        }
        if (!state.learningActivityDraft.statusManuallySet) {
            state.learningActivityDraft.status = calculateLearningActivityStatus(state.learningActivityDraft);
        }
    },
    'update-learning-activity-end-date': (id, element) => {
        if (!state.learningActivityDraft) return;
        state.learningActivityDraft.endDate = element.value;
        if (!state.learningActivityDraft.statusManuallySet) {
            state.learningActivityDraft.status = calculateLearningActivityStatus(state.learningActivityDraft);
        }
    },
    'update-learning-activity-status': (id, element) => {
        if (!state.learningActivityDraft) return;
        const value = element?.value;
        if (!value) return;
        if (!Object.values(LEARNING_ACTIVITY_STATUS).includes(value)) return;
        state.learningActivityDraft.status = value;
        state.learningActivityDraft.statusManuallySet = true;
    },
    'update-learning-activity-weight': (id, element) => {
        if (!state.learningActivityDraft) return;
        const value = parseFloat(element?.value);
        state.learningActivityDraft.weight = Number.isFinite(value) && value >= 0 ? value : 0;
    },
    'toggle-learning-activity-criterion': (id, element) => {
        if (!state.learningActivityDraft) return;
        const { competencyId, criterionId } = element.dataset;
        if (!competencyId || !criterionId) return;

        if (!Array.isArray(state.learningActivityDraft.criteriaRefs)) {
            state.learningActivityDraft.criteriaRefs = [];
        }

        const rubric = ensureLearningActivityRubric(state.learningActivityDraft);
        const existingIndex = state.learningActivityDraft.criteriaRefs.findIndex(ref =>
            ref.competencyId === competencyId && ref.criterionId === criterionId
        );

        if (element.checked) {
            if (existingIndex === -1) {
                state.learningActivityDraft.criteriaRefs.push({ competencyId, criterionId });
            }
            ensureRubricHasItemForCriterion(rubric, competencyId, criterionId);
        } else if (existingIndex !== -1) {
            state.learningActivityDraft.criteriaRefs.splice(existingIndex, 1);
            removeRubricItemsForCriterion(rubric, competencyId, criterionId);
        }
    },
    'open-learning-activity-criteria': () => {
        state.learningActivityCriteriaModalOpen = true;
    },
    'close-learning-activity-criteria': () => {
        state.learningActivityCriteriaModalOpen = false;
    },
    'go-to-competency-settings': (id, element) => {
        const classId = element?.dataset?.classId;
        state.learningActivityCriteriaModalOpen = false;
        if (classId) {
            state.pendingCompetencyHighlightId = classId;
        }
        state.activeView = 'settings';
        state.settingsActiveTab = 'competencies';
    },
    'toggle-competency-guide': () => {
        state.learningActivityGuideVisible = !state.learningActivityGuideVisible;
    },
    'save-learning-activity-draft': () => {
        const draft = state.learningActivityDraft;
        if (!draft) return;

        const title = draft.title?.trim() || '';
        if (!title) {
            alert(t('activities_title_required'));
            return;
        }

        const now = new Date().toISOString();
        syncRubricWithActivityCriteria(draft);
        const normalizedRubric = normalizeRubric(draft.rubric);
        const allowedStatuses = Object.values(LEARNING_ACTIVITY_STATUS);
        let normalizedStatus;
        if (draft.statusManuallySet && allowedStatuses.includes(draft.status)) {
            normalizedStatus = draft.status;
        } else {
            normalizedStatus = calculateLearningActivityStatus({
                startDate: draft.startDate,
                endDate: draft.endDate,
                status: draft.status,
            });
        }

        const weightValue = typeof draft.weight === 'number' && !Number.isNaN(draft.weight) && draft.weight >= 0
            ? draft.weight
            : 1;

        if (draft.isNew) {
            state.learningActivities.push({
                id: draft.id,
                classId: draft.classId,
                title,
                description: draft.description?.trim() || '',
                criteriaRefs: Array.isArray(draft.criteriaRefs) ? [...draft.criteriaRefs] : [],
                createdAt: now,
                updatedAt: now,
                startDate: draft.startDate || '',
                endDate: draft.endDate || '',
                rubric: normalizedRubric,
                status: normalizedStatus,
                weight: weightValue,
            });
        } else {
            const index = state.learningActivities.findIndex(act => act.id === draft.id);
            const persisted = {
                id: draft.id,
                classId: draft.classId,
                title,
                description: draft.description?.trim() || '',
                criteriaRefs: Array.isArray(draft.criteriaRefs) ? [...draft.criteriaRefs] : [],
                createdAt: draft.createdAt || now,
                updatedAt: now,
                startDate: draft.startDate || '',
                endDate: draft.endDate || '',
                rubric: normalizedRubric,
                status: normalizedStatus,
                weight: weightValue,
            };
            if (index === -1) {
                state.learningActivities.push(persisted);
            } else {
                state.learningActivities[index] = { ...state.learningActivities[index], ...persisted };
            }
        }

        state.learningActivityDraft = null;
        state.learningActivityGuideVisible = false;
        state.activeView = 'activities';
        saveState();
    },
    'toggle-learning-activity-list': (id, element) => {
        const classId = element.dataset.classId;
        if (!classId) return;

        const expanded = state.expandedLearningActivityClassIds || [];
        const index = expanded.indexOf(classId);
        if (index === -1) {
            expanded.push(classId);
        } else {
            expanded.splice(index, 1);
        }
        state.expandedLearningActivityClassIds = expanded;
    },

    // --- Rubric Actions ---
    'open-learning-activity-rubric': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        if (!activityId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const previousView = state.activeView;
        const openAssessmentTab = previousView === 'evaluation';
        state.learningActivityRubricReturnView = previousView;
        syncRubricWithActivityCriteria(activity);
        saveState();
        state.activeLearningActivityRubricId = activityId;
        state.learningActivityRubricTab = openAssessmentTab ? 'assessment' : 'configuration';
        state.learningActivityRubricFilter = '';
        state.activeView = 'learningActivityRubric';
    },
    'close-learning-activity-rubric': () => {
        const returnView = state.learningActivityRubricReturnView || 'activities';
        state.activeLearningActivityRubricId = null;
        state.learningActivityRubricTab = 'configuration';
        state.learningActivityRubricFilter = '';
        state.activeView = returnView;
        state.learningActivityRubricReturnView = null;
    },
    'set-learning-activity-rubric-tab': (id, element) => {
        const tab = element?.dataset?.tab;
        const allowedTabs = ['configuration', 'assessment'];
        if (allowedTabs.includes(tab)) {
            state.learningActivityRubricTab = tab;
        }
    },
    'add-rubric-item': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        if (!activityId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const select = document.getElementById(`rubric-add-select-${activityId}`);
        if (!select) return;
        const value = select.value;
        if (!value) return;
        const [competencyId = '', criterionId = ''] = value.split('|');
        rubric.items.push({
            id: generateRubricItemId(),
            type: 'criterion',
            competencyId,
            criterionId,
            weight: 1,
            levelComments: createDefaultLevelComments(),
            generalGuidance: '',
        });
        ensureActivityHasCriterionRef(activity, competencyId, criterionId);
        select.value = '';
        recalculateLearningActivityStatus(activity);
        saveState();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'add-rubric-section': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        if (!activityId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        rubric.items.push({
            id: generateRubricItemId(),
            type: 'section',
            sectionTitle: '',
        });
        saveState();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'remove-rubric-item': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        if (!activityId || !itemId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const index = rubric.items.findIndex(item => item.id === itemId);
        if (index !== -1) {
            const [removed] = rubric.items.splice(index, 1);
            if (removed) {
                cleanRubricEvaluations(rubric, [removed.id]);
                if (removed.type !== 'section') {
                    const stillPresent = rubric.items.some(item =>
                        item.type !== 'section' && item.competencyId === removed.competencyId && item.criterionId === removed.criterionId
                    );
                    if (!stillPresent) {
                        removeCriterionRefFromActivity(activity, removed.competencyId, removed.criterionId);
                    }
                }
            }
            recalculateLearningActivityStatus(activity);
            saveState();
            document.dispatchEvent(new CustomEvent('render'));
        }
    },
    'move-rubric-item': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        const direction = element?.dataset?.direction;
        if (!activityId || !itemId || !direction) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const index = rubric.items.findIndex(item => item.id === itemId);
        if (index === -1) return;
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= rubric.items.length) return;
        [rubric.items[index], rubric.items[targetIndex]] = [rubric.items[targetIndex], rubric.items[index]];
        saveState();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'update-rubric-item-weight': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        if (!activityId || !itemId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const item = rubric.items.find(entry => entry.id === itemId);
        if (!item || item.type === 'section') return;
        const value = parseFloat(element.value);
        item.weight = Number.isFinite(value) ? value : 1;
        saveState();
    },
    'update-rubric-item-guidance': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        if (!activityId || !itemId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const item = rubric.items.find(entry => entry.id === itemId);
        if (!item || item.type === 'section') return;
        item.generalGuidance = element.value;
        saveState();
    },
    'update-rubric-item-comment': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        const level = element?.dataset?.level;
        if (!activityId || !itemId || !level || !RUBRIC_LEVELS.includes(level)) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const item = rubric.items.find(entry => entry.id === itemId);
        if (!item || item.type === 'section') return;
        item.levelComments[level] = element.value;
        saveState();
    },
    'update-rubric-section-title': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        if (!activityId || !itemId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const item = rubric.items.find(entry => entry.id === itemId);
        if (!item || item.type !== 'section') return;
        item.sectionTitle = element.value;
        saveState();
    },
    'set-rubric-score': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        const studentId = element?.dataset?.studentId;
        const level = element?.dataset?.level;
        if (!activityId || !itemId || !studentId || !level || !RUBRIC_LEVELS.includes(level)) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const evaluation = ensureRubricEvaluation(rubric, studentId);
        if (!evaluation || evaluation.flags?.notPresented) {
            return;
        }
        const current = evaluation.scores[itemId];
        if (current === level) {
            delete evaluation.scores[itemId];
        } else {
            evaluation.scores[itemId] = level;
        }
        recalculateLearningActivityStatus(activity);
        saveState();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'update-rubric-general-comment': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const studentId = element?.dataset?.studentId;
        if (!activityId || !studentId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const evaluation = ensureRubricEvaluation(rubric, studentId);
        if (!evaluation) return;
        evaluation.comment = element.value;
        saveState();
    },
    'toggle-rubric-not-presented': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const studentId = element?.dataset?.studentId;
        if (!activityId || !studentId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const evaluation = ensureRubricEvaluation(rubric, studentId);
        if (!evaluation) return;
        const current = Boolean(evaluation.flags?.notPresented);
        evaluation.flags.notPresented = !current;
        if (evaluation.flags.notPresented) {
            evaluation.scores = {};
            evaluation.flags.deliveredLate = false;
        }
        recalculateLearningActivityStatus(activity);
        saveState();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'toggle-rubric-delivered-late': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const studentId = element?.dataset?.studentId;
        if (!activityId || !studentId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const evaluation = ensureRubricEvaluation(rubric, studentId);
        if (!evaluation) return;
        const current = Boolean(evaluation.flags?.deliveredLate);
        evaluation.flags.deliveredLate = !current;
        recalculateLearningActivityStatus(activity);
        saveState();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'filter-learning-activity-rubric-students': (id, element) => {
        if (!element) return;
        state.learningActivityRubricFilter = element.value;
    },
    'open-learning-activity-evaluation': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        if (!activityId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        state.activeView = 'evaluation';
        state.evaluationActiveTab = 'activities';
        state.selectedEvaluationClassId = activity.classId || null;
    },

    // --- Student Actions ---
    'add-student-to-class': (id, element) => {
        const activityId = element.dataset.activityId;
        const nameInput = document.getElementById(`new-student-name-${activityId}`);
        const name = nameInput.value.trim();
        if (!name) return;

        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        let student = state.students.find(s => s.name.toLowerCase() === name.toLowerCase());

        if (!student) {
            student = { id: crypto.randomUUID(), name: name, generalNotes: '' };
            state.students.push(student);
        }
        
        if (!activity.studentIds?.includes(student.id)) {
            activity.studentIds = [...(activity.studentIds || []), student.id];
        }
        
        nameInput.value = '';
        saveState();
    },
    'add-selected-student-to-class': (id, element) => {
        const activityId = element.dataset.activityId;
        const activity = state.activities.find(a => a.id === activityId);
        const selectEl = document.getElementById(`add-student-select-${activityId}`);
        const studentId = selectEl.value;

        if (activity && studentId && !activity.studentIds?.includes(studentId)) {
            activity.studentIds.push(studentId);
            saveState();
        }
    },
    'remove-student-from-class': (id, element) => {
        const { activityId, studentId } = element.dataset;
        const activity = state.activities.find(a => a.id === activityId);
        if (activity) {
            activity.studentIds = activity.studentIds?.filter(sid => sid !== studentId);
            saveState();
        }
    },
    'select-student': (id, element) => {
        state.selectedStudentId = element.dataset.studentId;
        state.studentTimelineFilter = 'all';
        state.activeView = 'studentDetail';
    },
    'back-to-classes': () => {
        state.selectedStudentId = null;
        state.activeView = 'classes';
    },
    'edit-student-name': (id, element) => {
        const student = state.students.find(s => s.id === element.dataset.studentId);
        if(student) {
            student.name = element.value;
            saveState();
        }
    },
    'edit-student-notes': (id, element) => {
        const student = state.students.find(s => s.id === element.dataset.studentId);
        if(student) {
            student.generalNotes = element.value;
            saveState();
        }
    },
    'edit-positive-record': async (id, element) => {
        const { entryId, studentId, recordId } = element.dataset;
        if (!entryId || !studentId || !recordId) return;
        const entry = ensureClassEntry(entryId);
        const studentAnnotation = ensureStudentAnnotation(entry, studentId, entryId);
        const targetRecord = studentAnnotation.positives.find(record => record.id === recordId);
        if (!targetRecord) return;

        const result = await showTextInputModal({
            title: t('edit_positive_record'),
            label: t('positive_record_prompt'),
            defaultValue: targetRecord.content,
            confirmLabel: t('modal_save'),
            allowDelete: true
        });

        if (handleRecordEdit(studentAnnotation.positives, recordId, result)) {
            saveState();
        }
    },
    'edit-incident-record': async (id, element) => {
        const { entryId, studentId, recordId } = element.dataset;
        if (!entryId || !studentId || !recordId) return;
        const entry = ensureClassEntry(entryId);
        const studentAnnotation = ensureStudentAnnotation(entry, studentId, entryId);
        const targetRecord = studentAnnotation.incidents.find(record => record.id === recordId);
        if (!targetRecord) return;

        const result = await showTextInputModal({
            title: t('edit_incident_record'),
            label: t('incident_record_prompt'),
            defaultValue: targetRecord.content,
            confirmLabel: t('modal_save'),
            allowDelete: true
        });

        if (handleRecordEdit(studentAnnotation.incidents, recordId, result)) {
            saveState();
        }
    },
    'edit-comment-record': async (id, element) => {
        const { entryId, studentId, recordId } = element.dataset;
        if (!entryId || !studentId || !recordId) return;
        const entry = ensureClassEntry(entryId);
        const studentAnnotation = ensureStudentAnnotation(entry, studentId, entryId);
        const targetRecord = studentAnnotation.comments.find(record => record.id === recordId);
        if (!targetRecord) return;

        const result = await showTextInputModal({
            title: t('edit_comment_record'),
            label: t('comment_record_prompt'),
            defaultValue: targetRecord.content,
            confirmLabel: t('modal_save'),
            allowDelete: true
        });

        if (handleRecordEdit(studentAnnotation.comments, recordId, result)) {
            saveState();
        }
    },
    'set-student-timeline-filter': (id, element) => {
        const { filter } = element.dataset;
        if (!filter) return;

        const nextFilter = (filter === state.studentTimelineFilter && filter !== 'all') ? 'all' : filter;
        state.studentTimelineFilter = nextFilter;
        saveState();
    },
    'go-to-student': (id, element) => {
        const studentId = element.value;
        if (studentId) {
            const studentAnnotationEl = document.getElementById(`student-annotation-${studentId}`);
            if (studentAnnotationEl) {
                studentAnnotationEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    },
    // --- Competency Actions ---
    'add-competency': (id, element) => {
        const activityId = element.dataset.activityId;
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        const newCompetency = {
            id: crypto.randomUUID(),
            code: getNextCompetencyCode(activity),
            description: '',
            criteria: []
        };

        if (!Array.isArray(activity.competencies)) {
            activity.competencies = [];
        }

        activity.competencies.push(newCompetency);

        saveState();
    },
    'select-competency': (id, element) => {
        const activityId = element.dataset.activityId;
        const competencyId = element.dataset.competencyId;
        if (!activityId || !competencyId) return;

        state.selectedCompetency = { activityId, competencyId };
        state.activeView = 'competencyDetail';
    },
    'back-to-competencies': () => {
        state.selectedCompetency = null;
        state.activeView = 'settings';
        state.settingsActiveTab = 'competencies';
    },
    'update-competency-code': (id, element) => {
        const { activityId, competencyId } = element.dataset;
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        const competency = activity.competencies?.find(c => c.id === competencyId);
        if (!competency) return;

        let value = element.value.trim();
        if (!value) {
            competency.code = '';
        } else {
            if (!value.toLowerCase().startsWith('ce')) {
                value = `CE${value}`;
            }
            competency.code = value;
        }
        saveState();
    },
    'update-competency-description': (id, element) => {
        const { activityId, competencyId } = element.dataset;
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        const competency = activity.competencies?.find(c => c.id === competencyId);
        if (!competency) return;

        competency.description = element.value;
        saveState();
    },
    'delete-competency': (id, element) => {
        const { activityId, competencyId } = element.dataset;
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        if (Array.isArray(activity.competencies)) {
            activity.competencies = activity.competencies.filter(c => c.id !== competencyId);
        }

        if (state.selectedCompetency?.competencyId === competencyId) {
            state.selectedCompetency = null;
            state.activeView = 'settings';
            state.settingsActiveTab = 'competencies';
        }

        saveState();
    },
    'add-criterion': (id, element) => {
        const { activityId, competencyId } = element.dataset;
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        const competency = activity.competencies?.find(c => c.id === competencyId);
        if (!competency) return;

        if (!Array.isArray(competency.criteria)) {
            competency.criteria = [];
        }

        competency.criteria.push({
            id: crypto.randomUUID(),
            code: getNextCriterionCode(competency),
            description: ''
        });

        saveState();
    },
    'update-criterion-code': (id, element) => {
        const { activityId, competencyId, criterionId } = element.dataset;
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        const competency = activity.competencies?.find(c => c.id === competencyId);
        if (!competency) return;

        const criterion = competency.criteria?.find(cr => cr.id === criterionId);
        if (!criterion) return;

        let value = element.value.trim();
        if (!value) {
            criterion.code = '';
        } else {
            if (!value.toLowerCase().startsWith('ca')) {
                value = `CA${value}`;
            }
            criterion.code = value;
        }
        saveState();
    },
    'update-criterion-description': (id, element) => {
        const { activityId, competencyId, criterionId } = element.dataset;
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        const competency = activity.competencies?.find(c => c.id === competencyId);
        if (!competency) return;

        const criterion = competency.criteria?.find(cr => cr.id === criterionId);
        if (!criterion) return;

        criterion.description = element.value;
        saveState();
    },
    'delete-criterion': (id, element) => {
        const { activityId, competencyId, criterionId } = element.dataset;
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        const competency = activity.competencies?.find(c => c.id === competencyId);
        if (!competency) return;

        competency.criteria = competency.criteria?.filter(cr => cr.id !== criterionId) || [];
        saveState();
    },
    'export-student-docx': () => {
        const student = state.students.find(s => s.id === state.selectedStudentId);
        if (!student) return;

        const enrolledClasses = state.activities.filter(a => a.type === 'class' && a.studentIds?.includes(student.id));
        const termRange = getCurrentTermDateRange();

        const annotationsByClass = Object.entries(state.classEntries).reduce((acc, [entryId, entryData]) => {
            const annotation = entryData.annotations?.[student.id];
            if (annotation && annotation.trim() !== '') {
                const [activityId, dateString] = entryId.split('_');
                const date = new Date(dateString + 'T00:00:00');

                if (termRange && (date < termRange.start || date > termRange.end)) {
                    return acc;
                }

                const activity = state.activities.find(a => a.id === activityId);
                if (!acc[activityId]) {
                    acc[activityId] = { name: activity ? activity.name : 'Clase eliminada', annotations: [] };
                }
                acc[activityId].annotations.push({ date, annotation });
            }
            return acc;
        }, {});

        Object.values(annotationsByClass).forEach(classData => classData.annotations.sort((a, b) => b.date - a.date));

        const doc = new docx.Document({
            sections: [{
                properties: {},
                children: [
                    new docx.Paragraph({
                        children: [ new docx.TextRun({ text: student.name, bold: true, size: 32 }) ],
                    }),
                    new docx.Paragraph({ text: "" }),
                    new docx.Paragraph({
                        children: [ new docx.TextRun({ text: t('enrolled_classes_title'), bold: true, size: 24 }) ],
                    }),
                    ...enrolledClasses.map(c => new docx.Paragraph({ text: c.name, bullet: { level: 0 } })),
                     new docx.Paragraph({ text: "" }),
                    new docx.Paragraph({
                        children: [ new docx.TextRun({ text: t('general_notes_label'), bold: true, size: 24 }) ],
                    }),
                    new docx.Paragraph({ text: student.generalNotes || '' }),
                    new docx.Paragraph({ text: "" }),
                    new docx.Paragraph({
                        children: [ new docx.TextRun({ text: t('session_notes_history_title'), bold: true, size: 24 }) ],
                    }),
                    ...Object.values(annotationsByClass).sort((a,b) => a.name.localeCompare(b.name)).flatMap(classData => [
                        new docx.Paragraph({ text: "" }),
                        new docx.Paragraph({
                            children: [ new docx.TextRun({ text: classData.name, bold: true, underline: true, size: 20 }) ],
                        }),
                        ...classData.annotations.flatMap(item => [
                           new docx.Paragraph({
                                children: [ new docx.TextRun({ text: item.date.toLocaleDateString(document.documentElement.lang, { year: 'numeric', month: 'long', day: 'numeric' }), italics: true, color: "888888" }) ],
                            }),
                            new docx.Paragraph({ text: item.annotation, indentation: { left: 400 } }),
                            new docx.Paragraph({ text: "" }),
                        ])
                    ])
                ],
            }],
        });

        docx.Packer.toBlob(doc).then(blob => {
            saveAs(blob, `informe-${student.name.replace(/ /g,"_")}.docx`);
        });
    },
    'print-student-sheet': () => {
        window.print();
    },
    // --- Activity Actions ---
    'go-to-class-session': (id, element) => {
        const activityId = element.dataset.activityId;
        const nextSession = findNextClassSession(activityId);
        if (nextSession) {
            const activityInfo = state.activities.find(a => a.id === activityId);
            state.selectedActivity = { ...activityInfo, ...nextSession };
            state.activeView = 'activityDetail';
        } else {
            alert('No hay clases programadas para esta asignatura en el futuro.');
        }
    },
    'add-activity': () => {
        const nameInput = document.getElementById('new-activity-name');
        const name = nameInput.value.trim();
        const type = document.querySelector('input[name="activityType"]:checked').value;
        if (name) {
            const newActivity = {
                id: crypto.randomUUID(),
                name,
                type,
                studentIds: [],
                color: getRandomPastelColor(),
                startDate: state.courseStartDate,
                endDate: state.courseEndDate,
                competencies: []
            };
            state.activities.push(newActivity);
            if (type === 'class') {
                ensureEvaluationSettingsForClass(newActivity.id);
            }
            nameInput.value = '';
            saveState();
        }
    },
    'delete-activity': (id) => {
        showModal(t('delete_activity_confirm_title'), t('delete_activity_confirm_text'), () => {
            state.activities = state.activities.filter(a => a.id !== id);
            delete state.evaluationSettings[id];
            delete state.evaluationResults[id];
            saveState();
            document.dispatchEvent(new CustomEvent('render'));
        });
    },
    'edit-activity': (id) => {
        state.editingActivityId = id;
    },
    'cancel-edit-activity': () => {
        state.editingActivityId = null;
    },
    'save-activity': (id) => {
        const activity = state.activities.find(a => a.id === id);
        if (activity) {
            const nameInput = document.getElementById(`edit-activity-name-${id}`);
            const startDateInput = document.getElementById(`edit-activity-start-${id}`);
            const endDateInput = document.getElementById(`edit-activity-end-${id}`);
            
            const newName = nameInput.value.trim();
            if (newName) {
                activity.name = newName;
            }
            activity.startDate = startDateInput.value;
            activity.endDate = endDateInput.value;
            saveState();
        }
        state.editingActivityId = null;
    },
    'change-activity-color': (id, element) => {
         const activity = state.activities.find(a => a.id === id);
         if(activity) {
            activity.color = element.value;
            saveState();
            document.dispatchEvent(new CustomEvent('render'));
         }
    },
    // --- TimeSlot Actions ---
    'add-timeslot': () => {
        const labelInput = document.getElementById('new-timeslot-label');
        const label = labelInput.value.trim();
        if (label) {
            const newOrder = state.timeSlots.length > 0 ? Math.max(...state.timeSlots.map(t => t.order)) + 1 : 0;
            state.timeSlots.push({ id: crypto.randomUUID(), label, order: newOrder });
            labelInput.value = '';
            saveState();
        }
    },
    'delete-timeslot': (id) => {
        state.timeSlots = state.timeSlots.filter(t => t.id !== id);
        saveState();
    },
    'edit-timeslot': (id) => {
        state.editingTimeSlotId = id;
    },
    'cancel-edit-timeslot': () => {
        state.editingTimeSlotId = null;
    },
    'save-timeslot': (id) => {
        const timeSlot = state.timeSlots.find(t => t.id === id);
        if (timeSlot) {
            const input = document.querySelector(`input[data-action="edit-timeslot-input"]`);
            const oldLabel = timeSlot.label;
            const newLabel = input.value.trim();
            
            if (newLabel && oldLabel !== newLabel) {
                timeSlot.label = newLabel;
                Object.keys(state.schedule).forEach(key => {
                    if (key.endsWith(`-${oldLabel}`)) {
                        const day = key.split('-')[0];
                        const newKey = `${day}-${newLabel}`;
                        state.schedule[newKey] = state.schedule[key];
                        delete state.schedule[key];
                    }
                });
                saveState();
            }
        }
        state.editingTimeSlotId = null;
    },
    'reorder-timeslot': (id, element) => {
        const index = parseInt(element.dataset.index, 10);
        const direction = element.dataset.direction;
        const otherIndex = direction === 'up' ? index - 1 : index + 1;
        
        [state.timeSlots[index], state.timeSlots[otherIndex]] = [state.timeSlots[otherIndex], state.timeSlots[index]];
        
        saveState();
    },
    'generate-schedule-slots': () => {
        const startTimeStr = document.getElementById('gen-start-time').value;
        const endTimeStr = document.getElementById('gen-end-time').value;
        const classDuration = parseInt(document.getElementById('gen-class-duration').value, 10);
        const breakDuration = parseInt(document.getElementById('gen-break-duration').value, 10);
        const breakStartTimeStr = document.getElementById('gen-break-start').value;

        if (!startTimeStr || !endTimeStr || isNaN(classDuration)) {
            alert(t('generate_schedule_alert'));
            return;
        }

        const timeToMinutes = (timeStr) => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };
        const minutesToTime = (totalMinutes) => {
            const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
            const m = (totalMinutes % 60).toString().padStart(2, '0');
            return `${h}:${m}`;
        };

        const startMinutes = timeToMinutes(startTimeStr);
        const endMinutes = timeToMinutes(endTimeStr);
        const breakStartMinutes = breakStartTimeStr ? timeToMinutes(breakStartTimeStr) : -1;

        const newTimeSlots = [];
        let currentTime = startMinutes;
        
        while (currentTime < endMinutes) {
            if (breakDuration > 0 && breakStartMinutes !== -1 && currentTime >= breakStartMinutes && currentTime < (breakStartMinutes + breakDuration)) {
                const breakEndTime = breakStartMinutes + breakDuration;
                newTimeSlots.push({
                    id: crypto.randomUUID(),
                    label: `${minutesToTime(breakStartMinutes)}-${minutesToTime(breakEndTime)}`,
                });
                currentTime = breakEndTime;
                continue;
            }

            const classEndTime = currentTime + classDuration;
            if (classEndTime > endMinutes) break;
             newTimeSlots.push({
                id: crypto.randomUUID(),
                label: `${minutesToTime(currentTime)}-${minutesToTime(classEndTime)}`,
            });
            currentTime = classEndTime;
        }
        
        state.timeSlots = newTimeSlots;
        saveState();
    },
    // --- Schedule Actions ---
    'schedule-change': (id, element) => {
        const { day, time } = element.dataset;
        state.schedule[`${day}-${time}`] = element.value;
        saveState();
    },
    'add-schedule-override': () => {
        const day = document.getElementById('override-day').value;
        const time = document.getElementById('override-time').value;
        const activityId = document.getElementById('override-activity').value;
        const startDate = document.getElementById('override-start-date').value;
        const endDate = document.getElementById('override-end-date').value;

        if (!day || !time || !activityId || !startDate || !endDate) {
            alert(t('add_override_alert'));
            return;
        }
        
        state.scheduleOverrides.push({
            id: crypto.randomUUID(),
            day, time, activityId, startDate, endDate
        });
        saveState();
    },
    'delete-schedule-override': (id) => {
        state.scheduleOverrides = state.scheduleOverrides.filter(ov => ov.id !== id);
        saveState();
    },
    'print-schedule': () => {
        window.print();
    },
    'select-activity': (id, element) => {
        const { activityId, day, time, date } = element.dataset;
        const activityInfo = state.activities.find(a => a.id === activityId);
        state.selectedActivity = { ...activityInfo, day, time, date };
        state.activeView = 'activityDetail';
    },
    'back-to-schedule': () => {
        state.selectedActivity = null;
        state.activeView = 'schedule';
    },
    'navigate-to-session': (id, element) => {
        const { activityId, day, time, date } = element.dataset;
        const activityInfo = state.activities.find(a => a.id === activityId);
        state.selectedActivity = { ...activityInfo, day, time, date };
    },
    'prev-week': () => {
        state.currentDate.setDate(state.currentDate.getDate() - 7);
    },
    'next-week': () => {
        state.currentDate.setDate(state.currentDate.getDate() + 7);
    },
    'today': () => {
        state.currentDate = new Date();
    },
    'toggle-week-selector': () => {
        const menu = document.getElementById('week-selector-menu');
        const btn = document.getElementById('week-selector-btn');
        if (menu) {
            menu.classList.toggle('hidden');
            
            if (!menu.classList.contains('hidden')) {
                const closeHandler = (e) => {
                    if (!menu.contains(e.target) && !btn.contains(e.target)) {
                        menu.classList.add('hidden');
                        document.removeEventListener('click', closeHandler, true);
                    }
                };
                document.addEventListener('click', closeHandler, true);
            }
        }
    },
    'go-to-week': (id, element) => {
        const dateStr = element.dataset.date;
        if (dateStr) {
            state.currentDate = new Date(dateStr + 'T12:00:00');
            
            const menu = document.getElementById('week-selector-menu');
            if (menu) {
                menu.classList.add('hidden');
            }
        }
    },
    // --- Class Entry Actions ---
    'planned-change': (id, element) => {
        const entryId = `${state.selectedActivity.id}_${state.selectedActivity.date}`;
        const entry = ensureClassEntry(entryId);
        entry.planned = element.value;
        saveState();
    },
    'completed-change': (id, element) => {
        const entryId = `${state.selectedActivity.id}_${state.selectedActivity.date}`;
        const entry = ensureClassEntry(entryId);
        entry.completed = element.value;
        saveState();
    },
    'toggle-attendance-status': (id, element) => {
        const { studentId, status } = element.dataset;
        if (!studentId || !status) return;
        const entryId = `${state.selectedActivity.id}_${state.selectedActivity.date}`;
        const entry = ensureClassEntry(entryId);
        const studentAnnotation = ensureStudentAnnotation(entry, studentId, entryId);
        studentAnnotation.attendance = studentAnnotation.attendance === status ? null : status;
        saveState();
    },
    'add-positive-record': async (id, element) => {
        const { studentId } = element.dataset;
        if (!studentId) return;
        const entryId = `${state.selectedActivity.id}_${state.selectedActivity.date}`;
        const entry = ensureClassEntry(entryId);
        const studentAnnotation = ensureStudentAnnotation(entry, studentId, entryId);
        const result = await showTextInputModal({
            title: t('add_positive_record'),
            label: t('positive_record_prompt'),
            confirmLabel: t('modal_save')
        });

        if (!result || result.action !== 'confirm' || !result.value) return;

        studentAnnotation.positives.push(createAnnotationRecord(result.value, entryId));
        saveState();
    },
    'add-incident-record': async (id, element) => {
        const { studentId } = element.dataset;
        if (!studentId) return;
        const entryId = `${state.selectedActivity.id}_${state.selectedActivity.date}`;
        const entry = ensureClassEntry(entryId);
        const studentAnnotation = ensureStudentAnnotation(entry, studentId, entryId);
        const result = await showTextInputModal({
            title: t('add_incident_record'),
            label: t('incident_record_prompt'),
            confirmLabel: t('modal_save')
        });

        if (!result || result.action !== 'confirm' || !result.value) return;

        studentAnnotation.incidents.push(createAnnotationRecord(result.value, entryId));
        saveState();
    },
    'add-comment-record': async (id, element) => {
        const { studentId } = element.dataset;
        if (!studentId) return;
        const entryId = `${state.selectedActivity.id}_${state.selectedActivity.date}`;
        const entry = ensureClassEntry(entryId);
        const studentAnnotation = ensureStudentAnnotation(entry, studentId, entryId);
        const result = await showTextInputModal({
            title: t('add_comment_record'),
            label: t('comment_record_prompt'),
            confirmLabel: t('modal_save')
        });

        if (!result || result.action !== 'confirm' || !result.value) return;

        studentAnnotation.comments.push(createAnnotationRecord(result.value, entryId));
        saveState();
    },
    // --- Data Management Actions ---
    'update-course-date': (id, element) => {
        const type = element.dataset.type;
        if (type === 'start') {
            state.courseStartDate = element.value;
        } else {
            state.courseEndDate = element.value;
        }
        saveState();
    },
    'import-students': () => {
        const targetClassId = document.getElementById('import-target-class').value;
        const studentListTextEl = document.getElementById('student-list-text');
        const studentListText = studentListTextEl.value;
        const activity = state.activities.find(a => a.id === targetClassId);
        if (!activity || studentListText.trim() === '') {
            alert(t('import_students_alert'));
            return;
        }

        const names = studentListText.trim().split('\n').filter(name => name.trim() !== '');
        
        names.forEach(name => {
            const trimmedName = name.trim();
            if(!trimmedName) return;

            let student = state.students.find(s => s.name.toLowerCase() === trimmedName.toLowerCase());
            if (!student) {
                student = { id: crypto.randomUUID(), name: trimmedName, generalNotes: '' };
                state.students.push(student);
            }
            if (!activity.studentIds?.includes(student.id)) {
                activity.studentIds = [...(activity.studentIds || []), student.id];
            }
        });
        
        studentListTextEl.value = '';
        saveState();
    },
    'export-data': () => {
        const dataStr = JSON.stringify({
            activities: state.activities,
            students: state.students,
            timeSlots: state.timeSlots,
            schedule: state.schedule,
            scheduleOverrides: state.scheduleOverrides,
            classEntries: state.classEntries,
            courseStartDate: state.courseStartDate,
            courseEndDate: state.courseEndDate,
            terms: state.terms,
            selectedTermId: state.selectedTermId,
            holidays: state.holidays
        }, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `diario-clase-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },
    'import-data': (id, element, event) => {
        const file = event.target.files[0];
        if (!file) return;
        showModal(t('import_data_confirm_title'), t('import_data_confirm_text'), () => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    state.activities = data.activities || [];
                    state.learningActivities = (data.learningActivities || []).map(activity => ({
                        ...activity,
                        criteriaRefs: Array.isArray(activity?.criteriaRefs) ? activity.criteriaRefs : [],
                        createdAt: activity?.createdAt || new Date().toISOString(),
                        updatedAt: activity?.updatedAt || activity?.createdAt || new Date().toISOString(),
                    }));
                    state.students = data.students || [];
                    state.timeSlots = data.timeSlots || [];
                    state.schedule = data.schedule || {};
                    state.scheduleOverrides = data.scheduleOverrides || [];
                    state.classEntries = data.classEntries || {};
                    state.courseStartDate = data.courseStartDate || '';
                    state.courseEndDate = data.courseEndDate || '';
                    state.terms = data.terms || [];
                    state.selectedTermId = data.selectedTermId || 'all';
                    state.holidays = data.holidays || [];
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
                    saveState();
                    showImportSummary(data);
                } catch (error) {
                    alert(t('import_error_alert'));
                }
            };
            reader.readAsText(file);
        });
    },
    'import-schedule': (id, element, event) => {
        const file = event.target.files[0];
        if (!file) return;
        showModal(t('import_schedule_confirm_title'), t('import_schedule_confirm_text'), () => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    state.activities = data.activities || [];
                    state.timeSlots = data.timeSlots || [];
                    state.schedule = data.schedule || {};
                    state.scheduleOverrides = data.scheduleOverrides || [];
                    state.courseStartDate = data.courseStartDate || '';
                    state.courseEndDate = data.courseEndDate || '';
                    state.terms = data.terms || [];
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

                    state.students = [];
                    state.classEntries = {};
                    
                    saveState();
                    alert(t('import_success_alert'));
                    window.location.reload();
                } catch (error) {
                    alert(t('import_error_alert'));
                }
            };
            reader.readAsText(file);
        });
    },
    'delete-all-data': () => {
        showModal(t('delete_all_data_confirm_title'), t('delete_all_data_confirm_text'), () => {
            localStorage.removeItem('teacherDashboardData');
            alert(t('delete_all_data_success_alert'));
            window.location.reload();
        });
    },
    'show-privacy-policy': () => {
        const title = t('privacy_title');
        const content = `
            <div class="prose prose-sm dark:prose-invert max-w-none text-left text-gray-700 dark:text-gray-300">
                <p>${t('privacy_p1')}</p>
                <p>${t('privacy_p2')}</p>
                <p>${t('privacy_p3')}</p>
                <p>${t('privacy_p4')}</p>
                <p>${t('privacy_p5')}</p>
            </div>
        `;
        showInfoModal(title, content);
    },
    'add-term': () => {
        const nameInput = document.getElementById('new-term-name');
        const startInput = document.getElementById('new-term-start');
        const endInput = document.getElementById('new-term-end');
        
        if (nameInput.value.trim() && startInput.value && endInput.value) {
            state.terms.push({
                id: crypto.randomUUID(),
                name: nameInput.value.trim(),
                startDate: startInput.value,
                endDate: endInput.value
            });
            nameInput.value = '';
            startInput.value = '';
            endInput.value = '';
            saveState();
        } else {
            alert(t('add_term_alert'));
        }
    },
    'delete-term': (id) => {
        state.terms = state.terms.filter(term => term.id !== id);
        if (state.selectedTermId === id) {
            state.selectedTermId = 'all';
        }
        saveState();
    },
    'add-holiday': () => {
        const nameInput = document.getElementById('new-holiday-name');
        const startInput = document.getElementById('new-holiday-start');
        const endInput = document.getElementById('new-holiday-end');

        if (nameInput.value.trim() && startInput.value) {
            state.holidays.push({
                id: crypto.randomUUID(),
                name: nameInput.value.trim(),
                startDate: startInput.value,
                endDate: endInput.value || startInput.value
            });
            nameInput.value = '';
            startInput.value = '';
            endInput.value = '';
            saveState();
        } else {
            alert(t('add_holiday_alert'));
        }
    },
    'delete-holiday': (id) => {
        state.holidays = state.holidays.filter(holiday => holiday.id !== id);
        saveState();
    },
    'select-term': (id, element) => {
        state.selectedTermId = element.value;
        saveState();
    }
};
