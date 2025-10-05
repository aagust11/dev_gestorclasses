// utils.js: Funcions auxiliars de l'aplicació.

import { state, saveState } from './state.js';

export function createSharedConfig() {
    return {
        id: crypto.randomUUID(),
        periods: [],
        competencies: [],
        criteria: [],
        activities: [],
        holidays: []
    };
}

export function cloneSharedConfig(config) {
    const base = createSharedConfig();

    const periodClones = (config.periods || []).map(period => ({
        ...period,
        id: crypto.randomUUID()
    }));

    const competencyMap = new Map();
    const competencyClones = (config.competencies || []).map(competency => {
        const newId = crypto.randomUUID();
        competencyMap.set(competency.id, newId);
        return {
            ...competency,
            id: newId
        };
    });

    const criterionMap = new Map();
    const criterionClones = (config.criteria || []).map(criterion => {
        const newId = crypto.randomUUID();
        criterionMap.set(criterion.id, newId);
        return {
            ...criterion,
            id: newId,
            competencyId: competencyMap.get(criterion.competencyId) || criterion.competencyId
        };
    });

    const activityClones = (config.activities || []).map(activity => ({
        ...activity,
        id: crypto.randomUUID(),
        weights: (activity.weights || []).map(weight => ({
            ...weight,
            criterionId: criterionMap.get(weight.criterionId) || weight.criterionId
        }))
    }));

    const holidayClones = (config.holidays || []).map(holiday => ({
        ...holiday,
        id: crypto.randomUUID()
    }));

    return {
        ...base,
        periods: periodClones,
        competencies: competencyClones,
        criteria: criterionClones,
        activities: activityClones,
        holidays: holidayClones
    };
}

export function getSharedConfigById(sharedConfigId) {
    return state.sharedConfigs.find(cfg => cfg.id === sharedConfigId);
}

export function ensureSharedConfig(subject) {
    if (!subject.sharedConfigId) {
        const newConfig = createSharedConfig();
        state.sharedConfigs.push(newConfig);
        subject.sharedConfigId = newConfig.id;
        saveState();
    }
    return getSharedConfigById(subject.sharedConfigId);
}

export function getSharedConfigForSubject(subjectId) {
    const subject = state.subjects.find(s => s.id === subjectId);
    if (!subject) return null;
    return ensureSharedConfig(subject);
}

export function removeSharedConfigIfUnused(sharedConfigId) {
    if (!sharedConfigId) return;
    const used = state.subjects.some(subject => subject.sharedConfigId === sharedConfigId);
    if (!used) {
        state.sharedConfigs = state.sharedConfigs.filter(cfg => cfg.id !== sharedConfigId);
    }
}

export function reorderList(list, id, direction) {
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return;
    if (direction === 'up' && index > 0) {
        [list[index - 1], list[index]] = [list[index], list[index - 1]];
    } else if (direction === 'down' && index < list.length - 1) {
        [list[index + 1], list[index]] = [list[index], list[index + 1]];
    }
}

export function formatDateDisplay(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('ca-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

export function generateCompetencyCode(config, competencyId) {
    const competencies = (config.competencies || []).slice();
    const sorted = competencies.sort((a, b) => a.order - b.order);
    const index = sorted.findIndex(c => c.id === competencyId);
    if (index === -1) return '';
    return `CE${state.settings.competencyCodeText || ''}${index + 1}`;
}

export function generateCriterionCode(config, criterion) {
    const competency = config.competencies.find(c => c.id === criterion.competencyId);
    if (!competency) return '';
    const competencyCode = generateCompetencyCode(config, competency.id).replace(/^CE/, '');
    const criteria = config.criteria
        .filter(c => c.competencyId === competency.id)
        .sort((a, b) => a.order - b.order);
    const index = criteria.findIndex(c => c.id === criterion.id);
    if (index === -1) return '';
    const middle = state.settings.criterionCodeText || '';
    return `CA${middle}${competencyCode}.${index + 1}`;
}

export function getStudentsForSubject(subject) {
    if (!subject) return [];
    return state.students.filter(student => subject.studentIds?.includes(student.id));
}

export function getCriteriaForCompetency(config, competencyId) {
    return (config.criteria || [])
        .filter(criterion => criterion.competencyId === competencyId)
        .sort((a, b) => a.order - b.order);
}

export function getCompetencies(config) {
    return (config.competencies || []).sort((a, b) => a.order - b.order);
}

export function getActivities(config) {
    return (config.activities || []).sort((a, b) => a.order - b.order);
}

export function getPeriods(config) {
    return (config.periods || []).sort((a, b) => a.order - b.order);
}

export function getHolidays(config) {
    return (config.holidays || []).sort((a, b) => a.order - b.order);
}

export function findAssessment(subject, activityId, studentId) {
    if (!subject.assessments) subject.assessments = {};
    if (!subject.assessments[activityId]) subject.assessments[activityId] = {};
    if (!subject.assessments[activityId][studentId]) subject.assessments[activityId][studentId] = {};
    return subject.assessments[activityId][studentId];
}

export function ensureAttendanceRecord(subject, date) {
    if (!subject.attendance) subject.attendance = {};
    if (!subject.attendance[date]) subject.attendance[date] = {};
    return subject.attendance[date];
}

export function formatDateForInput(date) {
    if (!date) return '';
    return new Date(date).toISOString().slice(0, 10);
}

export function todayISO() {
    return new Date().toISOString().slice(0, 10);
}
