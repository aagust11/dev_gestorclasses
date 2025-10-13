import assert from 'node:assert';
import {
  state,
  scheduleTemplateSync,
  saveState,
  LEARNING_ACTIVITY_STATUS,
} from '../state.js';

// Stub DOM/globals used by saveState
if (!globalThis.document) {
  globalThis.document = {
    getElementById: () => null,
  };
}
if (!globalThis.lucide) {
  globalThis.lucide = {
    createIcons: () => {},
  };
}

function resetStateForTemplateTests() {
  state.activities = [];
  state.learningActivities = [];
  state.students = [];
  state.timeSlots = [];
  state.schedule = {};
  state.scheduleOverrides = [];
  state.classEntries = {};
  state.evaluationSettings = {};
  state.evaluationSettingsDraft = {};
  state.termGradeRecords = {};
  state.termGradeExpandedCompetencies = {};
  state.dataFileHandle = null;
  state.dataFileName = '';
  state.dataPersistenceSupported = false;
  state.dataPersistenceStatus = 'unconfigured';
  state.dataPersistenceError = null;
}

// Test 1: Template cascades competencies, learning activities and evaluation config
{
  resetStateForTemplateTests();

  const templateId = 'tpl-1';
  const childId = 'child-1';

  state.activities = [
    {
      id: templateId,
      name: 'Plantilla Matemàtiques',
      type: 'class',
      isTemplate: true,
      color: '#FFFFFF',
      competencies: [
        {
          id: 'comp-1',
          code: 'CE1',
          description: 'Competència 1',
          criteria: [
            { id: 'crit-1', code: 'CR1', description: 'Criteri 1' },
          ],
        },
      ],
    },
    {
      id: childId,
      name: '4t ESO A',
      type: 'class',
      isTemplate: false,
      templateId,
      color: '#EEEEEE',
      competencies: [],
      studentIds: ['stu-1'],
    },
  ];

  state.learningActivities = [
    {
      id: 'tpl-act-1',
      classId: templateId,
      title: 'Projecte',
      shortCode: 'PRJ',
      description: 'Projecte inicial',
      criteriaRefs: [
        { competencyId: 'comp-1', criterionId: 'crit-1' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startDate: '',
      endDate: '',
      rubric: { items: [], evaluations: {} },
      status: LEARNING_ACTIVITY_STATUS.SCHEDULED,
      statusIsManual: false,
      weight: 1,
    },
  ];

  scheduleTemplateSync(templateId);
  await saveState();

  const templateClass = state.activities.find(act => act.id === templateId);
  const childClass = state.activities.find(act => act.id === childId);

  assert.ok(templateClass, 'Template class should exist');
  assert.ok(childClass, 'Child class should exist');
  assert.notStrictEqual(childClass.competencies, templateClass.competencies, 'Competency arrays should be cloned');
  assert.deepStrictEqual(childClass.competencies, templateClass.competencies, 'Competencies should be inherited from template');

  const templateActivity = state.learningActivities.find(act => act.classId === templateId && act.isTemplateSource);
  const childActivity = state.learningActivities.find(act => act.classId === childId && act.templateSourceId === 'tpl-act-1');

  assert.ok(templateActivity, 'Template learning activity should be marked as template source');
  assert.ok(childActivity, 'Child learning activity should exist');
  assert.notStrictEqual(childActivity.criteriaRefs, templateActivity.criteriaRefs, 'Criteria refs should be cloned');
  assert.deepStrictEqual(childActivity.criteriaRefs, templateActivity.criteriaRefs, 'Criteria refs should match template');
  assert.strictEqual(childActivity.isTemplateSource, false, 'Child activity should not be marked as template source');

  const templateConfig = state.evaluationSettings[templateId];
  const childConfig = state.evaluationSettings[childId];
  assert.ok(templateConfig, 'Template evaluation config should exist');
  assert.ok(childConfig, 'Child evaluation config should exist');
  assert.deepStrictEqual(childConfig, templateConfig, 'Evaluation config should cascade');
}

// Test 2: Removing template activities cleans up inherited learning activities
{
  resetStateForTemplateTests();

  const templateId = 'tpl-2';
  const childId = 'child-2';

  state.activities = [
    { id: templateId, name: 'Plantilla Ciències', type: 'class', isTemplate: true, color: '#abcdef', competencies: [] },
    { id: childId, name: '3r ESO B', type: 'class', isTemplate: false, templateId, color: '#fedcba', competencies: [] },
  ];

  state.learningActivities = [
    { id: 'tpl-act-2', classId: templateId, title: 'Laboratori', shortCode: 'LAB', description: '', criteriaRefs: [], rubric: { items: [], evaluations: {} }, status: LEARNING_ACTIVITY_STATUS.SCHEDULED, statusIsManual: false, weight: 1 },
    { id: 'child-act-2', classId: childId, title: 'Laboratori', shortCode: 'LAB', description: '', criteriaRefs: [], rubric: { items: [], evaluations: {} }, status: LEARNING_ACTIVITY_STATUS.SCHEDULED, statusIsManual: false, weight: 1, templateSourceId: 'tpl-act-2' },
  ];

  scheduleTemplateSync(templateId);
  await saveState();

  // Remove the template activity and resync
  state.learningActivities = state.learningActivities.filter(act => act.id !== 'tpl-act-2');
  scheduleTemplateSync(templateId);
  await saveState();

  const orphan = state.learningActivities.find(act => act.classId === childId && act.templateSourceId === 'tpl-act-2');
  assert.strictEqual(orphan, undefined, 'Child inherited activities should be removed when template source disappears');
}

console.log('All template synchronization tests passed.');
