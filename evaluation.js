import { EVALUATION_METHODS, RUBRIC_LEVELS, DEFAULT_COMPETENCIAL_LEVEL_VALUES, DEFAULT_COMPETENCIAL_MINIMUMS } from './state.js';

const LEVEL_ORDER = [...RUBRIC_LEVELS];
const NOT_ACHIEVED_LEVELS = new Set(['NP', 'NA']);

function createLevelCounts() {
    const counts = {};
    LEVEL_ORDER.forEach(level => {
        counts[level] = 0;
    });
    return counts;
}

function cloneLevelCounts(source) {
    const counts = createLevelCounts();
    LEVEL_ORDER.forEach(level => {
        if (typeof source?.[level] === 'number') {
            counts[level] = source[level];
        }
    });
    return counts;
}

function addCounts(target, addition) {
    if (!addition) return;
    LEVEL_ORDER.forEach(level => {
        const value = addition[level];
        if (typeof value === 'number' && !Number.isNaN(value)) {
            target[level] = (target[level] || 0) + value;
        }
    });
}

function getTotalCount(counts) {
    return LEVEL_ORDER.reduce((acc, level) => acc + (counts?.[level] || 0), 0);
}

function normalizeNumber(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDateValue(dateString, endOfDay = false) {
    if (!dateString) return null;
    const normalized = dateString.includes('T') ? dateString : `${dateString}T${endOfDay ? '23:59:59' : '00:00:00'}`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function activityMatchesTerm(activity, termRange) {
    if (!termRange) return true;
    const start = parseDateValue(activity.startDate);
    const end = parseDateValue(activity.endDate, true) || start;
    if (!start && !end) return true;
    const rangeStart = termRange.start;
    const rangeEnd = termRange.end;
    const effectiveStart = start || end;
    const effectiveEnd = end || start;
    if (!effectiveStart || !effectiveEnd) return true;
    return effectiveEnd >= rangeStart && effectiveStart <= rangeEnd;
}

function mapNumericToLevel(numeric, thresholds, levelValues) {
    if (typeof numeric !== 'number' || Number.isNaN(numeric)) {
        return null;
    }
    const referenceValues = { ...DEFAULT_COMPETENCIAL_MINIMUMS, ...thresholds };
    const levels = ['AE', 'AN', 'AS'];
    for (const level of levels) {
        const minimum = referenceValues[level];
        if (typeof minimum === 'number' && numeric >= minimum) {
            if (level === 'AE') return 'AE';
            if (level === 'AN') return 'AN';
            if (level === 'AS') return 'AS';
        }
    }
    return numeric > (levelValues.NA ?? 0) ? 'NA' : 'NA';
}

function computeNumericFromCounts(counts, levelValues = DEFAULT_COMPETENCIAL_LEVEL_VALUES) {
    const total = getTotalCount(counts);
    if (total === 0) return null;
    let totalScore = 0;
    LEVEL_ORDER.forEach(level => {
        const value = levelValues[level];
        if (typeof value === 'number') {
            totalScore += (counts[level] || 0) * value;
        }
    });
    return totalScore / total;
}

function determineMajorityLevel(counts) {
    let maxCount = 0;
    const topLevels = [];
    LEVEL_ORDER.forEach(level => {
        const count = counts[level] || 0;
        if (count > maxCount) {
            maxCount = count;
            topLevels.length = 0;
            topLevels.push(level);
        } else if (count === maxCount && count > 0) {
            topLevels.push(level);
        }
    });
    return { maxCount, topLevels };
}

function finalizeEntry(entry, method, thresholds, levelValues, footnoteMarkers) {
    const counts = cloneLevelCounts(entry.counts);
    const totalCount = getTotalCount(counts);
    const totalWeight = entry.totalWeight;
    let numeric = null;
    if (totalWeight > 0) {
        numeric = entry.totalScore / totalWeight;
    } else if (totalCount > 0) {
        numeric = computeNumericFromCounts(counts, levelValues);
    }

    let level = null;
    const footnotes = new Set();

    if (totalCount === counts.NP && totalCount > 0) {
        level = 'NP';
    } else if (method === EVALUATION_METHODS.MAJORITY && totalCount > 0) {
        const { topLevels } = determineMajorityLevel(counts);
        if (topLevels.length === 1) {
            level = topLevels[0];
        } else if (topLevels.length > 1) {
            const numericLevel = mapNumericToLevel(numeric, thresholds, levelValues);
            if (numericLevel && topLevels.includes(numericLevel)) {
                level = numericLevel;
            } else {
                level = topLevels.sort((a, b) => (levelValues[b] || 0) - (levelValues[a] || 0))[0] || null;
                if (level) {
                    footnotes.add('weighted');
                }
            }
        }
    } else if (typeof numeric === 'number') {
        level = mapNumericToLevel(numeric, thresholds, levelValues);
    }

    if (!level && typeof numeric === 'number') {
        level = mapNumericToLevel(numeric, thresholds, levelValues);
    }

    if (!level && totalCount === 0) {
        level = null;
    }

    if (footnotes.size > 0 && footnoteMarkers) {
        footnotes.forEach(marker => footnoteMarkers.add(marker));
    }

    return {
        numeric,
        level,
        counts,
        totalWeight,
        evaluationCount: entry.evaluationCount,
        notes: footnotes
    };
}

export function computeClassTermEvaluation({
    classData,
    students,
    learningActivities,
    termRange,
    settings,
    scope = 'term',
    competencyWeights = null
}) {
    if (!classData) {
        return {
            criteria: [],
            competencies: [],
            final: {},
            footnotes: []
        };
    }

    const levelValues = settings?.competencial?.levelValues || DEFAULT_COMPETENCIAL_LEVEL_VALUES;
    const thresholds = settings?.competencial?.minimumThresholds || DEFAULT_COMPETENCIAL_MINIMUMS;
    const method = settings?.competencial?.termEvaluationMethod || EVALUATION_METHODS.WEIGHTED;
    const footnoteMarkers = new Set();
    const scopeKey = scope === 'course' ? 'course' : 'term';
    const normalizedWeights = {};
    if (competencyWeights && typeof competencyWeights === 'object') {
        Object.entries(competencyWeights).forEach(([competencyId, weight]) => {
            const parsed = parseFloat(weight);
            if (typeof competencyId === 'string' && competencyId && Number.isFinite(parsed) && parsed >= 0) {
                normalizedWeights[competencyId] = parsed;
            }
        });
    }

    const competencies = Array.isArray(classData.competencies) ? classData.competencies : [];
    const criteriaMeta = [];
    const criterionIndex = new Map();

    competencies.forEach(competency => {
        const items = Array.isArray(competency.criteria) ? competency.criteria : [];
        items.forEach(criterion => {
            if (!criterion?.id) return;
            const meta = {
                id: criterion.id,
                competencyId: competency.id,
                competencyCode: competency.code || '',
                competencyName: competency.name || competency.description || '',
                code: criterion.code || '',
                name: criterion.name || criterion.description || '',
            };
            criteriaMeta.push(meta);
            criterionIndex.set(criterion.id, meta);
        });
    });

    const criterionResults = new Map();
    const studentIds = students.map(student => student.id);

    criteriaMeta.forEach(meta => {
        const studentMap = new Map();
        studentIds.forEach(id => {
            studentMap.set(id, {
                totalScore: 0,
                totalWeight: 0,
                counts: createLevelCounts(),
                evaluationCount: 0
            });
        });
        criterionResults.set(meta.id, studentMap);
    });

    const relevantActivities = learningActivities
        .filter(activity => activity.classId === classData.id)
        .filter(activity => activityMatchesTerm(activity, termRange));

    relevantActivities.forEach(activity => {
        const activityWeight = normalizeNumber(activity.weight, 1);
        const rubricItems = Array.isArray(activity?.rubric?.items) ? activity.rubric.items : [];
        const evaluations = activity?.rubric?.evaluations && typeof activity.rubric.evaluations === 'object'
            ? activity.rubric.evaluations
            : {};

        rubricItems.forEach(item => {
            const criterionId = item?.criterionId;
            if (!criterionIndex.has(criterionId)) return;
            const studentMap = criterionResults.get(criterionId);
            const criterionWeight = normalizeNumber(item?.weight, 1);
            const combinedWeight = activityWeight * criterionWeight;
            if (!studentMap || combinedWeight <= 0) return;

            studentIds.forEach(studentId => {
                const entry = studentMap.get(studentId);
                if (!entry) return;
                const evaluation = evaluations[studentId];
                const level = evaluation?.scores?.[item.id];
                if (!level || !LEVEL_ORDER.includes(level)) {
                    return;
                }
                const value = levelValues[level];
                if (typeof value === 'number') {
                    entry.totalScore += combinedWeight * value;
                    entry.totalWeight += combinedWeight;
                }
                entry.counts[level] = (entry.counts[level] || 0) + 1;
                entry.evaluationCount += 1;
            });
        });
    });

    const criteriaResultsArray = criteriaMeta.map(meta => {
        const studentMap = criterionResults.get(meta.id);
        const results = {};
        if (studentMap) {
            studentMap.forEach((entry, studentId) => {
                results[studentId] = finalizeEntry(entry, method, thresholds, levelValues, footnoteMarkers);
            });
        }
        return {
            ...meta,
            results
        };
    });

    const competencyResultsArray = competencies.map(competency => {
        const competencyCriteria = Array.isArray(competency.criteria) ? competency.criteria : [];
        const results = {};
        studentIds.forEach(studentId => {
            const aggregate = {
                totalScore: 0,
                totalWeight: 0,
                counts: createLevelCounts(),
                evaluationCount: 0
            };
            competencyCriteria.forEach(criterion => {
                const criterionResult = criteriaResultsArray.find(item => item.id === criterion.id)?.results?.[studentId];
                if (!criterionResult) return;
                if (typeof criterionResult.numeric === 'number') {
                    const weight = criterionResult.totalWeight > 0 ? criterionResult.totalWeight : Math.max(criterionResult.evaluationCount, 1);
                    aggregate.totalScore += criterionResult.numeric * weight;
                    aggregate.totalWeight += weight;
                }
                addCounts(aggregate.counts, criterionResult.counts);
                aggregate.evaluationCount += criterionResult.evaluationCount;
            });
            results[studentId] = finalizeEntry(aggregate, method, thresholds, levelValues, footnoteMarkers);
        });
        return {
            id: competency.id,
            code: competency.code || '',
            name: competency.name || competency.description || '',
            results
        };
    });

    const finalResults = {};
    const footnoteUsage = {
        weighted: false,
        caTie: false
    };

    const maxCompetenciesLimit = settings?.competencial?.maxNotAchieved?.competencies?.[scopeKey];
    const maxCriteriaLimit = settings?.competencial?.maxNotAchieved?.criteria?.[scopeKey];

    studentIds.forEach(studentId => {
        const aggregate = {
            totalScore: 0,
            totalWeight: 0,
            counts: createLevelCounts(),
            evaluationCount: 0
        };
        let ceNotAchieved = 0;
        let caNotAchieved = 0;

        competencyResultsArray.forEach(competency => {
            const result = competency.results?.[studentId];
            if (!result) return;
            const hasOverride = Object.prototype.hasOwnProperty.call(normalizedWeights, competency.id);
            const overrideWeight = hasOverride ? normalizedWeights[competency.id] : null;
            if (typeof result.numeric === 'number') {
                let weight = result.totalWeight > 0 ? result.totalWeight : Math.max(result.evaluationCount, 1);
                if (hasOverride) {
                    weight = overrideWeight;
                }
                if (Number.isFinite(weight) && weight > 0) {
                    aggregate.totalScore += result.numeric * weight;
                    aggregate.totalWeight += weight;
                }
            }
            addCounts(aggregate.counts, result.counts);
            aggregate.evaluationCount += result.evaluationCount;
            if (result.level && NOT_ACHIEVED_LEVELS.has(result.level)) {
                ceNotAchieved += 1;
            }
        });

        criteriaResultsArray.forEach(criterion => {
            const result = criterion.results?.[studentId];
            if (result?.level && NOT_ACHIEVED_LEVELS.has(result.level)) {
                caNotAchieved += 1;
            }
        });

        const baseResult = finalizeEntry(aggregate, method, thresholds, levelValues, footnoteMarkers);
        let level = baseResult.level;
        let numeric = baseResult.numeric;
        const notes = new Set(baseResult.notes);
        let forced = null;

        if (typeof maxCompetenciesLimit === 'number' && maxCompetenciesLimit >= 0 && ceNotAchieved > maxCompetenciesLimit) {
            level = 'NA';
            numeric = levelValues.NA ?? 0;
            forced = 'competencies';
        } else if (typeof maxCriteriaLimit === 'number' && maxCriteriaLimit >= 0 && caNotAchieved > maxCriteriaLimit) {
            level = 'NA';
            numeric = levelValues.NA ?? 0;
            forced = 'criteria';
        } else if (method === EVALUATION_METHODS.MAJORITY) {
            const totalCount = getTotalCount(aggregate.counts);
            const { topLevels } = determineMajorityLevel(aggregate.counts);
            if (topLevels.length > 1) {
                // Try to resolve with criteria counts
                const criterionCounts = createLevelCounts();
                criteriaResultsArray.forEach(criterion => {
                    const result = criterion.results?.[studentId];
                    if (result) {
                        addCounts(criterionCounts, result.counts);
                    }
                });
                const filteredCriterionCounts = createLevelCounts();
                topLevels.forEach(levelKey => {
                    filteredCriterionCounts[levelKey] = criterionCounts[levelKey] || 0;
                });
                const { maxCount, topLevels: criterionTop } = determineMajorityLevel(filteredCriterionCounts);
                if (criterionTop.length === 1 && maxCount > 0) {
                    level = criterionTop[0];
                    footnoteUsage.caTie = true;
                    notes.add('ca');
                } else {
                    // Use numeric fallback
                    level = baseResult.level;
                    notes.add('weighted');
                }
            }
        }

        const noteArray = Array.from(notes);
        if (noteArray.includes('weighted')) {
            footnoteUsage.weighted = true;
        }

        finalResults[studentId] = {
            numeric,
            level,
            forced,
            ceNotAchieved,
            caNotAchieved,
            notes: noteArray
        };
    });

    if (footnoteUsage.weighted) {
        footnoteMarkers.add('weighted');
    }
    if (footnoteUsage.caTie) {
        footnoteMarkers.add('ca');
    }

    const footnotes = [];
    if (footnoteMarkers.has('weighted')) {
        footnotes.push({ marker: '*', type: 'weighted' });
    }
    if (footnoteMarkers.has('ca')) {
        footnotes.push({ marker: '**', type: 'ca' });
    }

    return {
        criteria: criteriaResultsArray,
        competencies: competencyResultsArray,
        final: finalResults,
        footnotes,
        method,
        levelValues,
        thresholds,
        termRange
    };
}

export function computeClassGlobalEvaluation({
    classData,
    students,
    learningActivities,
    settings,
    terms
}) {
    if (!classData) {
        return {
            criteria: [],
            competencies: [],
            final: {},
            footnotes: [],
            metadata: { globalMode: 'term-average', termSummaries: [] }
        };
    }

    const globalConfig = settings?.competencial?.globalEvaluation || {};
    const mode = globalConfig.mode === 'course-competencies' ? 'course-competencies' : 'term-average';
    const competencyWeights = globalConfig.competencyWeights || {};

    const courseData = computeClassTermEvaluation({
        classData,
        students,
        learningActivities,
        termRange: null,
        settings,
        scope: 'course',
        competencyWeights
    });

    if (mode === 'course-competencies') {
        return {
            ...courseData,
            metadata: {
                globalMode: 'course-competencies',
                competencyWeights: { ...competencyWeights }
            }
        };
    }

    const courseFinal = courseData.final || {};
    const studentIds = Array.isArray(classData.studentIds) ? classData.studentIds : [];

    const validTerms = Array.isArray(terms) ? terms : [];
    const termEntries = validTerms.map(term => {
        if (!term) return null;
        const start = parseDateValue(term.startDate);
        const end = parseDateValue(term.endDate, true);
        if (!start || !end) {
            return null;
        }
        const data = computeClassTermEvaluation({
            classData,
            students,
            learningActivities,
            termRange: { start, end },
            settings,
            scope: 'term'
        });
        return {
            id: term.id || '',
            name: term.name || '',
            data
        };
    }).filter(Boolean);

    const footnoteMap = new Map();
    const addFootnotes = (entries) => {
        if (!Array.isArray(entries)) return;
        entries.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const type = entry.type || entry.marker;
            if (!type || footnoteMap.has(type)) return;
            footnoteMap.set(type, entry);
        });
    };

    addFootnotes(courseData.footnotes);
    termEntries.forEach(entry => addFootnotes(entry.data?.footnotes));

    const combinedFootnotes = Array.from(footnoteMap.values());

    const levelValues = settings?.competencial?.levelValues || DEFAULT_COMPETENCIAL_LEVEL_VALUES;
    const thresholds = settings?.competencial?.minimumThresholds || DEFAULT_COMPETENCIAL_MINIMUMS;

    const finalResults = {};
    studentIds.forEach(studentId => {
        const breakdownTerms = {};
        let numericSum = 0;
        let numericCount = 0;

        termEntries.forEach((entry, index) => {
            const termFinal = entry.data?.final?.[studentId] || null;
            const record = {
                id: entry.id,
                name: entry.name,
                numeric: termFinal?.numeric ?? null,
                level: termFinal?.level || null
            };
            breakdownTerms[entry.id || `term-${index}`] = record;
            if (typeof termFinal?.numeric === 'number' && !Number.isNaN(termFinal.numeric)) {
                numericSum += termFinal.numeric;
                numericCount += 1;
            }
        });

        let numeric = numericCount > 0 ? numericSum / numericCount : null;
        let level = numeric !== null ? mapNumericToLevel(numeric, thresholds, levelValues) : null;

        const courseResult = courseFinal[studentId] || null;
        const notes = new Set(Array.isArray(courseResult?.notes) ? courseResult.notes : (courseResult?.notes instanceof Set ? Array.from(courseResult.notes) : []));
        let forced = null;

        if (numeric === null && typeof courseResult?.numeric === 'number' && !Number.isNaN(courseResult.numeric)) {
            numeric = courseResult.numeric;
            level = courseResult.level || level;
        }

        if (courseResult?.forced) {
            forced = courseResult.forced;
            numeric = levelValues.NA ?? 0;
            level = 'NA';
        }

        finalResults[studentId] = {
            numeric,
            level,
            breakdown: { terms: breakdownTerms },
            forced,
            ceNotAchieved: courseResult?.ceNotAchieved ?? 0,
            caNotAchieved: courseResult?.caNotAchieved ?? 0,
            notes: Array.from(notes)
        };
    });

    return {
        ...courseData,
        final: finalResults,
        footnotes: combinedFootnotes,
        metadata: {
            globalMode: 'term-average',
            termSummaries: termEntries.map(entry => ({ id: entry.id, name: entry.name }))
        }
    };
}
