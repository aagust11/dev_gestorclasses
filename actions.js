// actions.js: Lògica per respondre a les accions de la interfície.

import { state, saveState } from './state.js';
import {
    ensureSharedConfig,
    getSharedConfigForSubject,
    createSharedConfig,
    cloneSharedConfig,
    reorderList,
    findAssessment,
    ensureAttendanceRecord,
    removeSharedConfigIfUnused
} from './utils.js';

function getSubject(subjectId) {
    return state.subjects.find(subject => subject.id === subjectId);
}

function getStudent(studentId) {
    return state.students.find(student => student.id === studentId);
}

function ensureSubjectStructures(subject) {
    if (!subject.studentIds) subject.studentIds = [];
    if (!subject.assessments) subject.assessments = {};
    if (!subject.attendance) subject.attendance = {};
}

export const actionHandlers = {
    'switch-view': (element) => {
        const view = element.dataset.view;
        if (view) {
            state.activeView = view;
            if (view === 'subjects' && !state.selectedSubjectId && state.subjects.length > 0) {
                state.selectedSubjectId = state.subjects[0].id;
            }
            if (view === 'evaluation' && !state.selectedEvaluationSubjectId && state.subjects.length > 0) {
                state.selectedEvaluationSubjectId = state.subjects[0].id;
            }
            if (view === 'attendance' && !state.selectedAttendanceSubjectId && state.subjects.length > 0) {
                state.selectedAttendanceSubjectId = state.subjects[0].id;
            }
        }
    },

    'create-subject': (element) => {
        const containerId = element.dataset.containerId;
        const container = document.getElementById(containerId);
        if (!container) return;
        const nameInput = container.querySelector('input[name="subject-name"]');
        const startInput = container.querySelector('input[name="subject-start"]');
        const endInput = container.querySelector('input[name="subject-end"]');

        const name = nameInput?.value.trim();
        if (!name) return;

        const newSubject = {
            id: crypto.randomUUID(),
            name,
            startDate: startInput?.value || '',
            endDate: endInput?.value || '',
            classDays: [],
            studentIds: [],
            assessments: {},
            attendance: {}
        };

        const newConfig = createSharedConfig();
        state.sharedConfigs.push(newConfig);
        newSubject.sharedConfigId = newConfig.id;

        state.subjects.push(newSubject);
        state.selectedSubjectId = newSubject.id;
        state.selectedEvaluationSubjectId = newSubject.id;
        state.selectedAttendanceSubjectId = newSubject.id;

        if (nameInput) nameInput.value = '';
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';

        saveState();
    },

    'select-subject': (element) => {
        const subjectId = element.dataset.subjectId;
        state.selectedSubjectId = subjectId || null;
    },

    'update-subject-field': (element) => {
        const subjectId = element.dataset.subjectId;
        const field = element.dataset.field;
        const subject = getSubject(subjectId);
        if (!subject || !field) return false;
        subject[field] = element.value;
        saveState();
        return false;
    },

    'toggle-subject-day': (element) => {
        const subjectId = element.dataset.subjectId;
        const day = element.dataset.day;
        const subject = getSubject(subjectId);
        if (!subject || !day) return false;
        if (!subject.classDays) subject.classDays = [];
        if (element.checked) {
            if (!subject.classDays.includes(day)) {
                subject.classDays.push(day);
            }
        } else {
            subject.classDays = subject.classDays.filter(existing => existing !== day);
        }
        saveState();
        return false;
    },

    'link-subject': (element) => {
        const subjectId = element.dataset.subjectId;
        const targetId = element.value;
        const subject = getSubject(subjectId);
        const target = getSubject(targetId);
        if (!subject || !target || subject.id === target.id) return false;
        const oldConfigId = subject.sharedConfigId;
        subject.sharedConfigId = target.sharedConfigId;
        ensureSharedConfig(subject);
        removeSharedConfigIfUnused(oldConfigId);
        saveState();
        return false;
    },

    'unlink-subject': (element) => {
        const subjectId = element.dataset.subjectId;
        const subject = getSubject(subjectId);
        if (!subject) return;
        const sharedConfig = getSharedConfigForSubject(subjectId);
        if (!sharedConfig) return;
        const cloned = cloneSharedConfig(sharedConfig);
        state.sharedConfigs.push(cloned);
        subject.sharedConfigId = cloned.id;
        saveState();
    },

    'add-period': (element, event) => {
        if (event) event.preventDefault();
        const subjectId = element.dataset.subjectId;
        const containerId = element.dataset.containerId;
        const container = document.getElementById(containerId);
        const nameInput = container?.querySelector('input[name="period-name"]');
        const startInput = container?.querySelector('input[name="period-start"]');
        const endInput = container?.querySelector('input[name="period-end"]');

        const name = nameInput?.value.trim();
        if (!name) return;

        const config = getSharedConfigForSubject(subjectId);
        if (!config.periods) config.periods = [];
        config.periods.push({
            id: crypto.randomUUID(),
            name,
            startDate: startInput?.value || '',
            endDate: endInput?.value || '',
            order: config.periods.length
        });

        if (nameInput) nameInput.value = '';
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';

        saveState();
    },

    'delete-period': (element) => {
        const subjectId = element.dataset.subjectId;
        const periodId = element.dataset.periodId;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        config.periods = (config.periods || []).filter(period => period.id !== periodId);
        saveState();
    },

    'reorder-period': (element) => {
        const subjectId = element.dataset.subjectId;
        const periodId = element.dataset.periodId;
        const direction = element.dataset.direction;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        reorderList(config.periods, periodId, direction);
        config.periods.forEach((period, index) => period.order = index);
        saveState();
    },

    'add-holiday': (element, event) => {
        if (event) event.preventDefault();
        const subjectId = element.dataset.subjectId;
        const containerId = element.dataset.containerId;
        const container = document.getElementById(containerId);
        const nameInput = container?.querySelector('input[name="holiday-name"]');
        const startInput = container?.querySelector('input[name="holiday-start"]');
        const endInput = container?.querySelector('input[name="holiday-end"]');
        const name = nameInput?.value.trim();
        if (!name) return;
        const config = getSharedConfigForSubject(subjectId);
        if (!config.holidays) config.holidays = [];
        config.holidays.push({
            id: crypto.randomUUID(),
            name,
            startDate: startInput?.value || '',
            endDate: endInput?.value || '',
            order: config.holidays.length
        });
        if (nameInput) nameInput.value = '';
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        saveState();
    },

    'delete-holiday': (element) => {
        const subjectId = element.dataset.subjectId;
        const holidayId = element.dataset.holidayId;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        config.holidays = (config.holidays || []).filter(holiday => holiday.id !== holidayId);
        saveState();
    },

    'add-competency': (element) => {
        const subjectId = element.dataset.subjectId;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        const nameInputId = element.dataset.nameInput;
        const descriptionInputId = element.dataset.descriptionInput;
        const nameInput = document.getElementById(nameInputId);
        const descriptionInput = document.getElementById(descriptionInputId);
        const name = nameInput?.value.trim();
        if (!name) return;
        if (!config.competencies) config.competencies = [];
        config.competencies.push({
            id: crypto.randomUUID(),
            name,
            description: descriptionInput?.value || '',
            order: config.competencies.length
        });
        if (nameInput) nameInput.value = '';
        if (descriptionInput) descriptionInput.value = '';
        saveState();
    },

    'update-competency-field': (element) => {
        const subjectId = element.dataset.subjectId;
        const competencyId = element.dataset.competencyId;
        const field = element.dataset.field;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return false;
        const competency = (config.competencies || []).find(comp => comp.id === competencyId);
        if (!competency) return false;
        competency[field] = element.value;
        saveState();
        return false;
    },

    'delete-competency': (element) => {
        const subjectId = element.dataset.subjectId;
        const competencyId = element.dataset.competencyId;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        config.competencies = (config.competencies || []).filter(comp => comp.id !== competencyId);
        config.criteria = (config.criteria || []).filter(criterion => criterion.competencyId !== competencyId);
        config.activities = (config.activities || []).map(activity => ({
            ...activity,
            weights: (activity.weights || []).filter(weight => {
                return config.criteria.some(c => c.id === weight.criterionId);
            })
        }));
        saveState();
    },

    'reorder-competency': (element) => {
        const subjectId = element.dataset.subjectId;
        const competencyId = element.dataset.competencyId;
        const direction = element.dataset.direction;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        reorderList(config.competencies, competencyId, direction);
        config.competencies.forEach((comp, index) => comp.order = index);
        saveState();
    },

    'add-criterion': (element) => {
        const subjectId = element.dataset.subjectId;
        const competencyId = element.dataset.competencyId;
        const nameInputId = element.dataset.nameInput;
        const descriptionInputId = element.dataset.descriptionInput;
        const nameInput = document.getElementById(nameInputId);
        const descriptionInput = document.getElementById(descriptionInputId);
        const name = nameInput?.value.trim();
        if (!name) return;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        if (!config.criteria) config.criteria = [];
        const siblings = config.criteria.filter(criterion => criterion.competencyId === competencyId);
        config.criteria.push({
            id: crypto.randomUUID(),
            competencyId,
            name,
            description: descriptionInput?.value || '',
            order: siblings.length
        });
        if (nameInput) nameInput.value = '';
        if (descriptionInput) descriptionInput.value = '';
        saveState();
    },

    'update-criterion-field': (element) => {
        const subjectId = element.dataset.subjectId;
        const criterionId = element.dataset.criterionId;
        const field = element.dataset.field;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return false;
        const criterion = (config.criteria || []).find(cri => cri.id === criterionId);
        if (!criterion) return false;
        criterion[field] = element.value;
        saveState();
        return false;
    },

    'delete-criterion': (element) => {
        const subjectId = element.dataset.subjectId;
        const criterionId = element.dataset.criterionId;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        config.criteria = (config.criteria || []).filter(criterion => criterion.id !== criterionId);
        config.activities = (config.activities || []).map(activity => ({
            ...activity,
            weights: (activity.weights || []).filter(weight => weight.criterionId !== criterionId)
        }));
        saveState();
    },

    'reorder-criterion': (element) => {
        const subjectId = element.dataset.subjectId;
        const competencyId = element.dataset.competencyId;
        const criterionId = element.dataset.criterionId;
        const direction = element.dataset.direction;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        const criteria = config.criteria.filter(criterion => criterion.competencyId === competencyId);
        reorderList(criteria, criterionId, direction);
        criteria.forEach((criterion, index) => {
            criterion.order = index;
        });
        config.criteria = config.criteria
            .filter(criterion => criterion.competencyId !== competencyId)
            .concat(criteria);
        saveState();
    },

    'add-activity': (element) => {
        const subjectId = element.dataset.subjectId;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        const nameInputId = element.dataset.nameInput;
        const descriptionInputId = element.dataset.descriptionInput;
        const nameInput = document.getElementById(nameInputId);
        const descriptionInput = document.getElementById(descriptionInputId);
        const name = nameInput?.value.trim();
        if (!name) return;
        if (!config.activities) config.activities = [];
        config.activities.push({
            id: crypto.randomUUID(),
            name,
            description: descriptionInput?.value || '',
            weights: [],
            order: config.activities.length
        });
        if (nameInput) nameInput.value = '';
        if (descriptionInput) descriptionInput.value = '';
        saveState();
    },

    'update-activity-field': (element) => {
        const subjectId = element.dataset.subjectId;
        const activityId = element.dataset.activityId;
        const field = element.dataset.field;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return false;
        const activity = (config.activities || []).find(act => act.id === activityId);
        if (!activity) return false;
        activity[field] = element.value;
        saveState();
        return false;
    },

    'delete-activity': (element) => {
        const subjectId = element.dataset.subjectId;
        const activityId = element.dataset.activityId;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        config.activities = (config.activities || []).filter(activity => activity.id !== activityId);
        saveState();
    },

    'reorder-activity': (element) => {
        const subjectId = element.dataset.subjectId;
        const activityId = element.dataset.activityId;
        const direction = element.dataset.direction;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return;
        reorderList(config.activities, activityId, direction);
        config.activities.forEach((activity, index) => activity.order = index);
        saveState();
    },

    'update-activity-weight': (element) => {
        const subjectId = element.dataset.subjectId;
        const activityId = element.dataset.activityId;
        const criterionId = element.dataset.criterionId;
        const config = getSharedConfigForSubject(subjectId);
        if (!config) return false;
        const activity = (config.activities || []).find(act => act.id === activityId);
        if (!activity) return false;
        if (!activity.weights) activity.weights = [];
        const weightValue = element.value === '' ? '' : parseInt(element.value, 10);
        const existing = activity.weights.find(weight => weight.criterionId === criterionId);
        if (existing) {
            existing.value = isNaN(weightValue) ? '' : weightValue;
        } else {
            activity.weights.push({
                criterionId,
                value: isNaN(weightValue) ? '' : weightValue
            });
        }
        activity.weights = activity.weights.filter(weight => weight.value !== '' && !isNaN(weight.value));
        saveState();
        return false;
    },

    'create-student': (element) => {
        const containerId = element.dataset.containerId;
        const container = document.getElementById(containerId);
        const nameInput = container?.querySelector('input[name="student-name"]');
        const notesInput = container?.querySelector('textarea[name="student-notes"]');
        const name = nameInput?.value.trim();
        if (!name) return;
        const newStudent = {
            id: crypto.randomUUID(),
            name,
            notes: notesInput?.value || ''
        };
        state.students.push(newStudent);
        if (nameInput) nameInput.value = '';
        if (notesInput) notesInput.value = '';
        saveState();
    },

    'update-student-field': (element) => {
        const studentId = element.dataset.studentId;
        const field = element.dataset.field;
        const student = getStudent(studentId);
        if (!student) return false;
        student[field] = element.value;
        saveState();
        return false;
    },

    'delete-student': (element) => {
        const studentId = element.dataset.studentId;
        state.students = state.students.filter(student => student.id !== studentId);
        state.subjects.forEach(subject => {
            subject.studentIds = (subject.studentIds || []).filter(id => id !== studentId);
            Object.values(subject.assessments || {}).forEach(activityAssessments => {
                delete activityAssessments[studentId];
            });
            Object.values(subject.attendance || {}).forEach(dayRecord => {
                delete dayRecord[studentId];
            });
        });
        saveState();
    },

    'toggle-student-subject': (element) => {
        const studentId = element.dataset.studentId;
        const subjectId = element.dataset.subjectId;
        const subject = getSubject(subjectId);
        if (!subject) return;
        ensureSubjectStructures(subject);
        if (element.checked) {
            if (!subject.studentIds.includes(studentId)) {
                subject.studentIds.push(studentId);
            }
        } else {
            subject.studentIds = subject.studentIds.filter(id => id !== studentId);
        }
        saveState();
        return false;
    },

    'select-evaluation-subject': (element) => {
        const subjectId = element.value;
        state.selectedEvaluationSubjectId = subjectId || null;
        const subject = getSubject(subjectId);
        if (subject) {
            const config = ensureSharedConfig(subject);
            if (config.activities.length > 0) {
                state.selectedEvaluationActivityId = config.activities[0].id;
            } else {
                state.selectedEvaluationActivityId = null;
            }
        }
    },

    'select-evaluation-activity': (element) => {
        state.selectedEvaluationActivityId = element.value || null;
    },

    'toggle-evaluation-view-mode': (element) => {
        const mode = element.dataset.mode;
        if (mode) {
            state.evaluationViewMode = mode;
        }
    },

    'set-assessment': (element) => {
        const subjectId = element.dataset.subjectId;
        const activityId = element.dataset.activityId;
        const criterionId = element.dataset.criterionId;
        const studentId = element.dataset.studentId;
        const subject = getSubject(subjectId);
        if (!subject) return false;
        ensureSubjectStructures(subject);
        const assessment = findAssessment(subject, activityId, studentId);
        assessment[criterionId] = element.value;
        saveState();
        return false;
    },

    'set-settings-field': (element) => {
        const field = element.dataset.field;
        if (!field) return false;
        state.settings[field] = element.value;
        if (field === 'evaluationMode' && state.settings.evaluationMode === 'numeric') {
            state.subjects.forEach(subject => {
                Object.values(subject.assessments || {}).forEach(activityAssessments => {
                    Object.values(activityAssessments).forEach(criteriaAssessments => {
                        Object.keys(criteriaAssessments).forEach(criterionId => {
                            const value = criteriaAssessments[criterionId];
                            if (value && value !== '' && isNaN(Number(value))) {
                                criteriaAssessments[criterionId] = '';
                            }
                        });
                    });
                });
            });
        }
        saveState();
        return true;
    },

    'add-qualitative-value': (element) => {
        const inputId = element.dataset.inputId;
        const input = document.getElementById(inputId);
        const value = input?.value.trim();
        if (!value) return;
        if (!state.settings.qualitativeScale.includes(value)) {
            state.settings.qualitativeScale.push(value);
        }
        input.value = '';
        saveState();
    },

    'remove-qualitative-value': (element) => {
        const value = element.dataset.value;
        state.settings.qualitativeScale = state.settings.qualitativeScale.filter(item => item !== value);
        saveState();
    },

    'select-attendance-subject': (element) => {
        const subjectId = element.value;
        state.selectedAttendanceSubjectId = subjectId || null;
    },

    'select-attendance-date': (element) => {
        state.selectedAttendanceDate = element.value || state.selectedAttendanceDate;
    },

    'update-attendance-field': (element) => {
        const subjectId = element.dataset.subjectId;
        const studentId = element.dataset.studentId;
        const field = element.dataset.field;
        const subject = getSubject(subjectId);
        if (!subject) return false;
        ensureSubjectStructures(subject);
        const attendance = ensureAttendanceRecord(subject, state.selectedAttendanceDate);
        if (!attendance[studentId]) attendance[studentId] = {
            status: 'present',
            minutes: '',
            attitude: '',
            comment: ''
        };
        let value = element.value;
        if (field === 'minutes') {
            value = value === '' ? '' : Math.max(0, parseInt(value, 10) || 0);
        }
        attendance[studentId][field] = value;
        saveState();
        return false;
    },

    'select-subject-for-student': (element) => {
        const subjectId = element.value;
        if (subjectId) {
            state.selectedSubjectId = subjectId;
        }
    }
};
