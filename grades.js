import { state, RUBRIC_LEVELS } from './state.js';
import { getTermDateRangeById } from './utils.js';

const LEVEL_TO_NUMERIC = {
    NA: 0,
    AS: 5,
    AN: 7.5,
    AE: 10,
};

const LEVEL_ORDER = RUBRIC_LEVELS;

function getNumericForLevel(level) {
    if (!level || !(level in LEVEL_TO_NUMERIC)) return null;
    return LEVEL_TO_NUMERIC[level];
}

function getLevelFromNumeric(numeric) {
    if (numeric === null || numeric === undefined || Number.isNaN(numeric)) {
        return '';
    }
    if (numeric < 2.5) return 'NA';
    if (numeric < 6.25) return 'AS';
    if (numeric < 8.75) return 'AN';
    return 'AE';
}

function ensureVotesContainer(container, studentId, key) {
    if (!container[studentId]) {
        container[studentId] = {};
    }
    if (!container[studentId][key]) {
        container[studentId][key] = [];
    }
    return container[studentId][key];
}

function summarizeVotes(votes) {
    if (!Array.isArray(votes) || votes.length === 0) {
        return {
            numeric: null,
            totalWeight: 0,
            levelWeights: LEVEL_ORDER.reduce((acc, level) => ({ ...acc, [level]: 0 }), {}),
            tieLevels: [],
        };
    }

    const levelWeights = LEVEL_ORDER.reduce((acc, level) => ({ ...acc, [level]: 0 }), {});
    let numericSum = 0;
    let totalWeight = 0;

    votes.forEach(entry => {
        if (!entry || !entry.level) {
            return;
        }
        const numeric = typeof entry.numeric === 'number' ? entry.numeric : getNumericForLevel(entry.level);
        const weight = typeof entry.weight === 'number' && !Number.isNaN(entry.weight) ? entry.weight : 0;
        if (weight <= 0) return;
        if (!LEVEL_ORDER.includes(entry.level)) return;
        levelWeights[entry.level] += weight;
        numericSum += (numeric ?? 0) * weight;
        totalWeight += weight;
    });

    const numeric = totalWeight > 0 ? numericSum / totalWeight : null;
    const maxWeight = Math.max(0, ...Object.values(levelWeights));
    const tieLevels = maxWeight > 0
        ? LEVEL_ORDER.filter(level => levelWeights[level] === maxWeight)
        : [];

    return { numeric, totalWeight, levelWeights, tieLevels };
}

function buildAutomaticGradeFromSummary(summary) {
    if (!summary) {
        return createEmptyGrade();
    }
    const { numeric, totalWeight, tieLevels } = summary;
    if (totalWeight <= 0) {
        return {
            ...createEmptyGrade(),
            weight: 0,
        };
    }

    let level = '';
    const markers = {};
    if (tieLevels.length === 1) {
        level = tieLevels[0];
    } else if (tieLevels.length > 1) {
        const numericLevel = getLevelFromNumeric(numeric);
        if (numericLevel && tieLevels.includes(numericLevel)) {
            level = numericLevel;
        } else {
            // default to highest level in tie and mark unresolved so a footnote can be displayed
            level = tieLevels[tieLevels.length - 1];
            markers.unresolvedTie = true;
        }
    }

    return {
        numeric,
        level,
        weight: totalWeight,
        source: 'auto',
        markers,
    };
}

function createEmptyGrade() {
    return {
        numeric: null,
        level: '',
        weight: 0,
        source: 'auto',
        markers: {},
    };
}

function mergeGradeEntries(previousEntry, automaticEntry) {
    if (previousEntry && previousEntry.source === 'manual') {
        return {
            ...previousEntry,
            weight: automaticEntry.weight,
        };
    }
    return automaticEntry;
}

function collectVotesForClass(classId, termId) {
    const selectedClass = state.activities.find(cls => cls.id === classId);
    if (!selectedClass) {
        return { votesByCriterion: {}, votesByCompetency: {}, studentIds: [], competencies: [] };
    }

    const studentIds = Array.isArray(selectedClass.studentIds) ? [...selectedClass.studentIds] : [];
    const termRange = getTermDateRangeById(termId);

    const relevantActivities = state.learningActivities.filter(activity => {
        if (activity.classId !== classId) return false;
        if (!activity.rubric || !Array.isArray(activity.rubric.items)) return false;
        if (!Array.isArray(activity.criteriaRefs) || activity.criteriaRefs.length === 0) return false;
        if (!termRange) return true;
        const start = activity.startDate ? new Date(`${activity.startDate}T00:00:00`) : null;
        const end = activity.endDate ? new Date(`${activity.endDate}T23:59:59`) : null;
        if (start && start > termRange.end) return false;
        if (end && end < termRange.start) return false;
        return true;
    });

    const votesByCriterion = {};
    const votesByCompetency = {};

    relevantActivities.forEach(activity => {
        const activityWeight = typeof activity.weight === 'number' && !Number.isNaN(activity.weight) ? activity.weight : 1;
        const rubric = activity.rubric || {};
        const items = Array.isArray(rubric.items) ? rubric.items : [];
        const evaluations = rubric.evaluations && typeof rubric.evaluations === 'object' ? rubric.evaluations : {};

        items.forEach(item => {
            if (!item || !item.criterionId) return;
            const criterionId = item.criterionId;
            const competencyId = item.competencyId || '';
            const itemWeight = typeof item.weight === 'number' && !Number.isNaN(item.weight) ? item.weight : 1;
            const combinedWeight = activityWeight * itemWeight;
            if (combinedWeight <= 0) return;

            studentIds.forEach(studentId => {
                const evaluation = evaluations[studentId];
                if (!evaluation || typeof evaluation !== 'object') {
                    return;
                }
                if (evaluation.flags?.notPresented) {
                    // No entrega: se considera nivell NA per a l'element
                    const votesForCriterion = ensureVotesContainer(votesByCriterion, studentId, criterionId);
                    votesForCriterion.push({ level: 'NA', numeric: LEVEL_TO_NUMERIC.NA, weight: combinedWeight });
                    if (competencyId) {
                        const votesForCompetency = ensureVotesContainer(votesByCompetency, studentId, competencyId);
                        votesForCompetency.push({ level: 'NA', numeric: LEVEL_TO_NUMERIC.NA, weight: combinedWeight });
                    }
                    return;
                }
                const scores = evaluation.scores && typeof evaluation.scores === 'object' ? evaluation.scores : {};
                const level = scores[item.id];
                if (!level || !LEVEL_ORDER.includes(level)) {
                    return;
                }
                const numeric = getNumericForLevel(level);
                const votesForCriterion = ensureVotesContainer(votesByCriterion, studentId, criterionId);
                votesForCriterion.push({ level, numeric, weight: combinedWeight });
                if (competencyId) {
                    const votesForCompetency = ensureVotesContainer(votesByCompetency, studentId, competencyId);
                    votesForCompetency.push({ level, numeric, weight: combinedWeight });
                }
            });
        });
    });

    const competencies = Array.isArray(selectedClass.competencies)
        ? selectedClass.competencies.map(comp => ({
            id: comp.id,
            code: comp.code || '',
            criteria: Array.isArray(comp.criteria) ? comp.criteria.map(criterion => ({
                id: criterion.id,
                code: criterion.code || '',
            })) : [],
        }))
        : [];

    return { votesByCriterion, votesByCompetency, studentIds, competencies };
}

function computeFinalGrade(studentData, classConfig) {
    const competencyEntries = Object.values(studentData.competencies || {});
    const criterionEntries = Object.values(studentData.criteria || {});

    const maxFailedCompetencies = Number.isFinite(classConfig?.maxFailedCompetencies)
        ? classConfig.maxFailedCompetencies
        : Infinity;
    const maxFailedCriteria = Number.isFinite(classConfig?.maxFailedCriteria)
        ? classConfig.maxFailedCriteria
        : Infinity;

    const failedCompetencies = competencyEntries.filter(entry => {
        const level = entry.level || getLevelFromNumeric(entry.numeric);
        return level === 'NA';
    }).length;
    const failedCriteria = criterionEntries.filter(entry => {
        const level = entry.level || getLevelFromNumeric(entry.numeric);
        return level === 'NA';
    }).length;

    if (failedCompetencies > maxFailedCompetencies || failedCriteria > maxFailedCriteria) {
        return {
            numeric: 0,
            level: 'NA',
            weight: competencyEntries.reduce((sum, entry) => sum + (entry.weight || 0), 0),
            source: 'auto',
            markers: { forcedNA: true },
        };
    }

    const ceVotes = competencyEntries
        .filter(entry => (entry.numeric !== null && entry.numeric !== undefined) || entry.level)
        .map(entry => ({
            numeric: typeof entry.numeric === 'number' ? entry.numeric : getNumericForLevel(entry.level),
            level: entry.level || getLevelFromNumeric(entry.numeric),
            weight: entry.weight && entry.weight > 0 ? entry.weight : 1,
        }));

    const ceSummary = summarizeVotes(ceVotes);
    if (ceSummary.totalWeight <= 0) {
        return {
            ...createEmptyGrade(),
            weight: 0,
        };
    }

    let finalLevel = '';
    const markers = {};

    if (ceSummary.tieLevels.length === 1) {
        finalLevel = ceSummary.tieLevels[0];
    } else if (ceSummary.tieLevels.length > 1) {
        const caVotes = criterionEntries
            .filter(entry => (entry.numeric !== null && entry.numeric !== undefined) || entry.level)
            .map(entry => ({
                numeric: typeof entry.numeric === 'number' ? entry.numeric : getNumericForLevel(entry.level),
                level: entry.level || getLevelFromNumeric(entry.numeric),
                weight: entry.weight && entry.weight > 0 ? entry.weight : 1,
            }));
        const caSummary = summarizeVotes(caVotes);
        if (caSummary.tieLevels.length > 0) {
            const caLevelCandidates = caSummary.tieLevels.filter(level => ceSummary.tieLevels.includes(level));
            if (caLevelCandidates.length === 1) {
                finalLevel = caLevelCandidates[0];
                markers.caTieBreak = true;
            } else if (caLevelCandidates.length > 1) {
                const numericPreferred = getLevelFromNumeric(caSummary.numeric);
                if (numericPreferred && caLevelCandidates.includes(numericPreferred)) {
                    finalLevel = numericPreferred;
                    markers.caTieBreak = true;
                } else {
                    finalLevel = caLevelCandidates[caLevelCandidates.length - 1];
                    markers.caTieBreak = true;
                    markers.unresolvedTie = true;
                }
            }
        }

        if (!finalLevel) {
            const numericPreferred = getLevelFromNumeric(ceSummary.numeric);
            if (numericPreferred && ceSummary.tieLevels.includes(numericPreferred)) {
                finalLevel = numericPreferred;
                markers.numericTieBreak = true;
            } else {
                finalLevel = ceSummary.tieLevels[ceSummary.tieLevels.length - 1];
                markers.unresolvedTie = true;
            }
        }
    }

    if (!finalLevel) {
        finalLevel = getLevelFromNumeric(ceSummary.numeric) || '';
    }

    return {
        numeric: ceSummary.numeric,
        level: finalLevel,
        weight: ceSummary.totalWeight,
        source: 'auto',
        markers,
    };
}

export function calculateAndMergeTermGrades(classId, termId) {
    const classConfig = state.activities.find(cls => cls.id === classId);
    if (!classConfig) {
        return { students: {}, lastCalculatedAt: new Date().toISOString() };
    }
    const existingData = state.termGrades?.[classId]?.[termId] || { students: {} };

    const { votesByCriterion, votesByCompetency, studentIds, competencies } = collectVotesForClass(classId, termId);

    const studentsMap = {};

    studentIds.forEach(studentId => {
        const previous = existingData.students?.[studentId] || {};
        const mergedCriteria = {};
        const mergedCompetencies = {};

        competencies.forEach(competency => {
            competency.criteria.forEach(criterion => {
                const votes = votesByCriterion?.[studentId]?.[criterion.id] || [];
                const automatic = buildAutomaticGradeFromSummary(summarizeVotes(votes));
                mergedCriteria[criterion.id] = mergeGradeEntries(previous.criteria?.[criterion.id], automatic);
            });

            const compVotes = votesByCompetency?.[studentId]?.[competency.id] || [];
            const automaticComp = buildAutomaticGradeFromSummary(summarizeVotes(compVotes));
            mergedCompetencies[competency.id] = mergeGradeEntries(previous.competencies?.[competency.id], automaticComp);
        });

        const automaticSummary = computeFinalGrade({
            criteria: mergedCriteria,
            competencies: mergedCompetencies,
        }, classConfig);
        const summary = mergeGradeEntries(previous.summary, automaticSummary);

        studentsMap[studentId] = {
            criteria: mergedCriteria,
            competencies: mergedCompetencies,
            summary,
        };
    });

    return {
        students: studentsMap,
        competencies,
        lastCalculatedAt: new Date().toISOString(),
    };
}

export function getGradeEntry(stateGrades, classId, termId, studentId, scope, identifier) {
    const classGrades = stateGrades?.[classId]?.[termId];
    if (!classGrades) return null;
    const studentGrades = classGrades.students?.[studentId];
    if (!studentGrades) return null;
    if (scope === 'criterion') {
        return studentGrades.criteria?.[identifier] || null;
    }
    if (scope === 'competency') {
        return studentGrades.competencies?.[identifier] || null;
    }
    if (scope === 'summary') {
        return studentGrades.summary || null;
    }
    return null;
}

export function setManualGrade(stateGrades, classId, termId, studentId, scope, identifier, updater) {
    if (!stateGrades[classId]) {
        stateGrades[classId] = {};
    }
    if (!stateGrades[classId][termId]) {
        stateGrades[classId][termId] = { students: {}, competencies: [], lastCalculatedAt: new Date().toISOString() };
    }
    const classGrades = stateGrades[classId][termId];
    if (!classGrades.students[studentId]) {
        classGrades.students[studentId] = { criteria: {}, competencies: {}, summary: createEmptyGrade() };
    }
    const studentGrades = classGrades.students[studentId];
    let target;
    if (scope === 'criterion') {
        if (!studentGrades.criteria[identifier]) {
            studentGrades.criteria[identifier] = createEmptyGrade();
        }
        target = studentGrades.criteria[identifier];
    } else if (scope === 'competency') {
        if (!studentGrades.competencies[identifier]) {
            studentGrades.competencies[identifier] = createEmptyGrade();
        }
        target = studentGrades.competencies[identifier];
    } else if (scope === 'summary') {
        if (!studentGrades.summary) {
            studentGrades.summary = createEmptyGrade();
        }
        target = studentGrades.summary;
    } else {
        return;
    }

    updater(target);
    target.source = 'manual';
    if (!target.markers || typeof target.markers !== 'object') {
        target.markers = {};
    }
}

export function formatNumericDisplay(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '';
    }
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function translateLevelLabel(level) {
    if (!level || !LEVEL_ORDER.includes(level)) {
        return '';
    }
    return `rubric_level_${level}_label`;
}
