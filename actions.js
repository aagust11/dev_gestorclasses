// actions.js: Define toda la lógica de las acciones del usuario.

import { state, saveState, getRandomPastelColor, LEARNING_ACTIVITY_STATUS, calculateLearningActivityStatus, createEmptyRubric, normalizeRubric, RUBRIC_LEVELS, ensureEvaluationDraft, persistEvaluationDraft, resetEvaluationDraftToDefault, pickExistingDataFile, createDataFileWithCurrentState, reloadDataFromConfiguredFile, clearConfiguredDataFile, resetStateToDefaults, scheduleTemplateSync, isTemplateActivity } from './state.js';
import { showModal, showInfoModal, findNextClassSession, getCurrentTermDateRange, STUDENT_ATTENDANCE_STATUS, createEmptyStudentAnnotation, normalizeStudentAnnotation, showTextInputModal, formatDate, getTermDateRangeById } from './utils.js';
import { t } from './i18n.js';
import { EVALUATION_MODALITIES, COMPETENCY_AGGREGATIONS, NP_TREATMENTS, NO_EVIDENCE_BEHAVIOR, validateCompetencyEvaluationConfig, calculateWeightedCompetencyResult, calculateMajorityCompetencyResult, qualitativeToNumeric, normalizeEvaluationConfig, computeNumericEvidence } from './evaluation.js';

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
            flags: { notPresented: false, deliveredLate: false, exempt: false }
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
            evaluation.flags = { notPresented: false, deliveredLate: false, exempt: false };
        } else {
            evaluation.flags.notPresented = Boolean(evaluation.flags.notPresented);
            evaluation.flags.deliveredLate = Boolean(evaluation.flags.deliveredLate);
            evaluation.flags.exempt = Boolean(evaluation.flags.exempt);
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

function parseRubricNumericScore(entry) {
    if (entry && typeof entry === 'object') {
        if (entry.mode === 'numeric') {
            const parsed = Number(entry.value);
            return Number.isFinite(parsed) ? parsed : NaN;
        }
        if (typeof entry.value === 'number') {
            return entry.value;
        }
    }
    if (typeof entry === 'number') {
        return entry;
    }
    if (typeof entry === 'string') {
        const normalized = entry.replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
}

function parseLocaleNumberInput(value) {
    if (typeof value !== 'string') {
        return { number: NaN, hasValue: false };
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return { number: NaN, hasValue: false };
    }
    const normalized = trimmed.replace(/\s+/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return { number: Number.isFinite(parsed) ? parsed : NaN, hasValue: true };
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

function saveLearningActivitiesChange() {
    state.pendingActivitiesRefresh = true;
    return saveState();
}

function createEmptyTermGradeEntry() {
    return { numericScore: '', levelId: '', isManual: false, noteSymbols: [], isLocked: false };
}

function ensureTermGradeRecordStructure(classId, termId) {
    if (!state.termGradeRecords || typeof state.termGradeRecords !== 'object') {
        state.termGradeRecords = {};
    }
    if (!state.termGradeRecords[classId] || typeof state.termGradeRecords[classId] !== 'object') {
        state.termGradeRecords[classId] = {};
    }
    if (!state.termGradeRecords[classId][termId] || typeof state.termGradeRecords[classId][termId] !== 'object') {
        state.termGradeRecords[classId][termId] = { students: {} };
    }
    const record = state.termGradeRecords[classId][termId];
    if (!record.students || typeof record.students !== 'object') {
        record.students = {};
    }
    return record;
}

function ensureTermGradeStudent(record, studentId) {
    if (!record.students[studentId] || typeof record.students[studentId] !== 'object') {
        record.students[studentId] = {
            criteria: {},
            competencies: {},
            final: createEmptyTermGradeEntry(),
        };
    }
    const studentRecord = record.students[studentId];
    if (!studentRecord.final || typeof studentRecord.final !== 'object') {
        studentRecord.final = createEmptyTermGradeEntry();
    }
    if (!studentRecord.criteria || typeof studentRecord.criteria !== 'object') {
        studentRecord.criteria = {};
    }
    if (!studentRecord.competencies || typeof studentRecord.competencies !== 'object') {
        studentRecord.competencies = {};
    }
    return studentRecord;
}

function ensureTermGradeEntry(record, studentId, scope, targetId) {
    const studentRecord = ensureTermGradeStudent(record, studentId);
    if (scope === 'final') {
        return studentRecord.final;
    }
    const container = scope === 'competencies' ? studentRecord.competencies : studentRecord.criteria;
    if (!container[targetId] || typeof container[targetId] !== 'object') {
        container[targetId] = createEmptyTermGradeEntry();
    }
    return container[targetId];
}

function formatNumericScore(score) {
    if (typeof score === 'string') {
        const trimmed = score.trim();
        if (!trimmed) {
            return '';
        }
        const parsed = Number(trimmed.replace(',', '.'));
        if (Number.isFinite(parsed)) {
            return parsed.toFixed(2);
        }
        return trimmed;
    }
    if (Number.isFinite(score)) {
        return Number(score).toFixed(2);
    }
    return '';
}

function sumEvidenceWeights(evidences = []) {
    return evidences.reduce((sum, evidence) => {
        if (!evidence || typeof evidence !== 'object') {
            return sum;
        }
        const activityWeight = Number.isFinite(Number(evidence.activityWeight))
            ? Number(evidence.activityWeight)
            : 1;
        const criterionWeight = Number.isFinite(Number(evidence.criterionWeight))
            ? Number(evidence.criterionWeight)
            : 1;
        return sum + Math.max(0, activityWeight) * Math.max(0, criterionWeight);
    }, 0);
}

function computeMajorityData(evidences = [], normalizedConfig) {
    const levelMap = new Map();
    normalizedConfig.competency.levels.forEach(level => {
        levelMap.set(level.id, level);
    });

    const winners = [];
    const counts = new Map();

    evidences.forEach(evidence => {
        if (!evidence || typeof evidence !== 'object') {
            return;
        }
        const levelId = evidence.levelId;
        if (!levelMap.has(levelId)) {
            return;
        }
        if (normalizedConfig.competency.calculation.npTreatment === NP_TREATMENTS.EXCLUDE_FROM_AVERAGE && levelId === 'NP') {
            return;
        }
        counts.set(levelId, (counts.get(levelId) || 0) + 1);
    });

    let maxCount = 0;
    counts.forEach((count, levelId) => {
        if (count > maxCount) {
            winners.length = 0;
            winners.push(levelId);
            maxCount = count;
        } else if (count === maxCount && count > 0) {
            winners.push(levelId);
        }
    });

    const fallbackLevel = normalizedConfig.competency.calculation.noEvidenceBehavior === NO_EVIDENCE_BEHAVIOR.SPECIFIC_LEVEL
        ? (levelMap.has(normalizedConfig.competency.calculation.noEvidenceLevelId)
            ? normalizedConfig.competency.calculation.noEvidenceLevelId
            : 'NP')
        : 'NP';

    return { winners, fallbackLevel };
}

function getActivityEffectiveEndDate(activity) {
    if (!activity) {
        return null;
    }
    if (activity?.endDate) {
        const parsed = new Date(`${activity.endDate}T23:59:59`);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    if (activity?.startDate) {
        const parsed = new Date(`${activity.startDate}T23:59:59`);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return null;
}

function isActivityWithinTerm(activity, termRange, mode = 'dates') {
    if (!termRange) {
        return true;
    }
    const effectiveEnd = getActivityEffectiveEndDate(activity);
    if (!effectiveEnd) {
        return true;
    }
    if (mode === 'accumulated') {
        return effectiveEnd <= termRange.end;
    }
    return effectiveEnd >= termRange.start && effectiveEnd <= termRange.end;
}

function normalizeNumericActivityMetadata(activity) {
    const numeric = activity && typeof activity === 'object' && activity.numeric && typeof activity.numeric === 'object'
        ? activity.numeric
        : {};
    const categoryId = typeof numeric.categoryId === 'string' ? numeric.categoryId.trim() : '';
    const weightCandidates = [numeric.weight, activity?.weight];
    let weight = 1;
    for (const candidate of weightCandidates) {
        const numericCandidate = Number(candidate);
        if (Number.isFinite(numericCandidate) && numericCandidate > 0) {
            weight = numericCandidate;
            break;
        }
    }
    return { categoryId, weight };
}

function computeStudentNumericScoreForActivity(activity, studentId) {
    const rubric = activity?.rubric;
    const rubricItems = Array.isArray(rubric?.items) ? rubric.items : [];
    if (rubricItems.length === 0) {
        return null;
    }

    const evaluations = rubric?.evaluations && typeof rubric.evaluations === 'object'
        ? rubric.evaluations
        : {};
    const evaluation = evaluations[studentId];
    if (!evaluation || typeof evaluation !== 'object') {
        return null;
    }

    const scores = evaluation.scores && typeof evaluation.scores === 'object'
        ? evaluation.scores
        : {};
    const flags = evaluation.flags && typeof evaluation.flags === 'object'
        ? evaluation.flags
        : {};

    if (Boolean(flags.exempt)) {
        return { exempt: true };
    }

    const numericItems = rubricItems.filter(item => item?.scoring?.mode === 'numeric');
    if (numericItems.length === 0) {
        return null;
    }

    let totalScore = 0;
    let totalMax = 0;
    let hasValues = false;

    numericItems.forEach(item => {
        const maxScore = Number(item?.scoring?.maxScore);
        if (!Number.isFinite(maxScore) || maxScore <= 0) {
            return;
        }
        const rawScore = scores[item.id];
        const parsed = parseRubricNumericScore(rawScore);
        const contribution = Boolean(flags.notPresented)
            ? 0
            : (Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, maxScore)) : null);
        if (contribution === null) {
            return;
        }
        totalScore += contribution;
        totalMax += maxScore;
        hasValues = true;
    });

    if (!hasValues || totalMax <= 0) {
        return Boolean(flags.notPresented) ? { score: 0, maxScore: 0 } : null;
    }

    return { score: totalScore, maxScore: totalMax, notPresented: Boolean(flags.notPresented) };
}

function calculateNumericTermGrades(targetClass, normalizedConfig, termId, mode = 'dates', existingRecord = null) {
    const classId = targetClass?.id;
    if (!classId) {
        return { students: {} };
    }

    const categories = Array.isArray(normalizedConfig.numeric?.categories)
        ? normalizedConfig.numeric.categories
        : [];
    const categoryMap = new Map(categories.map(category => [category.id, category]));
    if (categoryMap.size === 0) {
        return { students: {} };
    }

    const studentIds = Array.isArray(targetClass.studentIds) ? targetClass.studentIds : [];
    const studentSet = new Set(studentIds);
    if (studentSet.size === 0) {
        return { students: {} };
    }

    const termRange = getTermDateRangeById(termId);
    const calculationMode = mode === 'accumulated' ? 'accumulated' : 'dates';
    const relevantActivities = state.learningActivities
        .filter(activity => activity && activity.classId === classId)
        .filter(activity => isActivityWithinTerm(activity, termRange, calculationMode))
        .filter(activity => {
            const rubricItems = Array.isArray(activity?.rubric?.items) ? activity.rubric.items : [];
            return rubricItems.some(item => item?.scoring?.mode === 'numeric');
        });

    const studentCategoryTotals = new Map();
    studentIds.forEach(studentId => {
        studentCategoryTotals.set(studentId, new Map());
    });

    relevantActivities.forEach(activity => {
        const metadata = normalizeNumericActivityMetadata(activity);
        if (!metadata.categoryId || !categoryMap.has(metadata.categoryId)) {
            return;
        }

        const activityWeight = metadata.weight;
        if (!Number.isFinite(activityWeight) || activityWeight <= 0) {
            return;
        }

        studentIds.forEach(studentId => {
            const evaluation = computeStudentNumericScoreForActivity(activity, studentId);
            if (!evaluation) {
                return;
            }
            if (evaluation.exempt) {
                return;
            }

            const categoryTotals = studentCategoryTotals.get(studentId);
            if (!categoryTotals) {
                return;
            }

            if (!categoryTotals.has(metadata.categoryId)) {
                categoryTotals.set(metadata.categoryId, {
                    weightedScore: 0,
                    totalWeight: 0,
                });
            }
            const totals = categoryTotals.get(metadata.categoryId);

            let scoreOutOfTen = 0;
            if (evaluation.maxScore > 0) {
                const normalizedScore = Math.max(0, Math.min(evaluation.score || 0, evaluation.maxScore));
                scoreOutOfTen = (normalizedScore / evaluation.maxScore) * 10;
            }

            totals.weightedScore += scoreOutOfTen * activityWeight;
            totals.totalWeight += activityWeight;
        });
    });

    const totalCategoryWeight = categories.reduce((sum, category) => {
        const weight = Number(category.weight);
        return sum + (Number.isFinite(weight) && weight > 0 ? weight : 0);
    }, 0);

    const result = { students: {} };
    const recordForOverrides = existingRecord && typeof existingRecord === 'object'
        ? existingRecord
        : null;

    studentIds.forEach(studentId => {
        const categoryTotals = studentCategoryTotals.get(studentId) || new Map();
        const previousStudent = recordForOverrides?.students?.[studentId];
        const computedStudent = {
            criteria: {},
            competencies: {},
            final: createEmptyTermGradeEntry(),
        };

        let finalAccumulator = 0;
        let finalWeightSum = 0;

        categories.forEach(category => {
            const totals = categoryTotals.get(category.id);
            const previousEntry = previousStudent?.competencies?.[category.id];
            const isManual = Boolean(previousEntry?.isManual);
            let computedScore = '';
            if (totals && totals.totalWeight > 0) {
                const average = totals.weightedScore / totals.totalWeight;
                computedScore = formatNumericScore(average);
                const categoryWeight = Number(category.weight);
                if (Number.isFinite(categoryWeight) && categoryWeight > 0) {
                    finalAccumulator += average * categoryWeight;
                    finalWeightSum += categoryWeight;
                }
            }

            const numericScore = isManual && typeof previousEntry?.numericScore !== 'undefined'
                ? previousEntry.numericScore
                : computedScore;

            computedStudent.competencies[category.id] = {
                numericScore,
                levelId: '',
                isManual,
                noteSymbols: Array.isArray(previousEntry?.noteSymbols)
                    ? previousEntry.noteSymbols.filter(Boolean)
                    : [],
                isLocked: false,
            };
        });

        const previousFinal = previousStudent?.final;
        const finalIsManual = Boolean(previousFinal?.isManual);
        const computedFinal = finalWeightSum > 0
            ? formatNumericScore(finalAccumulator / finalWeightSum)
            : '';

        computedStudent.final = {
            numericScore: finalIsManual && typeof previousFinal?.numericScore !== 'undefined'
                ? previousFinal.numericScore
                : computedFinal,
            levelId: '',
            isManual: finalIsManual,
            noteSymbols: Array.isArray(previousFinal?.noteSymbols)
                ? previousFinal.noteSymbols.filter(Boolean)
                : [],
            isLocked: false,
        };

        result.students[studentId] = computedStudent;
    });

    return result;
}

export function calculateTermGradesForClassTerm(classId, termId, mode = 'dates', existingRecord = null) {
    const targetClass = state.activities.find(activity => activity && activity.type === 'class' && activity.id === classId);
    if (!targetClass) {
        return { students: {} };
    }

    const normalizedConfig = normalizeEvaluationConfig(state.evaluationSettings[classId]);
    if (normalizedConfig.modality === EVALUATION_MODALITIES.NUMERIC) {
        return calculateNumericTermGrades(targetClass, normalizedConfig, termId, mode, existingRecord);
    }
    const competencies = Array.isArray(targetClass.competencies) ? targetClass.competencies : [];
    const competencyIds = competencies.map(comp => comp.id).filter(Boolean);
    const competencySet = new Set(competencyIds);
    const criterionOrderByCompetency = new Map();
    const criterionSet = new Set();

    competencies.forEach(comp => {
        const criteria = Array.isArray(comp.criteria) ? comp.criteria : [];
        const criterionIds = criteria.map(criterion => {
            if (criterion?.id) {
                criterionSet.add(criterion.id);
            }
            return criterion?.id;
        }).filter(Boolean);
        criterionOrderByCompetency.set(comp.id, criterionIds);
    });

    const studentIds = Array.isArray(targetClass.studentIds) ? targetClass.studentIds : [];
    const studentSet = new Set(studentIds);
    const studentData = new Map();
    studentIds.forEach(studentId => {
        studentData.set(studentId, {
            criteria: new Map(),
            competencies: new Map(),
        });
    });

    const termRange = getTermDateRangeById(termId);
    const calculationMode = mode === 'accumulated' ? 'accumulated' : 'dates';
    const relevantActivities = state.learningActivities
        .filter(activity => activity && activity.classId === classId)
        .filter(activity => isActivityWithinTerm(activity, termRange, calculationMode));

    relevantActivities.forEach(activity => {
        const rubric = activity?.rubric;
        const rubricItems = Array.isArray(rubric?.items) ? rubric.items : [];
        if (rubricItems.length === 0) {
            return;
        }
        const evaluations = rubric?.evaluations && typeof rubric.evaluations === 'object'
            ? rubric.evaluations
            : {};
        const activityWeight = Number.isFinite(Number(activity?.weight))
            ? Number(activity.weight)
            : 1;

        rubricItems.forEach(item => {
            const competencyId = item?.competencyId;
            const criterionId = item?.criterionId;
            if (!competencySet.has(competencyId) || !criterionSet.has(criterionId)) {
                return;
            }
            const criterionWeight = Number.isFinite(Number(item?.weight))
                ? Number(item.weight)
                : 1;

            Object.entries(evaluations).forEach(([studentId, evaluation]) => {
                if (!studentSet.has(studentId)) {
                    return;
                }
                const studentRecord = studentData.get(studentId);
                if (!studentRecord) {
                    return;
                }
                const flags = evaluation?.flags && typeof evaluation.flags === 'object' ? evaluation.flags : {};
                const scores = evaluation?.scores && typeof evaluation.scores === 'object' ? evaluation.scores : {};
                const isNotPresented = Boolean(flags.notPresented);
                const isExempt = Boolean(flags.exempt);
                if (isExempt) {
                    return;
                }
                const scoringMode = item?.scoring?.mode === 'numeric' ? 'numeric' : 'competency';
                const rawScore = scores[item.id];
                let levelId = '';
                let numericScoreOverride = null;

                if (isNotPresented) {
                    levelId = 'NP';
                    numericScoreOverride = 0;
                } else if (scoringMode === 'numeric') {
                    const numericValue = parseRubricNumericScore(rawScore);
                    const maxScore = item?.scoring?.maxScore;
                    if (Number.isFinite(numericValue) && Number.isFinite(Number(maxScore))) {
                        const numericResult = computeNumericEvidence(numericValue, maxScore, null, { normalizedConfig });
                        if (numericResult.levelId) {
                            levelId = numericResult.levelId;
                        }
                        if (Number.isFinite(numericResult.normalizedScore)) {
                            numericScoreOverride = numericResult.normalizedScore;
                        }
                    }
                } else if (typeof rawScore === 'string') {
                    levelId = rawScore;
                }

                if (!levelId) {
                    return;
                }

                if (!studentRecord.criteria.has(criterionId)) {
                    studentRecord.criteria.set(criterionId, []);
                }
                if (!studentRecord.competencies.has(competencyId)) {
                    studentRecord.competencies.set(competencyId, []);
                }

                const evidence = { levelId, activityWeight, criterionWeight };
                if (Number.isFinite(numericScoreOverride)) {
                    evidence.numericScore = numericScoreOverride;
                }
                studentRecord.criteria.get(criterionId).push(evidence);
                studentRecord.competencies.get(competencyId).push(evidence);
            });
        });
    });

    const aggregation = normalizedConfig.competency.aggregation;
    const failLevels = new Set(['NA']);
    const maxNotAchieved = normalizedConfig.competency.maxNotAchieved || {};
    const limitValue = termId === 'all'
        ? maxNotAchieved.course
        : maxNotAchieved.term;
    const failLimit = Number.isFinite(limitValue) ? limitValue : 0;

    const result = { students: {} };
    const recordForOverrides = existingRecord && typeof existingRecord === 'object'
        ? existingRecord
        : null;
    const validLevelIds = new Set(
        Array.isArray(normalizedConfig?.competency?.levels)
            ? normalizedConfig.competency.levels.map(level => level.id).filter(Boolean)
            : []
    );

    studentIds.forEach(studentId => {
        const studentRecord = studentData.get(studentId) || { criteria: new Map(), competencies: new Map() };
        const computedStudent = {
            criteria: {},
            competencies: {},
            final: createEmptyTermGradeEntry(),
        };
        const previousStudentRecord = recordForOverrides?.students?.[studentId];

        let caFails = 0;
        let ceFails = 0;
        const ceEvidencesForFinal = [];
        const caEvidencesForTie = [];

        competencies.forEach(comp => {
            const compId = comp.id;
            const competencyEvidences = studentRecord.competencies.get(compId) || [];
            const previousCompEntry = previousStudentRecord?.competencies?.[compId];
            const hasPreviousQualification = previousCompEntry
                && ((previousCompEntry.numericScore && String(previousCompEntry.numericScore).trim() !== '')
                    || (previousCompEntry.levelId && String(previousCompEntry.levelId).trim() !== ''));
            const hasQualification = competencyEvidences.length > 0 || hasPreviousQualification;

            if (!hasQualification) {
                computedStudent.competencies[compId] = {
                    ...createEmptyTermGradeEntry(),
                    isLocked: true,
                };

                const criterionIds = criterionOrderByCompetency.get(compId) || [];
                criterionIds.forEach(criterionId => {
                    computedStudent.criteria[criterionId] = {
                        ...createEmptyTermGradeEntry(),
                        isLocked: true,
                    };
                });
                return;
            }

            const compResult = aggregation === COMPETENCY_AGGREGATIONS.MAJORITY
                ? calculateMajorityCompetencyResult(competencyEvidences, normalizedConfig)
                : calculateWeightedCompetencyResult(competencyEvidences, normalizedConfig);
            const computedCompNotes = [];
            if (aggregation === COMPETENCY_AGGREGATIONS.MAJORITY && compResult.tieBreak && !compResult.tieBreak.resolved) {
                computedCompNotes.push('*');
            }
            const compManual = Boolean(previousCompEntry?.isManual);
            const manualCompNotes = Array.isArray(previousCompEntry?.noteSymbols)
                ? previousCompEntry.noteSymbols.filter(Boolean)
                : [];
            const compNotes = compManual ? manualCompNotes : computedCompNotes;

            let compLevelId = compResult.levelId || '';
            if (compManual && previousCompEntry?.levelId && validLevelIds.has(previousCompEntry.levelId)) {
                compLevelId = previousCompEntry.levelId;
            } else if (compManual && previousCompEntry?.levelId && !compLevelId) {
                compLevelId = previousCompEntry.levelId;
            }
            const formattedCompNumeric = formatNumericScore(compResult.numericScore);
            let compNumericScore = formattedCompNumeric;
            if (compManual && typeof previousCompEntry?.numericScore !== 'undefined') {
                compNumericScore = previousCompEntry.numericScore;
            }

            computedStudent.competencies[compId] = {
                numericScore: compNumericScore,
                levelId: compLevelId,
                isManual: compManual,
                noteSymbols: compNotes,
                isLocked: false,
            };

            const levelForAggregation = validLevelIds.has(compLevelId) ? compLevelId : '';
            if (levelForAggregation && failLevels.has(levelForAggregation)) {
                ceFails += 1;
            }
            let evidenceWeight = sumEvidenceWeights(competencyEvidences);
            if (levelForAggregation && evidenceWeight <= 0 && compManual) {
                evidenceWeight = 1;
            }
            if (levelForAggregation) {
                ceEvidencesForFinal.push({
                    levelId: levelForAggregation,
                    activityWeight: evidenceWeight,
                    criterionWeight: 1,
                });
            }

            const criterionIds = criterionOrderByCompetency.get(compId) || [];
            criterionIds.forEach(criterionId => {
                const criterionEvidences = studentRecord.criteria.get(criterionId) || [];
                const criterionResult = aggregation === COMPETENCY_AGGREGATIONS.MAJORITY
                    ? calculateMajorityCompetencyResult(criterionEvidences, normalizedConfig)
                    : calculateWeightedCompetencyResult(criterionEvidences, normalizedConfig);
                const computedCriterionNotes = [];
                if (aggregation === COMPETENCY_AGGREGATIONS.MAJORITY && criterionResult.tieBreak && !criterionResult.tieBreak.resolved) {
                    computedCriterionNotes.push('*');
                }
                const previousCriterionEntry = previousStudentRecord?.criteria?.[criterionId];
                const criterionManual = Boolean(previousCriterionEntry?.isManual);
                const manualCriterionNotes = Array.isArray(previousCriterionEntry?.noteSymbols)
                    ? previousCriterionEntry.noteSymbols.filter(Boolean)
                    : [];
                const criterionNotes = criterionManual ? manualCriterionNotes : computedCriterionNotes;

                let criterionLevelId = criterionResult.levelId || '';
                if (criterionManual && previousCriterionEntry?.levelId && validLevelIds.has(previousCriterionEntry.levelId)) {
                    criterionLevelId = previousCriterionEntry.levelId;
                } else if (criterionManual && previousCriterionEntry?.levelId && !criterionLevelId) {
                    criterionLevelId = previousCriterionEntry.levelId;
                }
                const formattedCriterionNumeric = formatNumericScore(criterionResult.numericScore);
                let criterionNumericScore = formattedCriterionNumeric;
                if (criterionManual && typeof previousCriterionEntry?.numericScore !== 'undefined') {
                    criterionNumericScore = previousCriterionEntry.numericScore;
                }

                computedStudent.criteria[criterionId] = {
                    numericScore: criterionNumericScore,
                    levelId: criterionLevelId,
                    isManual: criterionManual,
                    noteSymbols: criterionNotes,
                    isLocked: false,
                };

                const levelForTie = validLevelIds.has(criterionLevelId) ? criterionLevelId : '';
                if (levelForTie) {
                    if (failLevels.has(levelForTie)) {
                        caFails += 1;
                    }
                    caEvidencesForTie.push({ levelId: levelForTie });
                }
            });
        });

        const finalNotes = [];
        let finalLevel = '';
        let finalNumeric = '';

        if (ceEvidencesForFinal.length === 0) {
            computedStudent.final = createEmptyTermGradeEntry();
            result.students[studentId] = computedStudent;
            return;
        }

        if (caFails > failLimit || ceFails > failLimit) {
            finalLevel = 'NA';
            finalNumeric = formatNumericScore(qualitativeToNumeric('NA', normalizedConfig));
        } else if (aggregation === COMPETENCY_AGGREGATIONS.WEIGHTED_AVERAGE) {
            const weightedFinal = calculateWeightedCompetencyResult(ceEvidencesForFinal, normalizedConfig);
            finalLevel = weightedFinal.levelId || '';
            finalNumeric = formatNumericScore(weightedFinal.numericScore);
        } else {
            const majorityFinal = computeMajorityData(ceEvidencesForFinal, normalizedConfig);
            if (majorityFinal.winners.length === 0) {
                finalLevel = majorityFinal.fallbackLevel;
                finalNumeric = formatNumericScore(qualitativeToNumeric(finalLevel, normalizedConfig));
            } else if (majorityFinal.winners.length === 1) {
                finalLevel = majorityFinal.winners[0];
                finalNumeric = formatNumericScore(qualitativeToNumeric(finalLevel, normalizedConfig));
            } else {
                const caMajority = computeMajorityData(caEvidencesForTie, normalizedConfig);
                if (caMajority.winners.length === 1) {
                    finalLevel = caMajority.winners[0];
                    finalNumeric = formatNumericScore(qualitativeToNumeric(finalLevel, normalizedConfig));
                    finalNotes.push('**');
                } else {
                    const weightedFinal = calculateWeightedCompetencyResult(ceEvidencesForFinal, normalizedConfig);
                    finalLevel = weightedFinal.levelId || '';
                    finalNumeric = formatNumericScore(weightedFinal.numericScore);
                    finalNotes.push('*');
                }
            }
        }

        computedStudent.final = {
            numericScore: finalNumeric,
            levelId: finalLevel,
            isManual: false,
            noteSymbols: finalNotes,
            isLocked: false,
        };

        result.students[studentId] = computedStudent;
    });

    return result;
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

function clearEvaluationFeedback(classId) {
    if (!classId) {
        return;
    }
    if (!state.evaluationSettingsFeedback || typeof state.evaluationSettingsFeedback !== 'object') {
        state.evaluationSettingsFeedback = {};
    }
    delete state.evaluationSettingsFeedback[classId];
}

function setEvaluationFeedback(classId, payload) {
    if (!classId) {
        return;
    }
    if (!state.evaluationSettingsFeedback || typeof state.evaluationSettingsFeedback !== 'object') {
        state.evaluationSettingsFeedback = {};
    }
    state.evaluationSettingsFeedback[classId] = payload;
}

function ensureRubricHasItemForCriterion(rubric, competencyId, criterionId) {
    if (!rubric) return null;

    const exists = Array.isArray(rubric.items)
        ? rubric.items.some(item => item.competencyId === competencyId && item.criterionId === criterionId)
        : false;

    if (exists) {
        return null;
    }

    const newItem = {
        id: generateRubricItemId(),
        competencyId,
        criterionId,
        weight: 1,
        levelComments: createDefaultLevelComments(),
        scoring: { mode: 'competency', maxScore: null },
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
        const matches = item.competencyId === competencyId && item.criterionId === criterionId;
        if (matches) {
            removedIds.push(item.id);
        }
        return !matches;
    });

    cleanRubricEvaluations(rubric, removedIds);
    return removedIds;
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
            <li><strong>${t('import_summary_learning_activities')}:</strong> ${data.learningActivities?.length || 0}</li>
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
            if (tabId === 'evaluation') {
                const classes = state.activities
                    .filter(activity => activity.type === 'class')
                    .sort((a, b) => a.name.localeCompare(b.name));
                if (classes.length === 0) {
                    state.settingsEvaluationSelectedClassId = null;
                    return;
                }
                const existing = classes.find(cls => cls.id === state.settingsEvaluationSelectedClassId);
                const targetClass = existing || classes[0];
                state.settingsEvaluationSelectedClassId = targetClass?.id || null;
                if (targetClass?.id) {
                    ensureEvaluationDraft(targetClass.id);
                }
            }
        }
    },

    'select-settings-evaluation-class': (id, element) => {
        const classId = element?.value || element?.dataset?.classId;
        if (!classId) {
            return;
        }
        state.settingsEvaluationSelectedClassId = classId;
        ensureEvaluationDraft(classId);
        clearEvaluationFeedback(classId);
    },

    'change-evaluation-modality': (id, element) => {
        const classId = element?.dataset?.classId;
        const modality = element?.value;
        if (!classId || !modality || !Object.values(EVALUATION_MODALITIES).includes(modality)) {
            return;
        }
        const draft = ensureEvaluationDraft(classId);
        if (!draft) return;
        draft.modality = modality;
        clearEvaluationFeedback(classId);
    },

    'update-competency-level-value': (id, element) => {
        const classId = element?.dataset?.classId;
        const levelId = element?.dataset?.levelId;
        if (!classId || !levelId) {
            return;
        }
        const draft = ensureEvaluationDraft(classId);
        if (!draft) return;
        const rawValue = element.value;
        const level = draft.competency.levels.find(l => l.id === levelId);
        if (!level) return;
        level.numericValue = rawValue === '' ? '' : Number(rawValue);
        if (Number.isNaN(level.numericValue)) {
            level.numericValue = '';
        }
        clearEvaluationFeedback(classId);
    },

    'update-competency-minimum': (id, element) => {
        const classId = element?.dataset?.classId;
        const target = element?.dataset?.minimumId;
        if (!classId || !target) {
            return;
        }
        const draft = ensureEvaluationDraft(classId);
        if (!draft) return;
        const rawValue = element.value;
        draft.competency.minimums[target] = rawValue === '' ? '' : Number(rawValue);
        if (Number.isNaN(draft.competency.minimums[target])) {
            draft.competency.minimums[target] = '';
        }
        clearEvaluationFeedback(classId);
    },

    'update-competency-max-not-achieved': (id, element) => {
        const classId = element?.dataset?.classId;
        const scope = element?.dataset?.scope;
        if (!classId || !scope) {
            return;
        }
        const draft = ensureEvaluationDraft(classId);
        if (!draft) return;
        const rawValue = element.value;
        draft.competency.maxNotAchieved[scope] = rawValue === '' ? '' : Number(rawValue);
        if (Number.isNaN(draft.competency.maxNotAchieved[scope])) {
            draft.competency.maxNotAchieved[scope] = '';
        }
        clearEvaluationFeedback(classId);
    },

    'update-competency-aggregation': (id, element) => {
        const classId = element?.dataset?.classId;
        const aggregation = element?.value;
        if (!classId || !aggregation || !Object.values(COMPETENCY_AGGREGATIONS).includes(aggregation)) {
            return;
        }
        const draft = ensureEvaluationDraft(classId);
        if (!draft) return;
        draft.competency.aggregation = aggregation;
        clearEvaluationFeedback(classId);
    },

    'set-evaluation-no-evidence-behavior': (id, element) => {
        const classId = element?.dataset?.classId;
        const behavior = element?.value;
        if (!classId || !behavior || !Object.values(NO_EVIDENCE_BEHAVIOR).includes(behavior)) {
            return;
        }
        const draft = ensureEvaluationDraft(classId);
        if (!draft) return;
        draft.competency.calculation.noEvidenceBehavior = behavior;
        if (behavior === NO_EVIDENCE_BEHAVIOR.LOWEST_LEVEL) {
            draft.competency.calculation.noEvidenceLevelId = 'NP';
        }
        clearEvaluationFeedback(classId);
    },

    'set-evaluation-no-evidence-level': (id, element) => {
        const classId = element?.dataset?.classId;
        const levelId = element?.value;
        if (!classId || !levelId) {
            return;
        }
        const draft = ensureEvaluationDraft(classId);
        if (!draft) return;
        draft.competency.calculation.noEvidenceLevelId = levelId;
        clearEvaluationFeedback(classId);
    },

    'set-evaluation-np-treatment': (id, element) => {
        const classId = element?.dataset?.classId;
        const value = element?.value;
        if (!classId || !value || !Object.values(NP_TREATMENTS).includes(value)) {
            return;
        }
        const draft = ensureEvaluationDraft(classId);
        if (!draft) return;
        draft.competency.calculation.npTreatment = value;
        clearEvaluationFeedback(classId);
    },

    'save-evaluation-config': (id, element) => {
        const classId = element?.dataset?.classId;
        if (!classId) {
            return;
        }
        const draft = ensureEvaluationDraft(classId);
        if (!draft) {
            return;
        }
        const validation = validateCompetencyEvaluationConfig(draft);
        if (!validation.isValid) {
            setEvaluationFeedback(classId, {
                type: 'error',
                message: t('evaluation_save_error'),
                details: validation,
            });
            return;
        }
        persistEvaluationDraft(classId);
        const targetClass = state.activities.find(a => a.id === classId);
        if (isTemplateActivity(targetClass)) {
            scheduleTemplateSync(classId);
        }
        setEvaluationFeedback(classId, {
            type: 'success',
            message: t('evaluation_save_success'),
        });
        saveState();
    },

    'reset-evaluation-config': (id, element) => {
        const classId = element?.dataset?.classId;
        if (!classId) {
            return;
        }
        resetEvaluationDraftToDefault(classId);
        setEvaluationFeedback(classId, {
            type: 'info',
            message: t('evaluation_reset_to_defaults'),
        });
        const targetClass = state.activities.find(a => a.id === classId);
        if (isTemplateActivity(targetClass)) {
            scheduleTemplateSync(classId);
        }
    },

    'set-evaluation-tab': (id, element) => {
        const tab = element?.dataset?.tab;
        const allowedTabs = ['activities', 'grades', 'term-grades'];
        if (!tab || !allowedTabs.includes(tab)) return;
        state.evaluationActiveTab = tab;

        if (tab === 'grades' || tab === 'term-grades') {
            const classes = state.activities
                .filter(activity => activity.type === 'class')
                .sort((a, b) => a.name.localeCompare(b.name));
            const hasSelection = classes.some(cls => cls.id === state.selectedEvaluationClassId);
            if (!hasSelection) {
                state.selectedEvaluationClassId = classes[0]?.id || null;
            }
        }
    },

    'select-evaluation-class': (id, element) => {
        const classId = element?.dataset?.classId;
        if (classId) {
            state.selectedEvaluationClassId = classId;
        }
    },
    'select-evaluation-term': (id, element) => {
        if (!element) return;
        const value = element.value || 'all';
        const validIds = new Set((state.terms || []).map(term => term.id));
        state.evaluationSelectedTermId = value !== 'all' && !validIds.has(value) ? 'all' : value;
    },

    'calculate-term-grades': (id, element) => {
        const classId = element?.dataset?.classId;
        if (!classId) {
            return;
        }
        const termId = element?.dataset?.termId || 'all';
        const existingRecord = ensureTermGradeRecordStructure(classId, termId);
        const calculated = calculateTermGradesForClassTerm(classId, termId, state.termGradeCalculationMode, existingRecord);
        const mergedRecord = { students: {} };

        Object.entries(calculated.students).forEach(([studentId, computedStudent]) => {
            const previousStudent = existingRecord.students?.[studentId];
            const mergedStudent = {
                criteria: {},
                competencies: {},
                final: previousStudent?.final?.isManual ? previousStudent.final : computedStudent.final,
            };

            Object.entries(computedStudent.criteria || {}).forEach(([criterionId, computedEntry]) => {
                const previousEntry = previousStudent?.criteria?.[criterionId];
                mergedStudent.criteria[criterionId] = previousEntry?.isManual ? previousEntry : computedEntry;
            });

            Object.entries(computedStudent.competencies || {}).forEach(([competencyId, computedEntry]) => {
                const previousEntry = previousStudent?.competencies?.[competencyId];
                mergedStudent.competencies[competencyId] = previousEntry?.isManual ? previousEntry : computedEntry;
            });

            mergedRecord.students[studentId] = mergedStudent;
        });

        state.termGradeRecords[classId][termId] = mergedRecord;
        saveState();
    },

    'recalculate-term-final-grades': (id, element) => {
        const classId = element?.dataset?.classId;
        if (!classId) {
            return;
        }
        const termId = element?.dataset?.termId || 'all';
        const record = ensureTermGradeRecordStructure(classId, termId);
        const calculated = calculateTermGradesForClassTerm(classId, termId, state.termGradeCalculationMode, record);

        Object.entries(calculated.students || {}).forEach(([studentId, computedStudent]) => {
            const targetStudent = ensureTermGradeStudent(record, studentId);
            const finalEntry = computedStudent?.final || createEmptyTermGradeEntry();
            targetStudent.final = {
                numericScore: finalEntry.numericScore,
                levelId: finalEntry.levelId,
                isManual: false,
                noteSymbols: Array.isArray(finalEntry.noteSymbols) ? [...finalEntry.noteSymbols] : [],
                isLocked: Boolean(finalEntry.isLocked),
            };
        });

        saveState();
    },

    'clear-term-grades': (id, element) => {
        const classId = element?.dataset?.classId;
        if (!classId) {
            return;
        }
        const termId = element?.dataset?.termId || 'all';
        const classRecords = state.termGradeRecords?.[classId];
        if (!classRecords || !classRecords[termId]) {
            return;
        }

        delete classRecords[termId];
        if (Object.keys(classRecords).length === 0) {
            delete state.termGradeRecords[classId];
        }
        saveState();
    },

    'update-term-grade-numeric': (id, element) => {
        const classId = element?.dataset?.classId;
        const studentId = element?.dataset?.studentId;
        const scope = element?.dataset?.scope;
        const targetId = element?.dataset?.targetId;
        if (!classId || !studentId || !scope || element?.dataset?.locked === 'true') {
            return;
        }
        const termId = element?.dataset?.termId || 'all';
        const record = ensureTermGradeRecordStructure(classId, termId);
        const entry = ensureTermGradeEntry(record, studentId, scope, scope === 'final' ? 'final' : targetId);
        entry.numericScore = element.value;
        entry.isManual = true;
        entry.noteSymbols = [];
        saveState();
    },

    'update-term-grade-level': (id, element) => {
        const classId = element?.dataset?.classId;
        const studentId = element?.dataset?.studentId;
        const scope = element?.dataset?.scope;
        const targetId = element?.dataset?.targetId;
        if (!classId || !studentId || !scope || element?.dataset?.locked === 'true') {
            return;
        }
        const termId = element?.dataset?.termId || 'all';
        const record = ensureTermGradeRecordStructure(classId, termId);
        const entry = ensureTermGradeEntry(record, studentId, scope, scope === 'final' ? 'final' : targetId);
        entry.levelId = element.value || '';
        entry.isManual = true;
        entry.noteSymbols = [];
        if (element) {
            element.dataset.selectedLevel = element.value || 'none';
        }
        saveState();
    },

    'set-term-grade-calculation-mode': (id, element) => {
        const value = element?.value === 'accumulated' ? 'accumulated' : 'dates';
        state.termGradeCalculationMode = value;
        saveState();
    },

    'toggle-term-grade-competency': (id, element) => {
        const classId = element?.dataset?.classId;
        const competencyId = element?.dataset?.competencyId;
        if (!classId || !competencyId) {
            return;
        }
        const termId = element?.dataset?.termId || 'all';

        if (!state.termGradeExpandedCompetencies || typeof state.termGradeExpandedCompetencies !== 'object') {
            state.termGradeExpandedCompetencies = {};
        }
        if (!state.termGradeExpandedCompetencies[classId] || typeof state.termGradeExpandedCompetencies[classId] !== 'object') {
            state.termGradeExpandedCompetencies[classId] = {};
        }

        const existing = state.termGradeExpandedCompetencies[classId][termId];
        const currentSet = new Set(Array.isArray(existing) ? existing : []);
        if (currentSet.has(competencyId)) {
            currentSet.delete(competencyId);
        } else {
            currentSet.add(competencyId);
        }
        state.termGradeExpandedCompetencies[classId][termId] = Array.from(currentSet);
        saveState();
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
                }));
                state.students = data.students || [];
                state.timeSlots = data.timeSlots || [];
                state.schedule = data.schedule || {};
                state.scheduleOverrides = data.scheduleOverrides || [];
                state.classEntries = data.classEntries || {};
                state.courseStartDate = data.courseStartDate || '';
                state.courseEndDate = data.courseEndDate || '';
                state.terms = data.terms || [];
                state.termGradeRecords = {};
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
                state.learningActivities.forEach(activity => {
                    syncRubricWithActivityCriteria(activity);
                });
                saveLearningActivitiesChange();
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
                saveLearningActivitiesChange();

                state.learningActivityDraft = {
                    ...existing,
                    criteriaRefs: Array.isArray(existing.criteriaRefs) ? [...existing.criteriaRefs] : [],
                    isNew: false,
                    startDate: existing.startDate || '',
                    endDate: existing.endDate || '',
                    rubric: normalizeRubric(existing?.rubric),
                    status: existing?.status || LEARNING_ACTIVITY_STATUS.SCHEDULED,
                    statusIsManual: Boolean(existing?.statusIsManual),
                    weight: typeof existing?.weight === 'number' && !Number.isNaN(existing.weight)
                        ? existing.weight
                        : 1,
                    shortCode: typeof existing?.shortCode === 'string' ? existing.shortCode : '',
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
                    statusIsManual: false,
                    weight: 1,
                    shortCode: '',
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

        if (!state.learningActivityDraft.statusIsManual) {
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
            statusIsManual: false,
            weight: 1,
            shortCode: '',
        };
        syncRubricWithActivityCriteria(state.learningActivityDraft);

        const todayString = formatDate(new Date());
        state.learningActivityDraft.startDate = todayString;
        state.learningActivityDraft.endDate = computeDefaultEndDate(todayString);
        state.learningActivityDraft.status = calculateLearningActivityStatus(state.learningActivityDraft);

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
    'update-learning-activity-short-code': (id, element) => {
        if (!state.learningActivityDraft) return;
        state.learningActivityDraft.shortCode = element.value;
    },
    'update-learning-activity-description': (id, element) => {
        if (!state.learningActivityDraft) return;
        state.learningActivityDraft.description = element.value;
    },
    'update-learning-activity-start-date': (id, element) => {
        if (!state.learningActivityDraft) return;
        const previousStart = state.learningActivityDraft.startDate || '';
        const previousEnd = state.learningActivityDraft.endDate || '';
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
        const previousDefaultEnd = previousStart ? computeDefaultEndDate(previousStart) : '';
        const shouldUpdateEnd = !previousEnd || previousEnd === previousDefaultEnd;

        if (shouldUpdateEnd) {
            state.learningActivityDraft.endDate = computedEnd;
            if (endInput) {
                endInput.value = computedEnd;
            }
        }
    },
    'update-learning-activity-end-date': (id, element) => {
        if (!state.learningActivityDraft) return;
        state.learningActivityDraft.endDate = element.value;
    },
    'update-learning-activity-status': (id, element) => {
        if (!state.learningActivityDraft) return;
        const value = element.value;
        if (value === 'auto') {
            state.learningActivityDraft.statusIsManual = false;
            state.learningActivityDraft.status = calculateLearningActivityStatus(state.learningActivityDraft);
            return;
        }

        if (Object.values(LEARNING_ACTIVITY_STATUS).includes(value)) {
            state.learningActivityDraft.statusIsManual = true;
            state.learningActivityDraft.status = value;
        }
    },
    'update-learning-activity-weight': (id, element) => {
        if (!state.learningActivityDraft) return;
        const parsed = Number.parseFloat(element.value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            state.learningActivityDraft.weight = parsed;
        } else if (element.value === '') {
            state.learningActivityDraft.weight = '';
        }
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

        const shortCode = draft.shortCode?.trim() || '';
        if (!shortCode) {
            alert(t('activities_identifier_required'));
            return;
        }

        const now = new Date().toISOString();
        syncRubricWithActivityCriteria(draft);
        const normalizedRubric = normalizeRubric(draft.rubric);
        const weightValue = Number.parseFloat(draft.weight);
        const normalizedWeight = Number.isFinite(weightValue) && weightValue >= 0 ? weightValue : 1;
        let persistedStatus;
        if (draft.statusIsManual && Object.values(LEARNING_ACTIVITY_STATUS).includes(draft.status)) {
            persistedStatus = draft.status;
        } else {
            persistedStatus = calculateLearningActivityStatus({
                startDate: draft.startDate,
                endDate: draft.endDate,
                status: draft.status,
            });
        }

        if (draft.isNew) {
            state.learningActivities.push({
                id: draft.id,
                classId: draft.classId,
                title,
                shortCode,
                description: draft.description?.trim() || '',
                criteriaRefs: Array.isArray(draft.criteriaRefs) ? [...draft.criteriaRefs] : [],
                createdAt: now,
                updatedAt: now,
                startDate: draft.startDate || '',
                endDate: draft.endDate || '',
                rubric: normalizedRubric,
                status: persistedStatus,
                statusIsManual: Boolean(draft.statusIsManual && Object.values(LEARNING_ACTIVITY_STATUS).includes(draft.status)),
                weight: normalizedWeight,
            });
        } else {
            const index = state.learningActivities.findIndex(act => act.id === draft.id);
            const persisted = {
                id: draft.id,
                classId: draft.classId,
                title,
                shortCode,
                description: draft.description?.trim() || '',
                criteriaRefs: Array.isArray(draft.criteriaRefs) ? [...draft.criteriaRefs] : [],
                createdAt: draft.createdAt || now,
                updatedAt: now,
                startDate: draft.startDate || '',
                endDate: draft.endDate || '',
                rubric: normalizedRubric,
                status: persistedStatus,
                statusIsManual: Boolean(draft.statusIsManual && Object.values(LEARNING_ACTIVITY_STATUS).includes(draft.status)),
                weight: normalizedWeight,
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
        const targetClass = state.activities.find(a => a.id === draft.classId);
        if (isTemplateActivity(targetClass)) {
            scheduleTemplateSync(targetClass.id);
        }
        saveLearningActivitiesChange();
    },
    'delete-learning-activity': (id, element) => {
        const activityId = element?.dataset?.learningActivityId || state.learningActivityDraft?.id;
        if (!activityId) return;

        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;

        showModal(t('delete_activity_confirm_title'), t('delete_activity_confirm_text'), () => {
            state.learningActivities = state.learningActivities.filter(act => act.id !== activityId);

            if (state.learningActivityDraft?.id === activityId) {
                state.learningActivityDraft = null;
            }

            if (state.activeLearningActivityRubricId === activityId) {
                state.activeLearningActivityRubricId = null;
                state.learningActivityRubricReturnView = null;
            }

            if (state.pendingEvaluationHighlightActivityId === activityId) {
                state.pendingEvaluationHighlightActivityId = null;
            }

            state.learningActivityCriteriaModalOpen = false;
            state.learningActivityGuideVisible = false;

            const parentClass = state.activities.find(a => a.id === activity.classId);
            if (isTemplateActivity(parentClass)) {
                scheduleTemplateSync(parentClass.id);
            }
            saveLearningActivitiesChange();
            state.activeView = 'activities';
            document.dispatchEvent(new CustomEvent('render'));
        });
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

    'toggle-competency-list': (id, element) => {
        const classId = element.dataset.classId;
        if (!classId) return;

        const expanded = Array.isArray(state.expandedCompetencyClassIds)
            ? [...state.expandedCompetencyClassIds]
            : [];
        const index = expanded.indexOf(classId);
        if (index === -1) {
            expanded.push(classId);
        } else {
            expanded.splice(index, 1);
        }
        state.expandedCompetencyClassIds = expanded;
    },

    'go-to-evaluation-for-learning-activity': (id, element) => {
        const draft = state.learningActivityDraft;
        const activityId = element?.dataset?.learningActivityId || draft?.id || null;
        const classId = element?.dataset?.classId || draft?.classId || null;

        if (classId) {
            state.selectedEvaluationClassId = classId;
        }

        if (activityId) {
            const activity = state.learningActivities.find(act => act.id === activityId);
            if (activity) {
                const previousView = state.activeView;
                state.learningActivityRubricReturnView = previousView;
                syncRubricWithActivityCriteria(activity);
                saveLearningActivitiesChange();
                state.activeLearningActivityRubricId = activityId;
                state.learningActivityRubricTab = 'assessment';
                state.learningActivityRubricFilter = '';
                state.pendingEvaluationHighlightActivityId = null;
                state.activeView = 'learningActivityRubric';
                return;
            }
        }

        state.pendingEvaluationHighlightActivityId = activityId;
        state.evaluationActiveTab = 'activities';
        state.activeView = 'evaluation';
    },

    // --- Rubric Actions ---
    'open-learning-activity-rubric': (id, element) => {
        const activityId = element?.dataset?.learningActivityId || state.learningActivityDraft?.id;
        if (!activityId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const previousView = state.activeView;
        const openAssessmentTab = previousView === 'evaluation';
        state.learningActivityRubricReturnView = previousView;
        syncRubricWithActivityCriteria(activity);
        saveLearningActivitiesChange();
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
            competencyId,
            criterionId,
            weight: 1,
            generalComment: '',
            levelComments: createDefaultLevelComments(),
            scoring: { mode: 'competency', maxScore: null },
        });
        ensureActivityHasCriterionRef(activity, competencyId, criterionId);
        select.value = '';
        saveLearningActivitiesChange();
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
                const stillPresent = rubric.items.some(item =>
                    item.competencyId === removed.competencyId && item.criterionId === removed.criterionId
                );
                if (!stillPresent) {
                    removeCriterionRefFromActivity(activity, removed.competencyId, removed.criterionId);
                }
            }
            saveLearningActivitiesChange();
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
        saveLearningActivitiesChange();
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
        if (!item) return;
        const value = parseFloat(element.value);
        item.weight = Number.isFinite(value) ? value : 1;
        saveLearningActivitiesChange();
    },
    'update-rubric-item-scoring-mode': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        if (!activityId || !itemId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const item = rubric.items.find(entry => entry.id === itemId);
        if (!item) return;
        const previousMode = item.scoring?.mode === 'numeric' ? 'numeric' : 'competency';
        const newMode = element.value === 'numeric' ? 'numeric' : 'competency';
        if (newMode === 'numeric') {
            const parsedMax = Number(item.scoring?.maxScore);
            const maxScore = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 10;
            item.scoring = { mode: 'numeric', maxScore };
        } else {
            item.scoring = { mode: 'competency', maxScore: null };
        }
        if (newMode !== previousMode) {
            cleanRubricEvaluations(rubric, [item.id]);
        }
        saveLearningActivitiesChange();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'update-rubric-item-max-score': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        if (!activityId || !itemId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const item = rubric.items.find(entry => entry.id === itemId);
        if (!item || item.scoring?.mode !== 'numeric') return;
        const { number, hasValue } = parseLocaleNumberInput(element.value);
        if (!hasValue) {
            document.dispatchEvent(new CustomEvent('render'));
            return;
        }
        if (!Number.isFinite(number) || number <= 0) {
            document.dispatchEvent(new CustomEvent('render'));
            return;
        }
        item.scoring.maxScore = number;
        saveLearningActivitiesChange();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'update-rubric-item-general-comment': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        if (!activityId || !itemId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const item = rubric.items.find(entry => entry.id === itemId);
        if (!item) return;
        item.generalComment = element.value;
        saveLearningActivitiesChange();
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
        if (!item) return;
        item.levelComments[level] = element.value;
        saveLearningActivitiesChange();
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
        const item = rubric.items.find(entry => entry.id === itemId);
        if (!item || item.scoring?.mode === 'numeric') return;
        const evaluation = ensureRubricEvaluation(rubric, studentId);
        if (!evaluation || evaluation.flags?.notPresented || evaluation.flags?.exempt) {
            return;
        }
        const current = evaluation.scores[itemId];
        if (current === level) {
            delete evaluation.scores[itemId];
        } else {
            evaluation.scores[itemId] = level;
        }
        saveLearningActivitiesChange();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'set-rubric-numeric-score': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const itemId = element?.dataset?.itemId;
        const studentId = element?.dataset?.studentId;
        if (!activityId || !itemId || !studentId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const item = rubric.items.find(entry => entry.id === itemId);
        if (!item || item.scoring?.mode !== 'numeric') return;
        const evaluation = ensureRubricEvaluation(rubric, studentId);
        if (!evaluation || evaluation.flags?.notPresented || evaluation.flags?.exempt) {
            return;
        }
        const { number, hasValue } = parseLocaleNumberInput(element.value);
        if (!hasValue) {
            delete evaluation.scores[itemId];
            saveLearningActivitiesChange();
            document.dispatchEvent(new CustomEvent('render'));
            return;
        }
        if (!Number.isFinite(number)) {
            document.dispatchEvent(new CustomEvent('render'));
            return;
        }
        const sanitized = Math.max(0, number);
        evaluation.scores[itemId] = { mode: 'numeric', value: sanitized };
        saveLearningActivitiesChange();
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
        saveLearningActivitiesChange();
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
            evaluation.flags.exempt = false;
        }
        saveLearningActivitiesChange();
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
        if (!evaluation || evaluation.flags?.exempt) return;
        const current = Boolean(evaluation.flags?.deliveredLate);
        evaluation.flags.deliveredLate = !current;
        saveLearningActivitiesChange();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'toggle-rubric-exempt': (id, element) => {
        const activityId = element?.dataset?.learningActivityId;
        const studentId = element?.dataset?.studentId;
        if (!activityId || !studentId) return;
        const activity = state.learningActivities.find(act => act.id === activityId);
        if (!activity) return;
        const rubric = ensureLearningActivityRubric(activity);
        const evaluation = ensureRubricEvaluation(rubric, studentId);
        if (!evaluation) return;
        const current = Boolean(evaluation.flags?.exempt);
        evaluation.flags.exempt = !current;
        if (evaluation.flags.exempt) {
            evaluation.flags.notPresented = false;
            evaluation.flags.deliveredLate = false;
            evaluation.scores = {};
        }
        saveLearningActivitiesChange();
        document.dispatchEvent(new CustomEvent('render'));
    },
    'filter-learning-activity-rubric-students': (id, element) => {
        if (!element) return;
        state.learningActivityRubricFilter = element.value;
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
    'filter-student-annotations': (id, element) => {
        const query = element.value.trim().toLowerCase();
        const container = document.querySelector('[data-student-annotations-list]');
        if (!container) return;

        const cards = container.querySelectorAll('[data-student-name]');
        let visibleCount = 0;

        cards.forEach(card => {
            const name = (card.dataset.studentName || '').toLowerCase();
            const matches = name.includes(query);
            const shouldHide = query.length > 0 && !matches;
            card.classList.toggle('hidden', shouldHide);
            if (!shouldHide) {
                visibleCount += 1;
            }
        });

        const emptyMessage = container.querySelector('[data-student-filter-empty]');
        if (emptyMessage) {
            emptyMessage.classList.toggle('hidden', visibleCount > 0);
        }
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

        const expanded = Array.isArray(state.expandedCompetencyClassIds)
            ? [...state.expandedCompetencyClassIds]
            : [];
        if (!expanded.includes(activityId)) {
            expanded.push(activityId);
        }
        state.expandedCompetencyClassIds = expanded;

        if (isTemplateActivity(activity)) {
            scheduleTemplateSync(activity.id);
        }
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
        if (isTemplateActivity(activity)) {
            scheduleTemplateSync(activity.id);
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
        if (isTemplateActivity(activity)) {
            scheduleTemplateSync(activity.id);
        }
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

        if (isTemplateActivity(activity)) {
            scheduleTemplateSync(activity.id);
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

        if (isTemplateActivity(activity)) {
            scheduleTemplateSync(activity.id);
        }
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
        if (isTemplateActivity(activity)) {
            scheduleTemplateSync(activity.id);
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
        if (isTemplateActivity(activity)) {
            scheduleTemplateSync(activity.id);
        }
        saveState();
    },
    'delete-criterion': (id, element) => {
        const { activityId, competencyId, criterionId } = element.dataset;
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity) return;

        const competency = activity.competencies?.find(c => c.id === competencyId);
        if (!competency) return;

        competency.criteria = competency.criteria?.filter(cr => cr.id !== criterionId) || [];
        if (isTemplateActivity(activity)) {
            scheduleTemplateSync(activity.id);
        }
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
            const isTemplate = type === 'template';
            const newActivity = {
                id: crypto.randomUUID(),
                name,
                type: isTemplate ? 'class' : type,
                isTemplate,
                templateId: null,
                studentIds: [],
                color: getRandomPastelColor(),
                startDate: state.courseStartDate,
                endDate: state.courseEndDate,
                competencies: []
            };
            state.activities.push(newActivity);
            nameInput.value = '';
            if (isTemplate) {
                scheduleTemplateSync(newActivity.id);
            }
            saveState();
        }
    },
    'delete-activity': (id) => {
        showModal(t('delete_activity_confirm_title'), t('delete_activity_confirm_text'), () => {
            const target = state.activities.find(a => a.id === id);
            state.activities = state.activities.filter(a => a.id !== id);
            if (target) {
                if (isTemplateActivity(target)) {
                    const templateActivityIds = new Set(
                        state.learningActivities
                            .filter(activity => activity.classId === id)
                            .map(activity => activity.id)
                    );
                    state.activities.forEach(activity => {
                        if (activity.templateId === id) {
                            activity.templateId = null;
                        }
                    });
                    state.learningActivities = state.learningActivities.filter(activity => {
                        if (activity.classId === id) {
                            return false;
                        }
                        if (!activity.templateSourceId) {
                            return true;
                        }
                        return !templateActivityIds.has(activity.templateSourceId);
                    });
                } else {
                    state.learningActivities = state.learningActivities.filter(activity => activity.classId !== id);
                }
            }
            saveLearningActivitiesChange();
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
            if (isTemplateActivity(activity)) {
                scheduleTemplateSync(activity.id);
            }
            saveState();
        }
        state.editingActivityId = null;
    },
    'update-class-template': (id, element) => {
        const activityId = element?.dataset?.activityId;
        if (!activityId) {
            return;
        }
        const activity = state.activities.find(a => a.id === activityId);
        if (!activity || activity.type !== 'class' || activity.isTemplate) {
            return;
        }
        const rawValue = element.value || '';
        const isValidTemplate = state.activities.some(candidate => (
            candidate.id === rawValue
            && isTemplateActivity(candidate)
        ));
        const nextTemplateId = isValidTemplate ? rawValue : null;
        const previousTemplateId = activity.templateId || null;
        if (previousTemplateId === nextTemplateId) {
            return;
        }
        activity.templateId = nextTemplateId;
        if (previousTemplateId) {
            scheduleTemplateSync(previousTemplateId);
        }
        if (nextTemplateId) {
            scheduleTemplateSync(nextTemplateId);
        } else {
            state.learningActivities = state.learningActivities.filter(learningActivity => (
                learningActivity.classId !== activity.id
                || !learningActivity.templateSourceId
            ));
        }
        saveLearningActivitiesChange();
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
            termGradeRecords: state.termGradeRecords,
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
            reader.onload = async (e) => {
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
                    state.settingsActiveTab = data.settingsActiveTab || 'calendar';
                    state.studentTimelineFilter = data.studentTimelineFilter || 'all';
                    state.evaluationActiveTab = data.evaluationActiveTab || 'activities';
                    state.selectedEvaluationClassId = data.selectedEvaluationClassId || null;
                    state.evaluationSelectedTermId = data.evaluationSelectedTermId || 'all';
                    state.termGradeRecords = data.termGradeRecords && typeof data.termGradeRecords === 'object'
                        ? data.termGradeRecords
                        : {};
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
                    await saveLearningActivitiesChange();
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
            reader.onload = async (e) => {
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
                    
                    await saveState();
                    alert(t('import_success_alert'));
                    window.location.reload();
                } catch (error) {
                    alert(t('import_error_alert'));
                }
            };
            reader.readAsText(file);
        });
    },
    'choose-data-file': async () => {
        const success = await pickExistingDataFile();
        if (!success && state.dataPersistenceStatus === 'permission-denied') {
            alert(t('data_file_permission_denied_alert'));
        } else if (!success && state.dataPersistenceStatus === 'error' && state.dataPersistenceError) {
            alert(`${t('data_file_error_alert')}: ${state.dataPersistenceError}`);
        }
    },
    'create-data-file': async () => {
        const success = await createDataFileWithCurrentState();
        if (success) {
            alert(t('data_file_created_success'));
        } else if (state.dataPersistenceStatus === 'permission-denied') {
            alert(t('data_file_permission_denied_alert'));
        } else if (state.dataPersistenceStatus === 'error' && state.dataPersistenceError) {
            alert(`${t('data_file_error_alert')}: ${state.dataPersistenceError}`);
        }
    },
    'reload-data-file': async () => {
        const success = await reloadDataFromConfiguredFile();
        if (!success && state.dataPersistenceStatus === 'error' && state.dataPersistenceError) {
            alert(`${t('data_file_error_alert')}: ${state.dataPersistenceError}`);
        }
    },
    'clear-data-file-selection': async () => {
        await clearConfiguredDataFile();
        alert(t('data_file_cleared_alert'));
    },
    'delete-all-data': () => {
        showModal(t('delete_all_data_confirm_title'), t('delete_all_data_confirm_text'), () => {
            resetStateToDefaults();
            saveState().then(() => {
                alert(t('delete_all_data_success_alert'));
                window.location.reload();
            }).catch(() => {
                alert(t('data_file_error_alert'));
            });
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
        if (state.evaluationSelectedTermId === id) {
            state.evaluationSelectedTermId = 'all';
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
