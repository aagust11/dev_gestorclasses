import assert from 'node:assert';
import {
  createDefaultEvaluationConfig,
  qualitativeToNumeric,
  calculateWeightedCompetencyResult,
  calculateMajorityCompetencyResult,
  normalizeEvaluationConfig,
  NP_TREATMENTS,
  NO_EVIDENCE_BEHAVIOR,
  computeNumericEvidence,
  validateNumericEvaluationConfig,
  EVALUATION_MODALITIES,
} from '../evaluation.js';
import { calculateTermGradesForClassTerm } from '../actions.js';
import { state } from '../state.js';

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

// Test: qualitative to numeric transformation respects custom values
{
  const config = createDefaultEvaluationConfig();
  const custom = cloneConfig(config);
  custom.competency.levels.find(l => l.id === 'AE').numericValue = 10;
  custom.competency.levels.find(l => l.id === 'AS').numericValue = 5;
  const normalized = normalizeEvaluationConfig(custom);
  assert.strictEqual(qualitativeToNumeric('AE', normalized), 10);
  assert.strictEqual(qualitativeToNumeric('AS', normalized), 5);
}

// Test: weighted average with mixed levels and normalization against AE value
{
  const config = createDefaultEvaluationConfig();
  const evidences = [
    { levelId: 'AS', activityWeight: 0.25, criterionWeight: 1 },
    { levelId: 'AE', activityWeight: 0.75, criterionWeight: 1 },
  ];
  const result = calculateWeightedCompetencyResult(evidences, config);
  assert.strictEqual(result.levelId, 'AN');
  assert.ok(Math.abs(result.numericScore - 3.5) < 1e-9);
}

// Test: weighted average honours custom scale and minima
{
  const config = createDefaultEvaluationConfig();
  const custom = cloneConfig(config);
  const values = [0, 2, 4, 7, 10];
  custom.competency.levels.forEach((level, index) => {
    level.numericValue = values[index];
  });
  custom.competency.minimums = { AS: 4, AN: 7, AE: 9 };
  const evidences = [
    { levelId: 'AS', activityWeight: 1, criterionWeight: 1 },
    { levelId: 'AN', activityWeight: 1, criterionWeight: 1 },
  ];
  const result = calculateWeightedCompetencyResult(evidences, custom);
  assert.strictEqual(result.levelId, 'AS');
  assert.ok(Math.abs(result.numericScore - 5.5) < 1e-9);
}

// Test: weighted average with zero or missing weights falls back to configured level
{
  const config = createDefaultEvaluationConfig();
  const custom = cloneConfig(config);
  custom.competency.calculation.noEvidenceBehavior = NO_EVIDENCE_BEHAVIOR.SPECIFIC_LEVEL;
  custom.competency.calculation.noEvidenceLevelId = 'NA';
  const result = calculateWeightedCompetencyResult([
    { levelId: 'AE', activityWeight: 0, criterionWeight: 0 },
  ], custom);
  assert.strictEqual(result.levelId, 'NA');
}

// Test: weighted average with no evidences defaults to lowest level
{
  const config = createDefaultEvaluationConfig();
  const result = calculateWeightedCompetencyResult([], config);
  assert.strictEqual(result.levelId, 'NP');
}

// Test: majority calculation resolves ties using higher level
{
  const config = createDefaultEvaluationConfig();
  const evidences = [
    { levelId: 'AS' },
    { levelId: 'AN' },
  ];
  const result = calculateMajorityCompetencyResult(evidences, config);
  assert.strictEqual(result.levelId, 'AS');
  assert.ok(result.tieBreak);
  assert.strictEqual(result.tieBreak.method, 'weighted-average');
}

// Test: majority calculation skips NP when configured to exclude
{
  const config = createDefaultEvaluationConfig();
  const custom = cloneConfig(config);
  custom.competency.calculation.npTreatment = NP_TREATMENTS.EXCLUDE_FROM_AVERAGE;
  const result = calculateMajorityCompetencyResult([
    { levelId: 'NP' },
    { levelId: 'NP' },
  ], custom);
  assert.strictEqual(result.levelId, 'NP');
}

// Test: numeric evidence computation scales to four-point reference
{
  const config = createDefaultEvaluationConfig();
  const normalized = normalizeEvaluationConfig(config);
  const numeric = computeNumericEvidence(7.5, 10, null, { normalizedConfig: normalized });
  assert.strictEqual(numeric.levelId, 'AN');
  assert.ok(Math.abs(numeric.scoreOutOfFour - 3) < 1e-9);
  assert.ok(Math.abs(numeric.normalizedScore - 3) < 1e-9);
}

// Test: weighted average honours explicit numeric overrides
{
  const config = createDefaultEvaluationConfig();
  const evidences = [
    { levelId: 'AS', activityWeight: 1, criterionWeight: 1, numericScore: 3.2 },
    { levelId: 'AE', activityWeight: 1, criterionWeight: 1, numericScore: 3.6 },
  ];
  const result = calculateWeightedCompetencyResult(evidences, config);
  assert.strictEqual(result.levelId, 'AN');
  assert.ok(Math.abs(result.numericScore - 3.4) < 1e-9);
}

// Test: numeric evaluation config validation detects missing fields
{
  const config = createDefaultEvaluationConfig();
  config.modality = EVALUATION_MODALITIES.NUMERIC;
  config.numeric.categories = [
    { id: 'cat-1', name: '', weight: '' },
    { id: 'cat-2', name: 'Exams', weight: 2 },
  ];
  const validation = validateNumericEvaluationConfig(config);
  assert.strictEqual(validation.isValid, false);
  assert.ok(validation.errors.categories['cat-1']);
  assert.strictEqual(validation.errors.categories['cat-1'].name, 'missing');
  assert.strictEqual(validation.errors.categories['cat-1'].weight, 'missing');
}

// Test: numeric term grade calculation aggregates activities by category
{
  state.activities = [{
    id: 'class-1',
    type: 'class',
    studentIds: ['stu-1', 'stu-2'],
    competencies: [],
  }];
  state.students = [
    { id: 'stu-1', firstName: 'Anna', lastName: 'Example' },
    { id: 'stu-2', firstName: 'Bernat', lastName: 'Example' },
  ];
  const config = createDefaultEvaluationConfig();
  config.modality = EVALUATION_MODALITIES.NUMERIC;
  config.numeric.categories = [
    { id: 'cat-1', name: 'Exàmens', weight: 2 },
    { id: 'cat-2', name: 'Projectes', weight: 1 },
  ];
  state.evaluationSettings = { 'class-1': config };
  state.learningActivities = [
    {
      id: 'act-1',
      classId: 'class-1',
      numeric: { categoryId: 'cat-1', weight: 2 },
      rubric: {
        items: [
          { id: 'item-1', scoring: { mode: 'numeric', maxScore: 20 } },
        ],
        evaluations: {
          'stu-1': {
            scores: { 'item-1': { mode: 'numeric', value: 18 } },
            flags: { notPresented: false, exempt: false },
          },
          'stu-2': {
            scores: { 'item-1': { mode: 'numeric', value: 10 } },
            flags: { notPresented: false, exempt: false },
          },
        },
      },
    },
    {
      id: 'act-2',
      classId: 'class-1',
      numeric: { categoryId: 'cat-2', weight: 1 },
      rubric: {
        items: [
          { id: 'item-2', scoring: { mode: 'numeric', maxScore: 10 } },
        ],
        evaluations: {
          'stu-1': {
            scores: { 'item-2': { mode: 'numeric', value: 8 } },
            flags: { notPresented: false, exempt: false },
          },
          'stu-2': {
            scores: { 'item-2': { mode: 'numeric', value: 0 } },
            flags: { notPresented: true, exempt: false },
          },
        },
      },
    },
  ];
  state.terms = [];
  state.termGradeRecords = {};

  const termGrades = calculateTermGradesForClassTerm('class-1', 'all', 'dates');
  const stu1 = termGrades.students['stu-1'];
  const stu2 = termGrades.students['stu-2'];
  assert.ok(stu1);
  assert.ok(stu2);
  assert.strictEqual(stu1.competencies['cat-1'].numericScore, '9.00');
  assert.strictEqual(stu1.competencies['cat-2'].numericScore, '8.00');
  assert.strictEqual(stu1.final.numericScore, '8.67');
  assert.strictEqual(stu2.competencies['cat-1'].numericScore, '5.00');
  assert.strictEqual(stu2.competencies['cat-2'].numericScore, '0.00');
  assert.strictEqual(stu2.final.numericScore, '3.33');
}

// Test: competencies without evidence are ignored and locked
{
  state.activities = [{
    id: 'class-competency',
    type: 'class',
    name: 'Competency Class',
    studentIds: ['stu-1'],
    competencies: [
      { id: 'comp-1', code: 'C1', criteria: [{ id: 'crit-1', code: 'CR1' }] },
      { id: 'comp-2', code: 'C2', criteria: [{ id: 'crit-2', code: 'CR2' }] },
    ],
  }];
  state.learningActivities = [{
    id: 'act-competency',
    classId: 'class-competency',
    rubric: {
      items: [
        { id: 'item-1', competencyId: 'comp-1', criterionId: 'crit-1', scoring: { mode: 'competency' }, weight: 1 },
      ],
      evaluations: {
        'stu-1': {
          scores: { 'item-1': 'AE' },
          flags: { notPresented: false, exempt: false },
        },
      },
    },
  }];
  state.students = [{ id: 'stu-1', firstName: 'Anna', lastName: 'Example' }];
  state.evaluationSettings = { 'class-competency': createDefaultEvaluationConfig() };
  state.terms = [];
  state.termGradeRecords = {};

  const termGrades = calculateTermGradesForClassTerm('class-competency', 'all', 'dates');
  const student = termGrades.students['stu-1'];
  assert.ok(student);
  assert.strictEqual(student.competencies['comp-1'].numericScore, '4.00');
  assert.strictEqual(student.competencies['comp-1'].isLocked, false);
  assert.strictEqual(student.competencies['comp-2'].numericScore, '');
  assert.strictEqual(student.competencies['comp-2'].levelId, '');
  assert.strictEqual(student.competencies['comp-2'].isLocked, true);
  assert.strictEqual(student.final.numericScore, '4.00');
}

// Test: final grade honours NA limit but still weights competencies with evidence
{
  state.activities = [{
    id: 'class-weighted',
    type: 'class',
    name: 'Weighted Competencies',
    studentIds: ['stu-1'],
    competencies: [
      { id: 'comp-weight-1', code: 'C1', criteria: [{ id: 'crit-weight-1', code: 'CR1' }] },
      { id: 'comp-weight-2', code: 'C2', criteria: [{ id: 'crit-weight-2', code: 'CR2' }] },
      { id: 'comp-weight-3', code: 'C3', criteria: [{ id: 'crit-weight-3', code: 'CR3' }] },
    ],
  }];
  state.learningActivities = [
    {
      id: 'act-weight-1',
      classId: 'class-weighted',
      rubric: {
        items: [
          { id: 'item-weight-1', competencyId: 'comp-weight-1', criterionId: 'crit-weight-1', scoring: { mode: 'competency' }, weight: 2 },
        ],
        evaluations: {
          'stu-1': {
            scores: { 'item-weight-1': 'NA' },
            flags: { notPresented: false, exempt: false },
          },
        },
      },
    },
    {
      id: 'act-weight-2',
      classId: 'class-weighted',
      rubric: {
        items: [
          { id: 'item-weight-2', competencyId: 'comp-weight-2', criterionId: 'crit-weight-2', scoring: { mode: 'competency' }, weight: 1 },
        ],
        evaluations: {
          'stu-1': {
            scores: { 'item-weight-2': 'AE' },
            flags: { notPresented: false, exempt: false },
          },
        },
      },
    },
  ];
  state.students = [{ id: 'stu-1', firstName: 'Anna', lastName: 'Example' }];
  const config = createDefaultEvaluationConfig();
  config.competency.maxNotAchieved.term = 1;
  state.evaluationSettings = { 'class-weighted': config };
  state.terms = [];
  state.termGradeRecords = {};

  const termGrades = calculateTermGradesForClassTerm('class-weighted', 'all', 'dates');
  const student = termGrades.students['stu-1'];
  assert.ok(student);
  assert.strictEqual(student.final.levelId, 'AS');
  assert.strictEqual(student.final.numericScore, '2.00');
  assert.strictEqual(student.competencies['comp-weight-3'].isLocked, true);
}

// Test: exceeding NA limit forces final NA even with weights
{
  state.activities = [{
    id: 'class-limit',
    type: 'class',
    name: 'Limit NA',
    studentIds: ['stu-1'],
    competencies: [
      { id: 'comp-limit-1', code: 'C1', criteria: [{ id: 'crit-limit-1', code: 'CR1' }] },
      { id: 'comp-limit-2', code: 'C2', criteria: [{ id: 'crit-limit-2', code: 'CR2' }] },
    ],
  }];
  state.learningActivities = [
    {
      id: 'act-limit-1',
      classId: 'class-limit',
      rubric: {
        items: [
          { id: 'item-limit-1', competencyId: 'comp-limit-1', criterionId: 'crit-limit-1', scoring: { mode: 'competency' }, weight: 1 },
        ],
        evaluations: {
          'stu-1': {
            scores: { 'item-limit-1': 'NA' },
            flags: { notPresented: false, exempt: false },
          },
        },
      },
    },
    {
      id: 'act-limit-2',
      classId: 'class-limit',
      rubric: {
        items: [
          { id: 'item-limit-2', competencyId: 'comp-limit-2', criterionId: 'crit-limit-2', scoring: { mode: 'competency' }, weight: 3 },
        ],
        evaluations: {
          'stu-1': {
            scores: { 'item-limit-2': 'NA' },
            flags: { notPresented: false, exempt: false },
          },
        },
      },
    },
  ];
  state.students = [{ id: 'stu-1', firstName: 'Anna', lastName: 'Example' }];
  const config = createDefaultEvaluationConfig();
  config.competency.maxNotAchieved.term = 1;
  state.evaluationSettings = { 'class-limit': config };
  state.terms = [];
  state.termGradeRecords = {};

  const termGrades = calculateTermGradesForClassTerm('class-limit', 'all', 'dates');
  const student = termGrades.students['stu-1'];
  assert.ok(student);
  assert.strictEqual(student.final.levelId, 'NA');
  assert.strictEqual(student.final.numericScore, '1.00');
}

console.log('All evaluation tests passed.');
