import assert from 'node:assert';
import {
  createDefaultEvaluationConfig,
  qualitativeToNumeric,
  calculateWeightedCompetencyResult,
  calculateMajorityCompetencyResult,
  normalizeEvaluationConfig,
  NP_TREATMENTS,
  NO_EVIDENCE_BEHAVIOR,
} from '../evaluation.js';

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
  assert.strictEqual(result.levelId, 'AN');
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

console.log('All evaluation tests passed.');
