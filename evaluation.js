// evaluation.js: Configuració i càlculs relacionats amb l'avaluació.
//
// Aquest mòdul encapsula la lògica per gestionar les configuracions
// d'avaluació per assignatura i els càlculs derivats. S'ha dissenyat per
// ser estable i extensible, de manera que en el futur es puguin afegir
// noves modalitats o més nivells sense afectar la resta de la
// infraestructura.

export const EVALUATION_MODALITIES = {
    COMPETENCY: 'competency',
    NUMERIC: 'numeric',
};

export const COMPETENCY_LEVEL_IDS = ['NP', 'NA', 'AS', 'AN', 'AE'];

export const COMPETENCY_AGGREGATIONS = {
    WEIGHTED_AVERAGE: 'weighted_average',
    MAJORITY: 'majority',
};

export const NP_TREATMENTS = {
    INCLUDE_AS_ZERO: 'include-zero',
    EXCLUDE_FROM_AVERAGE: 'exclude',
};

export const NO_EVIDENCE_BEHAVIOR = {
    LOWEST_LEVEL: 'lowest-level',
    SPECIFIC_LEVEL: 'specific-level',
};

const NUMERIC_CATEGORY_ID_PREFIX = 'numeric-category';

function deepClone(value) {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(item => deepClone(item));
    }
    const cloned = {};
    Object.entries(value).forEach(([key, val]) => {
        cloned[key] = deepClone(val);
    });
    return cloned;
}

function generateNumericCategoryId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const random = Math.random().toString(16).slice(2, 10);
    return `${NUMERIC_CATEGORY_ID_PREFIX}-${Date.now()}-${random}`;
}

function createDefaultNumericCategory() {
    return {
        id: generateNumericCategoryId(),
        name: '',
        weight: 1,
    };
}

export function createDefaultEvaluationConfig() {
    return {
        modality: EVALUATION_MODALITIES.COMPETENCY,
        competency: {
            levels: COMPETENCY_LEVEL_IDS.map((id, index) => ({
                id,
                label: id,
                numericValue: index,
            })),
            minimums: {
                AS: 2,
                AN: 3,
                AE: 4,
            },
            maxNotAchieved: {
                term: 0,
                course: 0,
            },
            aggregation: COMPETENCY_AGGREGATIONS.WEIGHTED_AVERAGE,
            calculation: {
                noEvidenceBehavior: NO_EVIDENCE_BEHAVIOR.LOWEST_LEVEL,
                noEvidenceLevelId: 'NP',
                npTreatment: NP_TREATMENTS.INCLUDE_AS_ZERO,
            },
        },
        numeric: {
            categories: [createDefaultNumericCategory()],
            weightBasis: 100,
        },
    };
}

function normalizeNumber(value, defaultValue, { allowEmpty = false, min = -Infinity } = {}) {
    if (allowEmpty && (value === '' || value === null || typeof value === 'undefined')) {
        return '';
    }
    if (value === '' || value === null || typeof value === 'undefined') {
        return defaultValue;
    }
    const number = Number(value);
    if (Number.isNaN(number)) {
        return defaultValue;
    }
    if (number < min) {
        return min;
    }
    return number;
}

export function normalizeEvaluationConfig(rawConfig) {
    const base = createDefaultEvaluationConfig();
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    const modality = Object.values(EVALUATION_MODALITIES).includes(config.modality)
        ? config.modality
        : base.modality;

    const competency = config.competency && typeof config.competency === 'object'
        ? config.competency
        : {};

    const existingLevels = Array.isArray(competency.levels) ? competency.levels : [];
    const normalizedLevels = COMPETENCY_LEVEL_IDS.map((id, index) => {
        const match = existingLevels.find(level => level?.id === id);
        const numericValue = normalizeNumber(match?.numericValue, index, { allowEmpty: false, min: 0 });
        return {
            id,
            label: typeof match?.label === 'string' && match.label.trim() ? match.label.trim() : id,
            numericValue,
        };
    });

    const baseMinimums = base.competency.minimums;
    const normalizedMinimums = {
        AS: normalizeNumber(competency?.minimums?.AS, baseMinimums.AS, { allowEmpty: false, min: 0 }),
        AN: normalizeNumber(competency?.minimums?.AN, baseMinimums.AN, { allowEmpty: false, min: 0 }),
        AE: normalizeNumber(competency?.minimums?.AE, baseMinimums.AE, { allowEmpty: false, min: 0 }),
    };

    const baseMax = base.competency.maxNotAchieved;
    const normalizedMax = {
        term: normalizeNumber(competency?.maxNotAchieved?.term, baseMax.term, { allowEmpty: false, min: 0 }),
        course: normalizeNumber(competency?.maxNotAchieved?.course, baseMax.course, { allowEmpty: false, min: 0 }),
    };

    const aggregation = Object.values(COMPETENCY_AGGREGATIONS).includes(competency.aggregation)
        ? competency.aggregation
        : base.competency.aggregation;

    const calculation = competency?.calculation && typeof competency.calculation === 'object'
        ? competency.calculation
        : {};

    const noEvidenceBehavior = Object.values(NO_EVIDENCE_BEHAVIOR).includes(calculation.noEvidenceBehavior)
        ? calculation.noEvidenceBehavior
        : base.competency.calculation.noEvidenceBehavior;

    const noEvidenceLevelId = COMPETENCY_LEVEL_IDS.includes(calculation.noEvidenceLevelId)
        ? calculation.noEvidenceLevelId
        : base.competency.calculation.noEvidenceLevelId;

    const npTreatment = Object.values(NP_TREATMENTS).includes(calculation.npTreatment)
        ? calculation.npTreatment
        : base.competency.calculation.npTreatment;

    const rawNumeric = config.numeric && typeof config.numeric === 'object'
        ? config.numeric
        : {};
    const rawCategories = Array.isArray(rawNumeric.categories) ? rawNumeric.categories : [];

    const normalizedCategories = rawCategories
        .map((rawCategory, index) => {
            if (!rawCategory || typeof rawCategory !== 'object') {
                return null;
            }
            const id = typeof rawCategory.id === 'string' && rawCategory.id.trim()
                ? rawCategory.id.trim()
                : generateNumericCategoryId();
            const name = typeof rawCategory.name === 'string' ? rawCategory.name.trim() : '';
            const rawWeight = rawCategory.weight;
            const normalizedWeight = Number(rawWeight);
            const weight = Number.isFinite(normalizedWeight) && normalizedWeight >= 0
                ? normalizedWeight
                : 0;
            return {
                id,
                name,
                weight,
            };
        })
        .filter(Boolean);

    if (normalizedCategories.length === 0) {
        normalizedCategories.push(createDefaultNumericCategory());
    }

    const weightBasis = normalizeNumber(rawNumeric.weightBasis, base.numeric.weightBasis, {
        allowEmpty: false,
        min: 0,
    });

    return {
        modality,
        competency: {
            levels: normalizedLevels,
            minimums: normalizedMinimums,
            maxNotAchieved: normalizedMax,
            aggregation,
            calculation: {
                noEvidenceBehavior,
                noEvidenceLevelId,
                npTreatment,
            },
        },
        numeric: {
            categories: normalizedCategories,
            weightBasis,
        },
    };
}

export function cloneEvaluationConfig(config) {
    const normalized = normalizeEvaluationConfig(config);
    return deepClone(normalized);
}

export function qualitativeToNumeric(levelId, config) {
    if (!levelId || !config) {
        return 0;
    }
    const normalized = normalizeEvaluationConfig(config);
    const level = normalized.competency.levels.find(l => l.id === levelId);
    return level ? level.numericValue : 0;
}

function resolveLevelFromNumericScore(numericScore, config) {
    const normalized = normalizeEvaluationConfig(config);
    const { minimums } = normalized.competency;
    const aeLevel = normalized.competency.levels.find(level => level.id === 'AE');
    const cappedScore = Math.max(0, Math.min(numericScore, aeLevel?.numericValue ?? numericScore));

    const thresholds = {
        NP: -Infinity,
        NA: 0,
        AS: minimums.AS,
        AN: minimums.AN,
        AE: minimums.AE,
    };

    let resolvedLevel = 'NP';
    COMPETENCY_LEVEL_IDS.forEach(levelId => {
        const threshold = typeof thresholds[levelId] === 'number' ? thresholds[levelId] : 0;
        if (cappedScore >= threshold) {
            resolvedLevel = levelId;
        }
    });

    return resolvedLevel;
}

export function computeNumericEvidence(rawScore, maxScore, config, { normalizedConfig } = {}) {
    const normalized = normalizedConfig || normalizeEvaluationConfig(config);
    const numericValue = Number(rawScore);
    const numericMax = Number(maxScore);

    if (!Number.isFinite(numericValue) || !Number.isFinite(numericMax) || numericMax <= 0) {
        return {
            levelId: '',
            scoreOutOfFour: null,
            normalizedScore: null,
            clampedScore: null,
        };
    }

    const clampedScore = Math.max(0, Math.min(numericValue, numericMax));
    const scoreOutOfFour = (clampedScore / numericMax) * 4;
    const aeValue = normalized.competency.levels.find(level => level.id === 'AE')?.numericValue ?? 4;
    const normalizedScore = (aeValue / 4) * scoreOutOfFour;
    const levelId = resolveLevelFromNumericScore(scoreOutOfFour, normalized);

    return {
        levelId,
        scoreOutOfFour,
        normalizedScore,
        clampedScore,
    };
}

function getLevelMetadata(config) {
    const normalized = normalizeEvaluationConfig(config);
    const map = new Map();
    normalized.competency.levels.forEach(level => {
        map.set(level.id, level);
    });
    return { normalized, map };
}

export function calculateWeightedCompetencyResult(evidences = [], config) {
    const { normalized, map } = getLevelMetadata(config);
    const aeValue = map.get('AE')?.numericValue ?? 0;

    let numerator = 0;
    let denominatorWeight = 0;

    evidences.forEach(evidence => {
        if (!evidence || typeof evidence !== 'object') {
            return;
        }
        const levelId = evidence.levelId;
        if (!map.has(levelId)) {
            return;
        }
        if (normalized.competency.calculation.npTreatment === NP_TREATMENTS.EXCLUDE_FROM_AVERAGE && levelId === 'NP') {
            return;
        }
        const levelValue = map.get(levelId)?.numericValue ?? 0;
        const activityWeight = Number.isFinite(Number(evidence.activityWeight))
            ? Number(evidence.activityWeight)
            : 1;
        const criterionWeight = Number.isFinite(Number(evidence.criterionWeight))
            ? Number(evidence.criterionWeight)
            : 1;
        const weightProduct = Math.max(0, activityWeight) * Math.max(0, criterionWeight);
        const evidenceNumericScore = Number(evidence.numericScore);
        const numericValue = Number.isFinite(evidenceNumericScore)
            ? Math.max(0, evidenceNumericScore)
            : levelValue;
        numerator += weightProduct * numericValue;
        denominatorWeight += weightProduct;
    });

    const denominator = denominatorWeight * (aeValue || 1);
    if (denominator <= 0) {
        const fallbackLevel = normalized.competency.calculation.noEvidenceBehavior === NO_EVIDENCE_BEHAVIOR.SPECIFIC_LEVEL
            ? normalized.competency.calculation.noEvidenceLevelId
            : 'NP';
        const levelId = map.has(fallbackLevel) ? fallbackLevel : 'NP';
        const numericScore = qualitativeToNumeric(levelId, normalized);
        return {
            numericScore,
            normalizedScore: aeValue > 0 ? numericScore / aeValue : 0,
            levelId,
        };
    }

    const normalizedScore = numerator / denominator;
    const numericScore = normalizedScore * aeValue;
    const levelId = resolveLevelFromNumericScore(numericScore, normalized);

    return {
        numericScore,
        normalizedScore,
        levelId,
    };
}

export function calculateMajorityCompetencyResult(evidences = [], config) {
    const { normalized, map } = getLevelMetadata(config);
    const counts = new Map();
    const considered = [];

    evidences.forEach(evidence => {
        if (!evidence || typeof evidence !== 'object') {
            return;
        }
        const levelId = evidence.levelId;
        if (!map.has(levelId)) {
            return;
        }
        if (normalized.competency.calculation.npTreatment === NP_TREATMENTS.EXCLUDE_FROM_AVERAGE && levelId === 'NP') {
            return;
        }
        const activityWeight = Number.isFinite(Number(evidence.activityWeight))
            ? Number(evidence.activityWeight)
            : 1;
        const criterionWeight = Number.isFinite(Number(evidence.criterionWeight))
            ? Number(evidence.criterionWeight)
            : 1;
        considered.push({ levelId, activityWeight, criterionWeight });
        counts.set(levelId, (counts.get(levelId) || 0) + 1);
    });

    if (counts.size === 0) {
        const fallbackLevel = normalized.competency.calculation.noEvidenceBehavior === NO_EVIDENCE_BEHAVIOR.SPECIFIC_LEVEL
            ? normalized.competency.calculation.noEvidenceLevelId
            : 'NP';
        const levelId = map.has(fallbackLevel) ? fallbackLevel : 'NP';
        const numericScore = qualitativeToNumeric(levelId, normalized);
        const aeValue = map.get('AE')?.numericValue ?? 0;
        return {
            numericScore,
            normalizedScore: aeValue > 0 ? numericScore / aeValue : 0,
            levelId,
            winners: [],
            tieBreak: null,
        };
    }

    let winners = [];
    let winningCount = 0;
    counts.forEach((count, levelId) => {
        if (count > winningCount) {
            winners = [levelId];
            winningCount = count;
            return;
        }
        if (count === winningCount) {
            winners.push(levelId);
        }
    });

    const aeValue = map.get('AE')?.numericValue ?? 0;

    if (winners.length === 1) {
        const levelId = winners[0];
        const numericScore = qualitativeToNumeric(levelId, normalized);
        return {
            numericScore,
            normalizedScore: aeValue > 0 ? numericScore / aeValue : 0,
            levelId,
            winners,
            tieBreak: null,
        };
    }

    const weighted = calculateWeightedCompetencyResult(considered, normalized);
    const resolved = winners.includes(weighted.levelId);

    return {
        numericScore: weighted.numericScore,
        normalizedScore: weighted.normalizedScore,
        levelId: weighted.levelId,
        winners,
        tieBreak: {
            method: 'weighted-average',
            resolved,
        },
    };
}

export function validateCompetencyEvaluationConfig(config) {
    const normalized = normalizeEvaluationConfig(config);
    const rawCompetency = config && typeof config === 'object' ? config.competency || {} : {};
    const rawLevels = Array.isArray(rawCompetency.levels) ? rawCompetency.levels : [];
    const rawMinimums = rawCompetency.minimums && typeof rawCompetency.minimums === 'object'
        ? rawCompetency.minimums
        : {};
    const rawMax = rawCompetency.maxNotAchieved && typeof rawCompetency.maxNotAchieved === 'object'
        ? rawCompetency.maxNotAchieved
        : {};
    const rawCalculation = rawCompetency.calculation && typeof rawCompetency.calculation === 'object'
        ? rawCompetency.calculation
        : {};

    const errors = {
        general: [],
        levels: {},
        minimums: {},
        maxNotAchieved: {},
        calculation: {},
    };

    const levelValues = normalized.competency.levels.map(level => level.numericValue);

    normalized.competency.levels.forEach(level => {
        const rawLevel = rawLevels.find(item => item?.id === level.id) || {};
        const rawValue = rawLevel.numericValue;
        if (rawValue === '' || rawValue === null || typeof rawValue === 'undefined') {
            errors.levels[level.id] = 'missing';
            return;
        }
        const numeric = Number(rawValue);
        if (Number.isNaN(numeric)) {
            errors.levels[level.id] = 'missing';
            return;
        }
        if (numeric < 0 || level.numericValue < 0) {
            errors.levels[level.id] = 'negative';
        }
    });

    for (let i = 1; i < COMPETENCY_LEVEL_IDS.length; i += 1) {
        const currentId = COMPETENCY_LEVEL_IDS[i];
        const previousId = COMPETENCY_LEVEL_IDS[i - 1];
        const currentLevel = normalized.competency.levels.find(level => level.id === currentId);
        const previousLevel = normalized.competency.levels.find(level => level.id === previousId);
        if (currentLevel && previousLevel
            && !errors.levels[currentId]
            && !errors.levels[previousId]
            && currentLevel.numericValue < previousLevel.numericValue) {
            errors.levels[currentId] = 'out_of_order';
        }
    }

    const minimums = normalized.competency.minimums;
    ['AS', 'AN', 'AE'].forEach(key => {
        const rawValue = rawMinimums[key];
        if (rawValue === '' || rawValue === null || typeof rawValue === 'undefined') {
            errors.minimums[key] = 'missing';
            return;
        }
        const numeric = Number(rawValue);
        if (Number.isNaN(numeric)) {
            errors.minimums[key] = 'missing';
            return;
        }
        if (numeric < 0 || minimums[key] < 0) {
            errors.minimums[key] = 'negative';
        }
    });

    if (!errors.minimums.AS && !errors.minimums.AN && minimums.AN < minimums.AS) {
        errors.minimums.AN = 'order';
    }
    if (!errors.minimums.AN && !errors.minimums.AE && minimums.AE < minimums.AN) {
        errors.minimums.AE = 'order';
    }

    const hasZeroLevel = Math.min(...levelValues) === 0;
    if (hasZeroLevel && !errors.minimums.AS && minimums.AS < 1) {
        errors.minimums.AS = 'min_scale';
    }
    if (hasZeroLevel && !errors.minimums.AN && minimums.AN < minimums.AS) {
        errors.minimums.AN = 'min_scale';
    }
    if (hasZeroLevel && !errors.minimums.AE && minimums.AE < minimums.AN) {
        errors.minimums.AE = 'min_scale';
    }

    const maxNotAchieved = normalized.competency.maxNotAchieved;
    ['term', 'course'].forEach(scope => {
        const rawValue = rawMax[scope];
        if (rawValue === '' || rawValue === null || typeof rawValue === 'undefined') {
            errors.maxNotAchieved[scope] = 'missing';
            return;
        }
        const numeric = Number(rawValue);
        if (Number.isNaN(numeric)) {
            errors.maxNotAchieved[scope] = 'missing';
            return;
        }
        if (numeric < 0 || maxNotAchieved[scope] < 0) {
            errors.maxNotAchieved[scope] = 'negative';
        }
    });

    if (normalized.competency.calculation.noEvidenceBehavior === NO_EVIDENCE_BEHAVIOR.SPECIFIC_LEVEL) {
        if (!rawCalculation
            || typeof rawCalculation.noEvidenceLevelId === 'undefined'
            || rawCalculation.noEvidenceLevelId === '') {
            errors.calculation.noEvidenceLevelId = 'missing';
        } else if (!COMPETENCY_LEVEL_IDS.includes(normalized.competency.calculation.noEvidenceLevelId)) {
            errors.calculation.noEvidenceLevelId = 'invalid';
        }
    }

    const isValid = !errors.general.length
        && Object.values(errors.levels).every(value => !value)
        && Object.values(errors.minimums).every(value => !value)
        && Object.values(errors.maxNotAchieved).every(value => !value)
        && Object.values(errors.calculation).every(value => !value);

    return { isValid, errors };
}

export function validateNumericEvaluationConfig(config) {
    const normalized = normalizeEvaluationConfig(config);
    const rawNumeric = config && typeof config === 'object' ? config.numeric || {} : {};
    const rawCategories = Array.isArray(rawNumeric.categories) ? rawNumeric.categories : [];

    const errors = { categories: {}, weightBasis: null, general: [] };

    const categories = Array.isArray(normalized.numeric?.categories)
        ? normalized.numeric.categories
        : [];

    const weightBasisRaw = rawNumeric.weightBasis;
    const weightBasis = Number(weightBasisRaw);
    if (weightBasisRaw === '' || typeof weightBasisRaw === 'undefined' || weightBasisRaw === null) {
        errors.weightBasis = 'missing';
    } else if (Number.isNaN(weightBasis)) {
        errors.weightBasis = 'invalid';
    } else if (weightBasis < 0) {
        errors.weightBasis = 'negative';
    }

    categories.forEach(category => {
        const rawCategory = rawCategories.find(item => item?.id === category.id) || {};
        const rawName = typeof rawCategory.name === 'string' ? rawCategory.name : category.name;
        const trimmedName = typeof rawName === 'string' ? rawName.trim() : '';
        const rawWeight = typeof rawCategory.weight !== 'undefined' ? rawCategory.weight : category.weight;

        const categoryErrors = {};
        if (!trimmedName) {
            categoryErrors.name = 'missing';
        }

        if (rawWeight === '' || rawWeight === null || typeof rawWeight === 'undefined') {
            categoryErrors.weight = 'missing';
        } else {
            const numericWeight = Number(rawWeight);
            if (Number.isNaN(numericWeight)) {
                categoryErrors.weight = 'invalid';
            } else if (numericWeight < 0) {
                categoryErrors.weight = 'negative';
            }
        }

        if (Object.keys(categoryErrors).length > 0) {
            errors.categories[category.id] = categoryErrors;
        }
    });

    const hasCategoryErrors = Object.values(errors.categories).some(categoryErrors => Object.keys(categoryErrors).length > 0);
    if (!hasCategoryErrors && !errors.weightBasis) {
        const targetWeight = Number.isFinite(weightBasis) ? weightBasis : 0;
        const totalWeight = categories.reduce((sum, category) => {
            const weight = Number(category.weight);
            return sum + (Number.isFinite(weight) ? weight : 0);
        }, 0);
        if (targetWeight > 0 && Math.abs(totalWeight - targetWeight) > 1e-2) {
            errors.general.push('total_mismatch');
        }
    }

    const isValid = categories.length > 0
        && !errors.weightBasis
        && errors.general.length === 0
        && Object.values(errors.categories).every(categoryErrors => Object.keys(categoryErrors).length === 0);

    return { isValid, errors };
}

export function formatValidationErrorMessage(code, { levelId, field } = {}) {
    switch (code) {
        case 'missing':
            return `(${levelId}) valor requerit`;
        case 'negative':
            return `(${field || levelId}) no pot ser negatiu`;
        case 'order':
            return `(${field || levelId}) ha de ser ≥ anterior`;
        case 'min_scale':
            return `(${field || levelId}) ha de ser ≥ 1 quan l'escala té un nivell 0`;
        case 'out_of_order':
            return `(${levelId}) ha de tenir un valor ≥ el nivell anterior`;
        case 'invalid':
            return `Valor no vàlid`;
        default:
            return 'Error de validació';
    }
}
