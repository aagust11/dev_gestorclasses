// views.js: Generació del HTML per a cada vista.

import { state } from './state.js';
import {
    ensureSharedConfig,
    getCompetencies,
    getCriteriaForCompetency,
    getActivities,
    getPeriods,
    getHolidays,
    generateCompetencyCode,
    generateCriterionCode,
    getStudentsForSubject,
    formatDateDisplay
} from './utils.js';

const DAYS = [
    { key: 'monday', label: 'Dilluns' },
    { key: 'tuesday', label: 'Dimarts' },
    { key: 'wednesday', label: 'Dimecres' },
    { key: 'thursday', label: 'Dijous' },
    { key: 'friday', label: 'Divendres' },
    { key: 'saturday', label: 'Dissabte' },
    { key: 'sunday', label: 'Diumenge' }
];

function renderSubjectList(selectedSubjectId) {
    if (state.subjects.length === 0) {
        return `<p class="text-gray-600">Encara no hi ha cap assignatura creada.</p>`;
    }

    return `
        <div class="grid gap-3">
            ${state.subjects.map(subject => `
                <button
                    data-action="select-subject"
                    data-subject-id="${subject.id}"
                    class="text-left border rounded-lg p-3 hover:border-blue-500 ${selectedSubjectId === subject.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}"
                >
                    <div class="flex items-center justify-between">
                        <div>
                            <h3 class="text-lg font-semibold text-gray-800">${subject.name || 'Sense nom'}</h3>
                            <p class="text-sm text-gray-500">Inici: ${formatDateDisplay(subject.startDate) || '—'} · Fi: ${formatDateDisplay(subject.endDate) || '—'}</p>
                        </div>
                        <i data-lucide="chevron-right" class="w-4 h-4 text-gray-400"></i>
                    </div>
                </button>
            `).join('')}
        </div>
    `;
}

function renderSubjectGeneralInfo(subject) {
    return `
        <section class="bg-white rounded-lg shadow p-4 space-y-4">
            <div class="flex items-center justify-between">
                <h3 class="text-xl font-semibold text-gray-800">Informació general</h3>
                <div>
                    <label class="text-sm font-medium text-gray-700">Vincular amb:</label>
                    <select data-action="link-subject" data-subject-id="${subject.id}" class="ml-2 border rounded px-2 py-1">
                        <option value="">Selecciona assignatura</option>
                        ${state.subjects
                            .filter(other => other.id !== subject.id)
                            .map(other => `<option value="${other.id}">${other.name}</option>`)
                            .join('')}
                    </select>
                    <button data-action="unlink-subject" data-subject-id="${subject.id}" class="ml-2 text-sm text-blue-600 hover:underline">Desvincular</button>
                </div>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
                <label class="flex flex-col text-sm font-medium text-gray-700">
                    Nom de l'assignatura
                    <input type="text" data-action="update-subject-field" data-field="name" data-subject-id="${subject.id}" value="${subject.name || ''}" class="mt-1 border rounded px-3 py-2">
                </label>
                <label class="flex flex-col text-sm font-medium text-gray-700">
                    Data d'inici
                    <input type="date" data-action="update-subject-field" data-field="startDate" data-subject-id="${subject.id}" value="${subject.startDate || ''}" class="mt-1 border rounded px-3 py-2">
                </label>
                <label class="flex flex-col text-sm font-medium text-gray-700">
                    Data de fi
                    <input type="date" data-action="update-subject-field" data-field="endDate" data-subject-id="${subject.id}" value="${subject.endDate || ''}" class="mt-1 border rounded px-3 py-2">
                </label>
            </div>
            <div>
                <h4 class="text-sm font-semibold text-gray-700 mb-2">Dies de classe</h4>
                <div class="flex flex-wrap gap-3">
                    ${DAYS.map(day => `
                        <label class="inline-flex items-center gap-2 text-sm">
                            <input type="checkbox" data-action="toggle-subject-day" data-subject-id="${subject.id}" data-day="${day.key}" ${subject.classDays?.includes(day.key) ? 'checked' : ''}>
                            ${day.label}
                        </label>
                    `).join('')}
                </div>
            </div>
            <div>
                <h4 class="text-sm font-semibold text-gray-700 mb-2">Alumnat assignat</h4>
                ${state.students.length === 0
                    ? '<p class="text-gray-500 text-sm">Encara no hi ha alumnes. Afegeix alumnes des de la pestanya «Alumnes».</p>'
                    : `<div class="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                        ${state.students.map(student => `
                            <label class="flex items-center gap-2 text-sm bg-gray-50 border border-gray-200 rounded px-2 py-1">
                                <input type="checkbox" data-action="toggle-student-subject" data-subject-id="${subject.id}" data-student-id="${student.id}" ${subject.studentIds?.includes(student.id) ? 'checked' : ''}>
                                <span>${student.name}</span>
                            </label>
                        `).join('')}
                    </div>`}
            </div>
            <div class="text-sm text-gray-500">
                <p>Assignatures actualment vinculades: ${state.subjects.filter(s => s.sharedConfigId === subject.sharedConfigId).map(s => s.name).join(', ')}</p>
            </div>
        </section>
    `;
}

function renderPeriodsSection(subject) {
    const config = ensureSharedConfig(subject);
    const periods = getPeriods(config);
    const formId = `period-form-${subject.id}`;

    return `
        <section class="bg-white rounded-lg shadow p-4 space-y-4">
            <div class="flex items-center justify-between">
                <h3 class="text-xl font-semibold text-gray-800">Períodes d'avaluació</h3>
            </div>
            ${periods.length === 0 ? '<p class="text-gray-500 text-sm">Afegeix els períodes d'avaluació per organitzar el curs.</p>' : ''}
            <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                    <thead>
                        <tr class="text-left text-gray-500">
                            <th class="px-2 py-1">Nom</th>
                            <th class="px-2 py-1">Inici</th>
                            <th class="px-2 py-1">Fi</th>
                            <th class="px-2 py-1 text-right">Accions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${periods.map(period => `
                            <tr class="border-t">
                                <td class="px-2 py-1 font-medium">${period.name}</td>
                                <td class="px-2 py-1">${formatDateDisplay(period.startDate)}</td>
                                <td class="px-2 py-1">${formatDateDisplay(period.endDate)}</td>
                                <td class="px-2 py-1 text-right space-x-1">
                                    <button data-action="reorder-period" data-direction="up" data-subject-id="${subject.id}" data-period-id="${period.id}" class="px-2 py-1 text-xs border rounded">▲</button>
                                    <button data-action="reorder-period" data-direction="down" data-subject-id="${subject.id}" data-period-id="${period.id}" class="px-2 py-1 text-xs border rounded">▼</button>
                                    <button data-action="delete-period" data-subject-id="${subject.id}" data-period-id="${period.id}" class="px-2 py-1 text-xs text-red-600 border border-red-200 rounded">Esborrar</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <form id="${formId}" class="grid md:grid-cols-4 gap-3">
                <input name="period-name" type="text" placeholder="Nom" class="border rounded px-2 py-1">
                <input name="period-start" type="date" class="border rounded px-2 py-1">
                <input name="period-end" type="date" class="border rounded px-2 py-1">
                <button data-action="add-period" data-subject-id="${subject.id}" data-container-id="${formId}" class="bg-blue-600 text-white rounded px-3 py-1">Afegir període</button>
            </form>
        </section>
    `;
}

function renderHolidaysSection(subject) {
    const config = ensureSharedConfig(subject);
    const holidays = getHolidays(config);
    const formId = `holiday-form-${subject.id}`;
    return `
        <section class="bg-white rounded-lg shadow p-4 space-y-4">
            <h3 class="text-xl font-semibold text-gray-800">Dies festius i no lectius</h3>
            ${holidays.length === 0 ? '<p class="text-gray-500 text-sm">Afegeix els dies en què no hi haurà classe.</p>' : ''}
            <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                    <thead>
                        <tr class="text-left text-gray-500">
                            <th class="px-2 py-1">Nom</th>
                            <th class="px-2 py-1">Inici</th>
                            <th class="px-2 py-1">Fi</th>
                            <th class="px-2 py-1 text-right">Accions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${holidays.map(holiday => `
                            <tr class="border-t">
                                <td class="px-2 py-1 font-medium">${holiday.name}</td>
                                <td class="px-2 py-1">${formatDateDisplay(holiday.startDate)}</td>
                                <td class="px-2 py-1">${formatDateDisplay(holiday.endDate)}</td>
                                <td class="px-2 py-1 text-right">
                                    <button data-action="delete-holiday" data-subject-id="${subject.id}" data-holiday-id="${holiday.id}" class="px-2 py-1 text-xs text-red-600 border border-red-200 rounded">Esborrar</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <form id="${formId}" class="grid md:grid-cols-4 gap-3">
                <input name="holiday-name" type="text" placeholder="Nom" class="border rounded px-2 py-1">
                <input name="holiday-start" type="date" class="border rounded px-2 py-1">
                <input name="holiday-end" type="date" class="border rounded px-2 py-1">
                <button data-action="add-holiday" data-subject-id="${subject.id}" data-container-id="${formId}" class="bg-blue-600 text-white rounded px-3 py-1">Afegir festiu</button>
            </form>
        </section>
    `;
}

function renderCompetenciesSection(subject) {
    const config = ensureSharedConfig(subject);
    const competencies = getCompetencies(config);
    const competencyHtml = competencies.map(competency => `
        <div class="border border-gray-200 rounded-lg p-4 space-y-3">
            <div class="flex items-center justify-between">
                <div>
                    <h4 class="text-lg font-semibold text-gray-800">${generateCompetencyCode(config, competency.id)} · <input type="text" data-action="update-competency-field" data-field="name" data-subject-id="${subject.id}" data-competency-id="${competency.id}" value="${competency.name}" class="border rounded px-2 py-1"></h4>
                </div>
                <div class="space-x-1">
                    <button data-action="reorder-competency" data-direction="up" data-subject-id="${subject.id}" data-competency-id="${competency.id}" class="px-2 py-1 text-xs border rounded">▲</button>
                    <button data-action="reorder-competency" data-direction="down" data-subject-id="${subject.id}" data-competency-id="${competency.id}" class="px-2 py-1 text-xs border rounded">▼</button>
                    <button data-action="delete-competency" data-subject-id="${subject.id}" data-competency-id="${competency.id}" class="px-2 py-1 text-xs text-red-600 border border-red-200 rounded">Esborrar</button>
                </div>
            </div>
            <textarea data-action="update-competency-field" data-field="description" data-subject-id="${subject.id}" data-competency-id="${competency.id}" class="w-full border rounded px-3 py-2 text-sm" rows="2" placeholder="Descripció">${competency.description || ''}</textarea>
            <div>
                <h5 class="text-sm font-semibold text-gray-700">Criteris d'avaluació</h5>
                <div class="space-y-2">
                    ${getCriteriaForCompetency(config, competency.id).map(criterion => `
                        <div class="border border-gray-200 rounded p-2 space-y-2 bg-gray-50">
                            <div class="flex items-center justify-between">
                                <span class="font-medium text-sm">${generateCriterionCode(config, criterion)}</span>
                                <div class="space-x-1">
                                    <button data-action="reorder-criterion" data-direction="up" data-subject-id="${subject.id}" data-competency-id="${competency.id}" data-criterion-id="${criterion.id}" class="px-2 py-1 text-xs border rounded">▲</button>
                                    <button data-action="reorder-criterion" data-direction="down" data-subject-id="${subject.id}" data-competency-id="${competency.id}" data-criterion-id="${criterion.id}" class="px-2 py-1 text-xs border rounded">▼</button>
                                    <button data-action="delete-criterion" data-subject-id="${subject.id}" data-criterion-id="${criterion.id}" class="px-2 py-1 text-xs text-red-600 border border-red-200 rounded">Esborrar</button>
                                </div>
                            </div>
                            <input type="text" data-action="update-criterion-field" data-field="name" data-subject-id="${subject.id}" data-criterion-id="${criterion.id}" value="${criterion.name}" class="w-full border rounded px-2 py-1 text-sm" placeholder="Títol">
                            <textarea data-action="update-criterion-field" data-field="description" data-subject-id="${subject.id}" data-criterion-id="${criterion.id}" class="w-full border rounded px-2 py-1 text-sm" rows="2" placeholder="Descripció">${criterion.description || ''}</textarea>
                        </div>
                    `).join('')}
                </div>
                ${(() => {
                    const nameInputId = `criterion-name-${competency.id}`;
                    const descriptionInputId = `criterion-description-${competency.id}`;
                    return `
                        <div class="mt-3 bg-white border border-dashed border-gray-300 rounded p-3">
                            <div class="grid gap-2 md:grid-cols-2">
                                <input id="${nameInputId}" type="text" placeholder="Nou criteri" class="border rounded px-2 py-1">
                                <textarea id="${descriptionInputId}" class="border rounded px-2 py-1 md:col-span-2" rows="2" placeholder="Descripció"></textarea>
                            </div>
                            <button data-action="add-criterion" data-subject-id="${subject.id}" data-competency-id="${competency.id}" data-name-input="${nameInputId}" data-description-input="${descriptionInputId}" class="mt-2 bg-blue-600 text-white px-3 py-1 rounded">Afegir criteri</button>
                        </div>
                    `;
                })()}
            </div>
        </div>
    `).join('');

    const newCompNameId = `competency-name-${subject.id}`;
    const newCompDescId = `competency-description-${subject.id}`;

    return `
        <section class="bg-white rounded-lg shadow p-4 space-y-4">
            <h3 class="text-xl font-semibold text-gray-800">Competències específiques</h3>
            ${competencies.length === 0 ? '<p class="text-gray-500 text-sm">Afegeix competències per començar a definir l'avaluació.</p>' : ''}
            <div class="space-y-4">${competencyHtml}</div>
            <div class="border border-dashed border-gray-300 rounded-lg p-4 space-y-2">
                <h4 class="font-semibold text-gray-700">Nova competència</h4>
                <input id="${newCompNameId}" type="text" placeholder="Nom" class="w-full border rounded px-3 py-2">
                <textarea id="${newCompDescId}" rows="2" placeholder="Descripció" class="w-full border rounded px-3 py-2"></textarea>
                <button data-action="add-competency" data-subject-id="${subject.id}" data-name-input="${newCompNameId}" data-description-input="${newCompDescId}" class="bg-blue-600 text-white px-3 py-2 rounded">Afegir competència</button>
            </div>
        </section>
    `;
}

function renderActivitiesSection(subject) {
    const config = ensureSharedConfig(subject);
    const activities = getActivities(config);
    const criteria = config.criteria || [];
    const newNameId = `activity-name-${subject.id}`;
    const newDescriptionId = `activity-description-${subject.id}`;

    const activitiesHtml = activities.map(activity => `
        <div class="border border-gray-200 rounded-lg p-4 space-y-3 bg-white shadow-sm">
            <div class="flex items-center justify-between">
                <input type="text" data-action="update-activity-field" data-field="name" data-subject-id="${subject.id}" data-activity-id="${activity.id}" value="${activity.name}" class="text-lg font-semibold text-gray-800 border rounded px-2 py-1">
                <div class="space-x-1">
                    <button data-action="reorder-activity" data-direction="up" data-subject-id="${subject.id}" data-activity-id="${activity.id}" class="px-2 py-1 text-xs border rounded">▲</button>
                    <button data-action="reorder-activity" data-direction="down" data-subject-id="${subject.id}" data-activity-id="${activity.id}" class="px-2 py-1 text-xs border rounded">▼</button>
                    <button data-action="delete-activity" data-subject-id="${subject.id}" data-activity-id="${activity.id}" class="px-2 py-1 text-xs text-red-600 border border-red-200 rounded">Esborrar</button>
                </div>
            </div>
            <textarea data-action="update-activity-field" data-field="description" data-subject-id="${subject.id}" data-activity-id="${activity.id}" class="w-full border rounded px-3 py-2 text-sm" rows="2" placeholder="Descripció">${activity.description || ''}</textarea>
            <div>
                <h5 class="text-sm font-semibold text-gray-700 mb-2">Ponderació dels criteris</h5>
                ${criteria.length === 0 ? '<p class="text-gray-500 text-sm">Cal definir criteris abans d'assignar pesos.</p>' : `
                    <div class="grid md:grid-cols-2 gap-2">
                        ${criteria.map(criterion => {
                            const weight = (activity.weights || []).find(w => w.criterionId === criterion.id);
                            const value = weight ? weight.value : '';
                            return `
                                <label class="flex items-center justify-between border rounded px-2 py-1 text-sm">
                                    <span>${generateCriterionCode(config, criterion)} - ${criterion.name}</span>
                                    <input type="number" min="0" step="1" value="${value}" data-action="update-activity-weight" data-subject-id="${subject.id}" data-activity-id="${activity.id}" data-criterion-id="${criterion.id}" class="w-20 border rounded px-2 py-1 ml-2">
                                </label>
                            `;
                        }).join('')}
                    </div>
                `}
            </div>
        </div>
    `).join('');

    return `
        <section class="bg-white rounded-lg shadow p-4 space-y-4">
            <h3 class="text-xl font-semibold text-gray-800">Activitats avaluables</h3>
            ${activities.length === 0 ? '<p class="text-gray-500 text-sm">Afegeix activitats i assigna'ls els criteris que avaluaràs.</p>' : ''}
            <div class="space-y-4">${activitiesHtml}</div>
            <div class="border border-dashed border-gray-300 rounded-lg p-4 space-y-2">
                <h4 class="font-semibold text-gray-700">Nova activitat</h4>
                <input id="${newNameId}" type="text" placeholder="Nom" class="w-full border rounded px-3 py-2">
                <textarea id="${newDescriptionId}" rows="2" placeholder="Descripció" class="w-full border rounded px-3 py-2"></textarea>
                <button data-action="add-activity" data-subject-id="${subject.id}" data-name-input="${newNameId}" data-description-input="${newDescriptionId}" class="bg-blue-600 text-white px-3 py-2 rounded">Afegir activitat</button>
            </div>
        </section>
    `;
}

function renderSubjectsView() {
    const selectedSubjectId = state.selectedSubjectId || (state.subjects[0]?.id ?? null);
    if (selectedSubjectId && !state.selectedSubjectId && state.subjects.length > 0) {
        state.selectedSubjectId = selectedSubjectId;
    }
    const selectedSubject = state.subjects.find(subject => subject.id === selectedSubjectId);

    return `
        <div class="p-6 space-y-6">
            <section class="bg-white rounded-lg shadow p-4 space-y-4">
                <h2 class="text-2xl font-bold text-gray-900">Gestió d'assignatures</h2>
                <div id="create-subject-form" class="grid md:grid-cols-4 gap-3">
                    <input name="subject-name" type="text" placeholder="Nom de l'assignatura" class="border rounded px-3 py-2">
                    <input name="subject-start" type="date" class="border rounded px-3 py-2">
                    <input name="subject-end" type="date" class="border rounded px-3 py-2">
                    <button data-action="create-subject" data-container-id="create-subject-form" class="bg-blue-600 text-white rounded px-3 py-2">Crear assignatura</button>
                </div>
            </section>
            <div class="grid lg:grid-cols-3 gap-6">
                <div class="lg:col-span-1 space-y-4">
                    <h3 class="text-lg font-semibold text-gray-800">Assignatures</h3>
                    ${renderSubjectList(selectedSubjectId)}
                </div>
                <div class="lg:col-span-2 space-y-6">
                    ${selectedSubject ? `
                        ${renderSubjectGeneralInfo(selectedSubject)}
                        ${renderPeriodsSection(selectedSubject)}
                        ${renderHolidaysSection(selectedSubject)}
                        ${renderCompetenciesSection(selectedSubject)}
                        ${renderActivitiesSection(selectedSubject)}
                    ` : '<p class="text-gray-500">Selecciona una assignatura per gestionar-la.</p>'}
                </div>
            </div>
        </div>
    `;
}

function renderStudentsView() {
    return `
        <div class="p-6 space-y-6">
            <section class="bg-white rounded-lg shadow p-4 space-y-4">
                <h2 class="text-2xl font-bold text-gray-900">Alumnes</h2>
                <div id="create-student-form" class="grid md:grid-cols-2 gap-3">
                    <input name="student-name" type="text" placeholder="Nom i cognoms" class="border rounded px-3 py-2">
                    <textarea name="student-notes" rows="1" placeholder="Observacions" class="border rounded px-3 py-2"></textarea>
                    <button data-action="create-student" data-container-id="create-student-form" class="bg-blue-600 text-white rounded px-3 py-2 md:col-span-2">Afegir alumne</button>
                </div>
            </section>
            <section class="space-y-4">
                ${state.students.length === 0 ? '<p class="text-gray-500">Encara no hi ha alumnat registrat.</p>' : state.students.map(student => `
                    <article class="bg-white rounded-lg shadow p-4 space-y-3">
                        <div class="flex items-center justify-between">
                            <input type="text" value="${student.name}" data-action="update-student-field" data-field="name" data-student-id="${student.id}" class="text-lg font-semibold border rounded px-2 py-1">
                            <button data-action="delete-student" data-student-id="${student.id}" class="text-sm text-red-600 hover:underline">Esborrar</button>
                        </div>
                        <textarea data-action="update-student-field" data-field="notes" data-student-id="${student.id}" class="w-full border rounded px-3 py-2 text-sm" rows="2" placeholder="Observacions generals">${student.notes || ''}</textarea>
                        <div>
                            <h4 class="text-sm font-semibold text-gray-700 mb-2">Assignatures on participa</h4>
                            ${state.subjects.length === 0 ? '<p class="text-gray-500 text-sm">Primer cal crear assignatures.</p>' : `
                                <div class="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                                    ${state.subjects.map(subject => `
                                        <label class="flex items-center gap-2 text-sm bg-gray-50 border border-gray-200 rounded px-2 py-1">
                                            <input type="checkbox" data-action="toggle-student-subject" data-subject-id="${subject.id}" data-student-id="${student.id}" ${subject.studentIds?.includes(student.id) ? 'checked' : ''}>
                                            <span>${subject.name}</span>
                                        </label>
                                    `).join('')}
                                </div>
                            `}
                        </div>
                    </article>
                `).join('')}
            </section>
        </div>
    `;
}

function renderAssessmentTable(subject, activity, config) {
    const students = getStudentsForSubject(subject);
    const selectedCriteria = (activity.weights || []).map(weight => config.criteria.find(c => c.id === weight.criterionId)).filter(Boolean);
    const evaluationMode = state.settings.evaluationMode;

    if (students.length === 0 || selectedCriteria.length === 0) {
        return '<p class="text-gray-500 text-sm">Cal alumnat assignat i criteris vinculats a l'activitat per poder avaluar.</p>';
    }

    const header = `
        <tr>
            <th class="border px-3 py-2 text-left">Alumne</th>
            ${selectedCriteria.map(criterion => {
                const weight = activity.weights.find(w => w.criterionId === criterion.id);
                return `<th class="border px-3 py-2 text-left">${generateCriterionCode(config, criterion)}<br><span class="text-xs text-gray-500">${criterion.name} · Pes ${weight?.value ?? 0}</span></th>`;
            }).join('')}
        </tr>
    `;

    const rows = students.map(student => {
        const cells = selectedCriteria.map(criterion => {
            const weight = activity.weights.find(w => w.criterionId === criterion.id);
            const assessment = (subject.assessments?.[activity.id]?.[student.id] || {});
            const value = assessment[criterion.id] ?? '';
            if (evaluationMode === 'qualitative') {
                return `<td class="border px-2 py-1">
                    <select data-action="set-assessment" data-subject-id="${subject.id}" data-activity-id="${activity.id}" data-criterion-id="${criterion.id}" data-student-id="${student.id}" class="w-full border rounded px-2 py-1 text-sm">
                        <option value=""></option>
                        ${state.settings.qualitativeScale.map(option => `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`).join('')}
                    </select>
                </td>`;
            }
            return `<td class="border px-2 py-1">
                <input type="number" step="0.1" data-action="set-assessment" data-subject-id="${subject.id}" data-activity-id="${activity.id}" data-criterion-id="${criterion.id}" data-student-id="${student.id}" class="w-full border rounded px-2 py-1 text-sm" value="${value}">
            </td>`;
        }).join('');
        return `<tr><td class="border px-3 py-1 font-medium">${student.name}</td>${cells}</tr>`;
    }).join('');

    return `<div class="overflow-x-auto"><table class="min-w-full border text-sm">${header}${rows}</table></div>`;
}

function renderEvaluationView() {
    if (state.subjects.length === 0) {
        return `<div class="p-6"><p class="text-gray-500">Crea una assignatura per començar a avaluar.</p></div>`;
    }

    const selectedSubject = state.subjects.find(subject => subject.id === state.selectedEvaluationSubjectId) || state.subjects[0];
    if (!state.selectedEvaluationSubjectId && selectedSubject) {
        state.selectedEvaluationSubjectId = selectedSubject.id;
    }
    const config = selectedSubject ? ensureSharedConfig(selectedSubject) : null;
    const activities = config ? getActivities(config) : [];

    if (selectedSubject && !state.selectedEvaluationActivityId && activities.length > 0) {
        state.selectedEvaluationActivityId = activities[0].id;
    }

    const singleActivity = activities.find(activity => activity.id === state.selectedEvaluationActivityId);

    return `
        <div class="p-6 space-y-6">
            <section class="bg-white rounded-lg shadow p-4 space-y-4">
                <div class="flex flex-wrap gap-4 items-center justify-between">
                    <h2 class="text-2xl font-bold text-gray-900">Avaluació per criteris</h2>
                    <div class="flex gap-2 text-sm">
                        <button data-action="toggle-evaluation-view-mode" data-mode="single" class="px-3 py-1 rounded border ${state.evaluationViewMode === 'single' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300'}">Una activitat</button>
                        <button data-action="toggle-evaluation-view-mode" data-mode="multiple" class="px-3 py-1 rounded border ${state.evaluationViewMode === 'multiple' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300'}">Diverses activitats</button>
                    </div>
                </div>
                <div class="grid md:grid-cols-3 gap-4">
                    <label class="flex flex-col text-sm font-medium text-gray-700">
                        Assignatura
                        <select data-action="select-evaluation-subject" class="mt-1 border rounded px-3 py-2">
                            ${state.subjects.map(subject => `<option value="${subject.id}" ${subject.id === selectedSubject?.id ? 'selected' : ''}>${subject.name}</option>`).join('')}
                        </select>
                    </label>
                    <label class="flex flex-col text-sm font-medium text-gray-700">
                        Mode d'avaluació
                        <select data-action="set-settings-field" data-field="evaluationMode" class="mt-1 border rounded px-3 py-2">
                            <option value="numeric" ${state.settings.evaluationMode === 'numeric' ? 'selected' : ''}>Numèrica</option>
                            <option value="qualitative" ${state.settings.evaluationMode === 'qualitative' ? 'selected' : ''}>Qualitativa</option>
                        </select>
                    </label>
                    ${state.settings.evaluationMode === 'qualitative' ? `
                        <div class="text-sm">
                            <p class="font-medium text-gray-700">Valors qualitatius disponibles</p>
                            <div class="flex flex-wrap gap-2 mt-1">
                                ${state.settings.qualitativeScale.map(value => `
                                    <span class="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs">${value}
                                        <button data-action="remove-qualitative-value" data-value="${value}" class="text-blue-700">×</button>
                                    </span>
                                `).join('')}
                            </div>
                            <div class="flex gap-2 mt-2">
                                <input id="qualitative-new-value" type="text" class="border rounded px-2 py-1 flex-1" placeholder="Nou valor">
                                <button data-action="add-qualitative-value" data-input-id="qualitative-new-value" class="bg-blue-600 text-white px-3 py-1 rounded">Afegir</button>
                            </div>
                        </div>
                    ` : '<div></div>'}
                </div>
            </section>
            ${!selectedSubject ? '<p class="text-gray-500">Selecciona una assignatura per avaluar.</p>' : ''}
            ${selectedSubject && activities.length === 0 ? '<p class="text-gray-500">Aquesta assignatura encara no té activitats avaluables.</p>' : ''}
            ${selectedSubject && activities.length > 0 ? `
                ${state.evaluationViewMode === 'single' ? `
                    <section class="bg-white rounded-lg shadow p-4 space-y-4">
                        <div class="flex items-center justify-between">
                            <h3 class="text-xl font-semibold text-gray-800">${singleActivity ? singleActivity.name : 'Selecciona una activitat'}</h3>
                            <select data-action="select-evaluation-activity" class="border rounded px-3 py-2">
                                ${activities.map(activity => `<option value="${activity.id}" ${activity.id === singleActivity?.id ? 'selected' : ''}>${activity.name}</option>`).join('')}
                            </select>
                        </div>
                        ${singleActivity ? renderAssessmentTable(selectedSubject, singleActivity, config) : '<p class="text-gray-500 text-sm">Escull una activitat per avaluar.</p>'}
                    </section>
                ` : `
                    <div class="space-y-6">
                        ${activities.map(activity => `
                            <section class="bg-white rounded-lg shadow p-4 space-y-4">
                                <h3 class="text-xl font-semibold text-gray-800">${activity.name}</h3>
                                ${renderAssessmentTable(selectedSubject, activity, config)}
                            </section>
                        `).join('')}
                    </div>
                `}
            ` : ''}
        </div>
    `;
}

function renderAttendanceView() {
    if (state.subjects.length === 0) {
        return `<div class="p-6"><p class="text-gray-500">Crea una assignatura per poder gestionar l'assistència.</p></div>`;
    }
    const selectedSubject = state.subjects.find(subject => subject.id === state.selectedAttendanceSubjectId) || state.subjects[0];
    if (!state.selectedAttendanceSubjectId && selectedSubject) {
        state.selectedAttendanceSubjectId = selectedSubject.id;
    }
    const students = selectedSubject ? getStudentsForSubject(selectedSubject) : [];
    const date = state.selectedAttendanceDate;
    const dayRecord = (selectedSubject?.attendance?.[date]) || {};

    return `
        <div class="p-6 space-y-6">
            <section class="bg-white rounded-lg shadow p-4 space-y-4">
                <h2 class="text-2xl font-bold text-gray-900">Assistència i seguiment</h2>
                <div class="grid md:grid-cols-3 gap-4">
                    <label class="flex flex-col text-sm font-medium text-gray-700">
                        Assignatura
                        <select data-action="select-attendance-subject" class="mt-1 border rounded px-3 py-2">
                            ${state.subjects.map(subject => `<option value="${subject.id}" ${subject.id === selectedSubject?.id ? 'selected' : ''}>${subject.name}</option>`).join('')}
                        </select>
                    </label>
                    <label class="flex flex-col text-sm font-medium text-gray-700">
                        Data de la sessió
                        <input type="date" value="${date}" data-action="select-attendance-date" class="mt-1 border rounded px-3 py-2">
                    </label>
                </div>
            </section>
            <section class="bg-white rounded-lg shadow p-4 space-y-4">
                <h3 class="text-xl font-semibold text-gray-800">Registre diari</h3>
                ${students.length === 0 ? '<p class="text-gray-500">No hi ha alumnat assignat a aquesta assignatura.</p>' : `
                    <div class="overflow-x-auto">
                        <table class="min-w-full text-sm border">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="border px-3 py-2 text-left">Alumne</th>
                                    <th class="border px-3 py-2 text-left">Assistència</th>
                                    <th class="border px-3 py-2 text-left">Minuts de retard</th>
                                    <th class="border px-3 py-2 text-left">Actitud</th>
                                    <th class="border px-3 py-2 text-left">Comentaris</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${students.map(student => {
                                    const record = dayRecord[student.id] || {};
                                    return `
                                        <tr class="border-t">
                                            <td class="border px-3 py-2 font-medium">${student.name}</td>
                                            <td class="border px-2 py-2">
                                                <select data-action="update-attendance-field" data-field="status" data-subject-id="${selectedSubject.id}" data-student-id="${student.id}" class="w-full border rounded px-2 py-1">
                                                    <option value="present" ${record.status === 'present' ? 'selected' : ''}>Present</option>
                                                    <option value="late" ${record.status === 'late' ? 'selected' : ''}>Retard</option>
                                                    <option value="absent" ${record.status === 'absent' ? 'selected' : ''}>Falta</option>
                                                </select>
                                            </td>
                                            <td class="border px-2 py-2">
                                                <input type="number" min="0" data-action="update-attendance-field" data-field="minutes" data-subject-id="${selectedSubject.id}" data-student-id="${student.id}" value="${record.minutes ?? ''}" class="w-full border rounded px-2 py-1">
                                            </td>
                                            <td class="border px-2 py-2">
                                                <input type="text" data-action="update-attendance-field" data-field="attitude" data-subject-id="${selectedSubject.id}" data-student-id="${student.id}" value="${record.attitude ?? ''}" class="w-full border rounded px-2 py-1" placeholder="Positiva, neutra...">
                                            </td>
                                            <td class="border px-2 py-2">
                                                <textarea data-action="update-attendance-field" data-field="comment" data-subject-id="${selectedSubject.id}" data-student-id="${student.id}" class="w-full border rounded px-2 py-1" rows="2">${record.comment ?? ''}</textarea>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </section>
        </div>
    `;
}

function renderSettingsView() {
    return `
        <div class="p-6 space-y-6">
            <section class="bg-white rounded-lg shadow p-4 space-y-4">
                <h2 class="text-2xl font-bold text-gray-900">Configuració</h2>
                <div class="grid md:grid-cols-2 gap-4">
                    <label class="flex flex-col text-sm font-medium text-gray-700">
                        Text entre «CE» i el número
                        <input type="text" value="${state.settings.competencyCodeText}" data-action="set-settings-field" data-field="competencyCodeText" class="mt-1 border rounded px-3 py-2" placeholder="p. ex. '-' per obtenir CE-1">
                    </label>
                    <label class="flex flex-col text-sm font-medium text-gray-700">
                        Text entre «CA» i l'identificador
                        <input type="text" value="${state.settings.criterionCodeText}" data-action="set-settings-field" data-field="criterionCodeText" class="mt-1 border rounded px-3 py-2" placeholder="p. ex. '-' per obtenir CA-1.1">
                    </label>
                </div>
                <div class="text-sm text-gray-500">
                    <p>Aquests ajustos afecten totes les assignatures vinculades i defineixen com es mostren els codis de les competències i els criteris.</p>
                </div>
            </section>
        </div>
    `;
}

export function renderActiveView() {
    switch (state.activeView) {
        case 'subjects':
            return renderSubjectsView();
        case 'students':
            return renderStudentsView();
        case 'evaluation':
            return renderEvaluationView();
        case 'attendance':
            return renderAttendanceView();
        case 'settings':
            return renderSettingsView();
        default:
            return renderSubjectsView();
    }
}
