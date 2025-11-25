// views.js: Contiene todas las funciones que generan el HTML de las vistas.

import { state, LEARNING_ACTIVITY_STATUS, RUBRIC_LEVELS, calculateLearningActivityStatus, ensureEvaluationDraft, normalizeLearningActivityNumeric } from './state.js';
import { darkenColor, getWeekStartDate, getWeekDateRange, formatDate, isSameDate, findNextSession, findPreviousSession, DAY_KEYS, findNextClassSession, getCurrentTermDateRange, getWeeksForCourse, isHoliday, normalizeStudentAnnotation, STUDENT_ATTENDANCE_STATUS, getTermDateRangeById } from './utils.js';
import { t } from './i18n.js';
import { COMPETENCY_LEVEL_IDS, EVALUATION_MODALITIES, COMPETENCY_AGGREGATIONS, NP_TREATMENTS, NO_EVIDENCE_BEHAVIOR, calculateWeightedCompetencyResult, calculateMajorityCompetencyResult, validateCompetencyEvaluationConfig, validateNumericEvaluationConfig, normalizeEvaluationConfig, computeNumericEvidence } from './evaluation.js';

const sortStudentsByName = (studentA, studentB) => studentA.name.localeCompare(studentB.name);

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttribute = (value = '') => escapeHtml(value).replace(/\n/g, '&#10;');

function getRubricNumericValue(entry) {
    if (entry && typeof entry === 'object') {
        if (entry.mode === 'numeric' && typeof entry.value !== 'undefined') {
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
        const parsed = Number(entry.replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
}

function formatDecimal(value, locale, { minimumFractionDigits = 0, maximumFractionDigits = 2, useGrouping = false } = {}) {
    if (!Number.isFinite(value)) {
        return '';
    }
    try {
        return Number(value).toLocaleString(locale || 'ca', {
            minimumFractionDigits,
            maximumFractionDigits,
            useGrouping,
        });
    } catch (error) {
        const digits = Math.max(minimumFractionDigits, maximumFractionDigits);
        return Number(value).toFixed(digits);
    }
}

function renderMobileHeaderActions(actions) {
    const container = document.getElementById('mobile-header-actions');
    if (!container) return;
    
    if (actions.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    const buttonsHtml = actions.map(action => {
        if(action.action === 'import-data-mobile') {
            return `
                <label for="import-file-input-mobile" data-action="import-data-mobile" class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 cursor-pointer">
                    <i data-lucide="${action.icon}" class="w-4 h-4"></i>
                    <span>${action.label}</span>
                </label>
                <input type="file" id="import-file-input-mobile" accept=".json" class="hidden"/>
            `;
        }
        return `<button data-action="${action.action}" class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2">
            <i data-lucide="${action.icon}" class="w-4 h-4"></i>
            <span>${action.label}</span>
        </button>`
    }
    ).join('');

    container.innerHTML = `
        <button id="mobile-actions-menu-btn" class="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
            <i data-lucide="more-vertical" class="w-5 h-5"></i>
        </button>
        <div id="mobile-actions-menu" class="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 z-30 hidden border dark:border-gray-700">
            ${buttonsHtml}
        </div>
    `;
    lucide.createIcons();
    
    const mobileActionsBtn = document.getElementById('mobile-actions-menu-btn');
    const mobileActionsMenu = document.getElementById('mobile-actions-menu');

    if (mobileActionsBtn && mobileActionsMenu) {
        mobileActionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mobileActionsMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!mobileActionsMenu.contains(e.target) && !mobileActionsBtn.contains(e.target)) {
                mobileActionsMenu.classList.add('hidden');
            }
        });
    }
}

export function renderScheduleView() {
    const days = DAY_KEYS.map(dayKey => t(dayKey.toLowerCase()));
    const getActivityById = (id) => state.activities.find(c => c.id === id);
    const startOfWeek = getWeekStartDate(state.currentDate);
    const today = new Date();
    const termRange = getCurrentTermDateRange();

    renderMobileHeaderActions([
        { action: 'export-data', label: t('save_file'), icon: 'save' },
        { action: 'import-data-mobile', label: t('open_file'), icon: 'folder-open' },
        { action: 'print-schedule', label: t('print'), icon: 'printer' }
    ]);
    
    const headerCells = days.map((dayName, dayIndex) => {
        const cellDate = new Date(startOfWeek);
        cellDate.setDate(startOfWeek.getDate() + dayIndex);
        const isToday = isSameDate(cellDate, today);
        const formattedDate = cellDate.toLocaleDateString(document.documentElement.lang, { day: '2-digit', month: '2-digit' });
        return `<th class="p-2 border border-gray-200 dark:border-gray-700 ${isToday ? 'bg-blue-100 dark:bg-blue-900/50' : ''}">
                    <div class="hidden sm:block">${dayName}</div>
                    <div class="sm:hidden">${dayName.substring(0,3)}</div>
                    <div class="text-xs font-normal text-gray-500 dark:text-gray-400">${formattedDate}</div>
                </th>`;
    }).join('');

    const tableRows = state.timeSlots.map(time => {
        const cells = DAY_KEYS.map((dayKey, dayIndex) => {
            const cellDate = new Date(startOfWeek);
            cellDate.setDate(startOfWeek.getDate() + dayIndex);
            const formattedCellDate = formatDate(cellDate);
            const isToday = isSameDate(cellDate, today);

            const holiday = isHoliday(cellDate);
            if (holiday) {
                return `<td class="p-1 border border-gray-200 dark:border-gray-700 bg-gray-200 dark:bg-gray-700">
                            <div class="p-2 h-full min-h-[40px] text-xs text-center text-gray-500 dark:text-gray-400 flex items-center justify-center">${holiday.name}</div>
                        </td>`;
            }

            let activityId = state.schedule[`${dayKey}-${time.label}`];

            const applicableOverride = state.scheduleOverrides.find(ov => {
                if (ov.day === dayKey && ov.time === time.label) {
                    const overrideStart = new Date(ov.startDate + 'T00:00:00');
                    const overrideEnd = new Date(ov.endDate + 'T23:59:59');
                    return cellDate >= overrideStart && cellDate <= overrideEnd;
                }
                return false;
            });

            if (applicableOverride) {
                activityId = applicableOverride.activityId;
            }
            
            const activityInfo = activityId ? getActivityById(activityId) : null;
            let cellContent = `<div class="p-2 h-full min-h-[40px]"></div>`;
            
            if (activityInfo) {
                const activityStartDate = activityInfo.startDate ? new Date(activityInfo.startDate + 'T00:00:00') : (termRange ? termRange.start : null);
                const activityEndDate = activityInfo.endDate ? new Date(activityInfo.endDate + 'T23:59:59') : (termRange ? termRange.end : null);

                let inDateRange = true;
                if(termRange) {
                    if (cellDate < termRange.start || cellDate > termRange.end) inDateRange = false;
                }
                if (activityStartDate && cellDate < activityStartDate) inDateRange = false;
                if (activityEndDate && cellDate > activityEndDate) inDateRange = false;

                if (inDateRange) {
                    const entryId = `${activityInfo.id}_${formattedCellDate}`;
                    const hasPlan = state.classEntries[entryId] && state.classEntries[entryId].planned;
                    const planIndicator = hasPlan ? `<span class="absolute top-1 right-1 text-xs">📝</span>` : '';

                    const style = `background-color: ${activityInfo.color}; color: ${darkenColor(activityInfo.color, 40)}; border: 1px solid ${darkenColor(activityInfo.color, 10)}`;
                    if (activityInfo.type === 'class') {
                        cellContent = `<button data-action="select-activity" data-activity-id='${activityInfo.id}' data-day='${dayKey}' data-time='${time.label}' data-date='${formattedCellDate}' class="relative w-full h-full p-2 rounded-md transition-colors text-sm font-semibold" style="${style}">${activityInfo.name}${planIndicator}</button>`;
                    } else {
                        cellContent = `<div class="w-full h-full p-2 rounded-md text-sm font-semibold flex items-center justify-center" style="${style}">${activityInfo.name}</div>`;
                    }
                }
            }
            return `<td class="p-1 border border-gray-200 dark:border-gray-700 ${isToday ? 'bg-blue-50 dark:bg-blue-900/20' : ''}">${cellContent}</td>`;
        }).join('');
        return `<tr><td class="p-2 border border-gray-200 dark:border-gray-700 font-mono bg-gray-50 dark:bg-gray-800 text-sm">${time.label}</td>${cells}</tr>`;
    }).join('');
    
    const formatDateForDisplay = (dateStr) => {
        if (!dateStr) return '';
        const dateObj = new Date(dateStr + 'T00:00:00');
        return dateObj.toLocaleDateString(document.documentElement.lang, { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    let allTermsDateRange = '';
    if (state.courseStartDate && state.courseEndDate) {
        const start = formatDateForDisplay(state.courseStartDate);
        const end = formatDateForDisplay(state.courseEndDate);
        allTermsDateRange = ` (${start} - ${end})`;
    }
    const allTermsOption = `<option value="all" ${state.selectedTermId === 'all' ? 'selected' : ''}>${t('view_all_terms')}${allTermsDateRange}</option>`;

    const termOptions = state.terms.map(term => {
        const start = formatDateForDisplay(term.startDate);
        const end = formatDateForDisplay(term.endDate);
        const dateRange = ` (${start} - ${end})`;
        return `<option value="${term.id}" ${state.selectedTermId === term.id ? 'selected' : ''}>${term.name}${dateRange}</option>`;
    }).join('');

    const courseWeeks = getWeeksForCourse();
    const weeksListHtml = courseWeeks.length > 0
        ? courseWeeks.map(week =>
            `<button
                data-action="go-to-week"
                data-date="${week.date}"
                class="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >${week.text}</button>`
        ).join('')
        : `<div class="px-4 py-2 text-sm text-gray-500">${t('course_dates_not_set')}</div>`;

    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full">
            <div class="hidden sm:flex justify-between items-center mb-6 no-print">
                 <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200">${t('schedule_view_title')}</h2>
                 <div class="flex items-center gap-2">
                    <button data-action="export-data" class="bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 flex items-center gap-2">
                        <i data-lucide="save" class="w-5 h-5"></i> <span>${t('save_file')}</span>
                    </button>
                    <label class="bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 flex items-center gap-2 cursor-pointer">
                        <i data-lucide="folder-open" class="w-5 h-5"></i> <span>${t('open_file')}</span>
                        <input type="file" id="import-file-input" accept=".json" class="hidden"/>
                    </label>
                    <button data-action="print-schedule" class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2">
                        <i data-lucide="printer" class="w-5 h-5"></i> ${t('print')}
                    </button>
                 </div>
            </div>
             <div class="flex justify-between items-center mb-4">
                <div class="flex items-center gap-4">
                    <button data-action="prev-week" class="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"><i data-lucide="chevron-left"></i></button>
                    <div class="relative">
                        <button id="week-selector-btn" data-action="toggle-week-selector" class="font-semibold text-center text-lg p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
                            ${getWeekDateRange(state.currentDate)}
                        </button>
                        <div id="week-selector-menu" class="absolute left-1/2 -translate-x-1/2 mt-2 w-64 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 z-30 hidden border dark:border-gray-700 max-h-80 overflow-y-auto">
                            ${weeksListHtml}
                        </div>
                    </div>
                    <button data-action="next-week" class="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"><i data-lucide="chevron-right"></i></button>
                </div>
                <div class="flex items-center gap-2">
                    <select data-action="select-term" class="p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md shadow-sm">
                        ${allTermsOption}
                        ${termOptions}
                    </select>
                    <button data-action="today" class="bg-gray-600 text-white px-3 py-2 text-sm rounded-md hover:bg-gray-700">${t('today')}</button>
                </div>
            </div>
            <div id="printable-schedule" class="printable-area">
                <h2 class="text-2xl font-bold text-gray-800 mb-6 hidden print:block text-center">${t('schedule_view_title')} - ${getWeekDateRange(state.currentDate)}</h2>
                <div class="bg-white dark:bg-gray-800 p-0 sm:p-4 rounded-lg shadow-md overflow-x-auto">
                    <table class="w-full border-collapse text-center">
                        <thead><tr class="bg-gray-100 dark:bg-gray-900"><th class="p-2 border border-gray-200 dark:border-gray-700 w-24">${t('hour')}</th>${headerCells}</tr></thead>
                        <tbody>${tableRows.length > 0 ? tableRows : `<tr><td colspan="6" class="p-4 text-gray-500 dark:text-gray-400">${t('add_timeslots_in_settings')}</td></tr>`}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
}

export function renderClassesView() {
    renderMobileHeaderActions([]);
    const classes = state.activities.filter(a => a.type === 'class' && !a.isTemplate).sort((a, b) => a.name.localeCompare(b.name));

    if (classes.length === 0) {
        return `<div class="p-4 sm:p-6"><h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-6">${t('classes_view_title')}</h2><p class="text-gray-500 dark:text-gray-400">${t('no_classes_created')}</p></div>`;
    }

    const selectOptions = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    const classesHtml = classes.map(c => {
        const studentsOfClass = state.students
            .filter(s => c.studentIds?.includes(s.id))
            .sort(sortStudentsByName);
        
        const studentsHtml = studentsOfClass.map(s => `
            <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-700 rounded-md">
                <button data-action="select-student" data-student-id="${s.id}" class="text-left font-medium text-blue-600 dark:text-blue-400 hover:underline flex-grow">${s.name}</button>
                <button data-action="remove-student-from-class" data-activity-id="${c.id}" data-student-id="${s.id}" class="text-red-500 hover:text-red-700 ml-4 flex-shrink-0"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>
        `).join('');

        const formattedStartDate = c.startDate ? new Date(c.startDate + 'T00:00:00').toLocaleDateString(document.documentElement.lang) : 'N/A';
        const formattedEndDate = c.endDate ? new Date(c.endDate + 'T00:00:00').toLocaleDateString(document.documentElement.lang) : 'N/A';

        return `
        <div id="class-card-${c.id}" class="bg-white dark:bg-gray-800 rounded-lg shadow-md flex flex-col">
            <button data-action="go-to-class-session" data-activity-id="${c.id}" class="p-4 text-left w-full bg-gray-50 dark:bg-gray-700/50 rounded-t-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <h3 class="text-xl font-bold" style="color: ${darkenColor(c.color, 40)}">${c.name}</h3>
                <div class="text-sm text-gray-600 dark:text-gray-400 mt-2 space-y-1">
                    <div class="flex items-center gap-2">
                        <i data-lucide="users" class="w-4 h-4"></i>
                        <span>${c.studentIds?.length || 0} ${t('students_in_this_class')}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <i data-lucide="calendar" class="w-4 h-4"></i>
                        <span>${formattedStartDate} - ${formattedEndDate}</span>
                    </div>
                </div>
            </button>
            <div class="p-4 flex-grow">
                <div class="space-y-2 mb-4 max-h-48 overflow-y-auto">
                    ${studentsHtml || `<p class="text-sm text-gray-500 dark:text-gray-400">${t('no_students_in_class')}</p>`}
                </div>
                <div class="flex flex-col sm:flex-row gap-2 border-t border-gray-200 dark:border-gray-700 pt-4">
                    <input type="text" id="new-student-name-${c.id}" placeholder="${t('add_student_placeholder')}" class="flex-grow p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                    <button data-action="add-student-to-class" data-activity-id="${c.id}" class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex-shrink-0 flex items-center justify-center gap-2"><i data-lucide="plus" class="w-5 h-5 sm:hidden"></i><span class="hidden sm:inline">${t('add')}</span></button>
                </div>
            </div>
        </div>
        `;
    }).join('');

    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full">
            <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-6 gap-4">
                <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200">${t('classes_view_title')}</h2>
                <div class="flex-shrink-0 w-full sm:w-64">
                    <label for="class-quick-nav" class="sr-only">${t('quick_nav_to_class')}</label>
                    <select id="class-quick-nav" data-action="go-to-class-card" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md shadow-sm">
                        <option value="">${t('quick_nav_to_class')}</option>
                        ${selectOptions}
                    </select>
                </div>
            </div>
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                ${classesHtml}
            </div>
        </div>
    `;
}

export function renderActivitiesView() {
    renderMobileHeaderActions([]);
    const classes = state.activities.filter(a => a.type === 'class').sort((a, b) => a.name.localeCompare(b.name));
    const templateMap = new Map(classes.filter(cls => cls.isTemplate).map(cls => [cls.id, cls]));

    const locale = document.documentElement.lang || 'ca';
    const formatDateForDisplay = (isoString) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    if (classes.length === 0) {
        return `
            <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full">
                <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-4">${t('activities_view_title')}</h2>
                <p class="text-gray-500 dark:text-gray-400">${t('no_classes_created')}</p>
            </div>
        `;
    }

    const selectOptions = classes.map(c => `<option value="${c.id}">${c.name}${c.isTemplate ? ` (${t('template_group_badge')})` : ''}</option>`).join('');

    const cardsHtml = classes.map(c => {
        const classActivities = state.learningActivities
            .filter(activity => activity.classId === c.id)
            .sort((a, b) => {
                const dateA = new Date(a.createdAt || 0);
                const dateB = new Date(b.createdAt || 0);
                return dateB - dateA;
            });

        const isExpanded = state.expandedLearningActivityClassIds?.includes(c.id);
        const visibleActivities = isExpanded ? classActivities : classActivities.slice(0, 3);
        const isTemplate = Boolean(c.isTemplate);
        const parentTemplate = !isTemplate ? templateMap.get(c.templateId) : null;
        const badgeHtml = isTemplate
            ? `<span class="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 px-2 py-1 rounded-full">${t('template_group_badge')}</span>`
            : '';
        const templateInfo = isTemplate
            ? `<p class="text-xs text-blue-600 dark:text-blue-300 mt-1">${t('template_group_template_notice')}</p>`
            : parentTemplate
                ? `<p class="text-xs text-gray-600 dark:text-gray-400 mt-1">${t('template_group_label')}: <span class="font-semibold">${parentTemplate.name}</span> · ${t('template_group_inherited_notice')}</p>`
                : '';

        const statusMeta = {
            [LEARNING_ACTIVITY_STATUS.SCHEDULED]: {
                label: t('learning_activity_status_scheduled'),
                classes: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700/40 dark:text-gray-200 dark:border-gray-600'
            },
            [LEARNING_ACTIVITY_STATUS.OPEN_SUBMISSIONS]: {
                label: t('learning_activity_status_open'),
                classes: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-200 dark:border-green-700'
            },
            [LEARNING_ACTIVITY_STATUS.PENDING_REVIEW]: {
                label: t('learning_activity_status_pending'),
                classes: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700'
            },
            [LEARNING_ACTIVITY_STATUS.CORRECTED]: {
                label: t('learning_activity_status_corrected'),
                classes: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700'
            }
        };

        const activitiesHtml = visibleActivities.map(activity => {
            const assignedCount = Array.isArray(activity.criteriaRefs) ? activity.criteriaRefs.length : 0;
            const assignedLabelContent = assignedCount > 0
                ? `${assignedCount} ${t('activities_assigned_criteria_label')}`
                : `<span class="inline-flex items-center gap-1"><i data-lucide="crosshair" class="w-3 h-3"></i>${t('activities_assigned_criteria_none')}</span>`;
            const startDateDisplay = formatDateForDisplay(activity.startDate);
            const endDateDisplay = formatDateForDisplay(activity.endDate);
            const dateRangeHtml = (startDateDisplay || endDateDisplay)
                ? `<div class="mt-3 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2"><i data-lucide="calendar-range" class="w-4 h-4"></i><span>${[startDateDisplay, endDateDisplay].filter(Boolean).join(' · ')}</span></div>`
                : '';
            const status = calculateLearningActivityStatus(activity);
            activity.status = status;
            const statusInfo = statusMeta[status] || statusMeta[LEARNING_ACTIVITY_STATUS.SCHEDULED];
            const inheritedBadge = activity.templateSourceId
                ? `<span class="inline-flex items-center gap-2 px-2 py-1 text-xs font-semibold text-purple-600 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 rounded-full">${t('activities_inherited_badge')}</span>`
                : '';

            return `
                <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white/60 dark:bg-gray-800/60 shadow-sm">
                    <div
                        data-action="open-learning-activity-editor"
                        data-class-id="${c.id}"
                        data-learning-activity-id="${activity.id}"
                        role="button"
                        tabindex="0"
                        class="block cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-600 rounded-md"
                    >
                        <div class="flex items-start justify-between gap-3">
                            <span class="font-semibold text-gray-800 dark:text-gray-100">${activity.title?.trim() || t('activities_untitled_label')}</span>
                            <span class="text-xs text-blue-600 dark:text-blue-400">${assignedLabelContent}</span>
                        </div>
                        ${dateRangeHtml}
                    </div>
                    <div class="mt-3 flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                            <span class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusInfo.classes}">
                                ${statusInfo.label}
                            </span>
                            ${inheritedBadge}
                        </div>
                        <button
                            data-action="open-learning-activity-rubric"
                            data-class-id="${c.id}"
                            data-learning-activity-id="${activity.id}"
                            class="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 dark:text-blue-200 dark:bg-blue-900/30 dark:border-blue-700"
                        >
                            <i data-lucide="table-properties" class="w-3.5 h-3.5"></i>
                            ${t('activities_rubric_button_label')}
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        const toggleButton = classActivities.length > 3
            ? `
                <button data-action="toggle-learning-activity-list" data-class-id="${c.id}" class="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                    <i data-lucide="${isExpanded ? 'circle-minus' : 'circle-plus'}" class="w-4 h-4"></i>
                    <span>${isExpanded ? t('activities_show_less') : t('activities_show_all')}</span>
                </button>
            `
            : '';

        return `
            <div id="activities-card-${c.id}" class="bg-white dark:bg-gray-800 rounded-lg shadow-md flex flex-col">
                <div class="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-t-lg">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1">
                            <div class="flex items-center gap-2">
                                <h3 class="text-xl font-bold" style="color: ${darkenColor(c.color, 40)}">${c.name}</h3>
                                ${badgeHtml}
                            </div>
                            ${templateInfo}
                            <p class="text-sm text-gray-600 dark:text-gray-400 mt-2 flex items-center gap-2">
                                <i data-lucide="list" class="w-4 h-4"></i>
                                <span>${classActivities.length} ${t('activities_total_label')}</span>
                            </p>
                        </div>
                    </div>
                </div>
                <div class="p-4 flex flex-col gap-4 flex-grow">
                    <div class="flex justify-end">
                        <button data-action="open-learning-activity-editor" data-class-id="${c.id}" class="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
                            <i data-lucide="file-plus-2" class="w-4 h-4"></i>
                            <span>${t('activities_new_button_label')}</span>
                        </button>
                    </div>
                    <div class="space-y-3">
                        ${activitiesHtml || `<p class=\"text-sm text-gray-500 dark:text-gray-400\">${t('activities_view_empty')}</p>`}
                    </div>
                    ${toggleButton ? `<div class="border-t border-gray-200 dark:border-gray-700 pt-3">${toggleButton}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full">
            <div class="flex flex-col sm:flex-row justify-between sm:items-stretch gap-4 mb-6">
                <div class="flex-1">
                    <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200">${t('activities_view_title')}</h2>
                    <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">${t('activities_view_description')}</p>
                </div>
                <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 w-full sm:w-80">
                    <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                        <i data-lucide="rocket" class="w-4 h-4"></i>
                        ${t('activities_quick_create_title')}
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${t('activities_quick_create_hint')}</p>
                    <div class="mt-3 flex gap-2">
                        <select id="activities-quick-nav" class="flex-1 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                            <option value="">${t('activities_quick_select_placeholder')}</option>
                            ${selectOptions}
                        </select>
                        <button data-action="open-learning-activity-quick" class="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center">
                            <i data-lucide="file-plus-2" class="w-5 h-5"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
                ${cardsHtml}
            </div>
        </div>
    `;
}

export function renderEvaluationView() {
    renderMobileHeaderActions([]);

    const classes = state.activities
        .filter(activity => activity.type === 'class' && !activity.isTemplate)
        .sort((a, b) => a.name.localeCompare(b.name));

    const availableTermIds = new Set((state.terms || []).map(term => term.id));
    if (state.evaluationSelectedTermId !== 'all' && !availableTermIds.has(state.evaluationSelectedTermId)) {
        state.evaluationSelectedTermId = 'all';
    }

    const tabs = [
        { id: 'activities', label: t('evaluation_tab_activities'), icon: 'clipboard-list' },
        { id: 'grades', label: t('evaluation_tab_grades'), icon: 'graduation-cap' },
        { id: 'term-grades', label: t('evaluation_tab_term_grades'), icon: 'table' }
    ];
    const allowedTabs = tabs.map(tab => tab.id);
    if (!allowedTabs.includes(state.evaluationActiveTab)) {
        state.evaluationActiveTab = 'activities';
    }

    if (state.evaluationActiveTab === 'grades' || state.evaluationActiveTab === 'term-grades') {
        const hasSelection = classes.some(cls => cls.id === state.selectedEvaluationClassId);
        if (!hasSelection) {
            state.selectedEvaluationClassId = classes[0]?.id || null;
        }
    } else if (classes.length === 0) {
        state.selectedEvaluationClassId = null;
    }

    const tabButtonsHtml = tabs.map(tab => {
        const isActive = state.evaluationActiveTab === tab.id;
        const baseClasses = 'inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors';
        const activeClasses = 'bg-blue-600 text-white shadow-sm';
        const inactiveClasses = 'text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700';
        return `<button data-action="set-evaluation-tab" data-tab="${tab.id}" class="${baseClasses} ${isActive ? activeClasses : inactiveClasses}"><i data-lucide="${tab.icon}" class="w-4 h-4"></i><span>${escapeHtml(tab.label)}</span></button>`;
    }).join('');

    const tabContent = state.evaluationActiveTab === 'grades'
        ? renderEvaluationGradesTab(classes)
        : state.evaluationActiveTab === 'term-grades'
            ? renderEvaluationTermGradesTab(classes)
            : renderEvaluationActivitiesTab(classes);

    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full space-y-6">
            <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200">${t('evaluation_view_title')}</h2>
            <div class="flex flex-wrap gap-2">${tabButtonsHtml}</div>
            ${tabContent}
        </div>
    `;
}

function getActivitySortOrder(entry) {
    const candidates = [entry?.endDate, entry?.startDate, entry?.createdAt];
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (candidate instanceof Date) {
            const timestamp = candidate.getTime();
            if (!Number.isNaN(timestamp)) {
                return timestamp;
            }
            continue;
        }
        if (typeof candidate === 'number') {
            if (!Number.isNaN(candidate)) {
                return candidate;
            }
            continue;
        }
        const candidateStr = String(candidate);
        const normalized = candidateStr.includes('T') ? candidateStr : `${candidateStr}T00:00:00`;
        const date = new Date(normalized);
        if (!Number.isNaN(date.getTime())) {
            return date.getTime();
        }
    }
    return Number.MAX_SAFE_INTEGER;
}

function renderEvaluationActivitiesTab(classes) {
    const locale = document.documentElement.lang || 'ca';
    const formatDateForDisplay = (value) => {
        if (!value) return '';
        const normalized = value.includes('T') ? value : `${value}T00:00:00`;
        const date = new Date(normalized);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const selectedTermId = state.evaluationSelectedTermId || 'all';
    const termRange = getTermDateRangeById(selectedTermId);
    const filterBySelectedTerm = (activity) => {
        if (!termRange) {
            return true;
        }
        const start = activity.startDate ? new Date(`${activity.startDate}T00:00:00`) : null;
        const end = activity.endDate ? new Date(`${activity.endDate}T23:59:59`) : null;
        if (start && end) {
            return end >= termRange.start && start <= termRange.end;
        }
        if (start) {
            return start >= termRange.start && start <= termRange.end;
        }
        if (end) {
            return end >= termRange.start && end <= termRange.end;
        }
        return true;
    };

    if (classes.length === 0) {
        return `
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
                <p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_no_classes')}</p>
            </div>
        `;
    }

    const statusPriority = [
        LEARNING_ACTIVITY_STATUS.PENDING_REVIEW,
        LEARNING_ACTIVITY_STATUS.OPEN_SUBMISSIONS,
        LEARNING_ACTIVITY_STATUS.SCHEDULED
    ];

    const statusMeta = {
        [LEARNING_ACTIVITY_STATUS.PENDING_REVIEW]: {
            label: t('learning_activity_status_pending'),
            badgeClasses: 'bg-amber-500/10 text-amber-600 border border-amber-200 dark:text-amber-200 dark:border-amber-600 dark:bg-amber-900/30'
        },
        [LEARNING_ACTIVITY_STATUS.OPEN_SUBMISSIONS]: {
            label: t('learning_activity_status_open'),
            badgeClasses: 'bg-emerald-500/10 text-emerald-600 border border-emerald-200 dark:text-emerald-200 dark:border-emerald-600 dark:bg-emerald-900/30'
        },
        [LEARNING_ACTIVITY_STATUS.SCHEDULED]: {
            label: t('evaluation_status_not_started'),
            badgeClasses: 'bg-gray-500/10 text-gray-600 border border-gray-200 dark:text-gray-300 dark:border-gray-700 dark:bg-gray-800/60'
        },
        [LEARNING_ACTIVITY_STATUS.CORRECTED]: {
            label: t('learning_activity_status_corrected'),
            badgeClasses: 'bg-emerald-500/10 text-emerald-600 border border-emerald-200 dark:text-emerald-200 dark:border-emerald-600 dark:bg-emerald-900/30'
        }
    };

    const classCards = classes.map(cls => {
        const classActivities = state.learningActivities
            .filter(activity => activity.classId === cls.id)
            .filter(filterBySelectedTerm)
            .map(activity => {
                const status = calculateLearningActivityStatus(activity);
                return {
                    ...activity,
                    status,
                    startDisplay: formatDateForDisplay(activity.startDate),
                    endDisplay: formatDateForDisplay(activity.endDate),
                    description: activity.description?.trim() || ''
                };
            })
            .filter(activity => statusPriority.includes(activity.status));

        const activitiesByStatus = statusPriority.map(status => {
            const items = classActivities
                .filter(activity => activity.status === status)
                .sort((a, b) => getActivitySortOrder(a) - getActivitySortOrder(b));
            return { status, items };
        });

        const pendingCount = activitiesByStatus.reduce((acc, entry) => acc + entry.items.length, 0);
        const rawPendingLabel = t('evaluation_class_pending_count');
        const pendingLabel = rawPendingLabel.startsWith('[')
            ? String(pendingCount)
            : rawPendingLabel.replace('{{count}}', pendingCount);

        const sectionsHtml = activitiesByStatus
            .filter(entry => entry.items.length > 0)
            .map(entry => {
                const meta = statusMeta[entry.status] || statusMeta[LEARNING_ACTIVITY_STATUS.SCHEDULED];
                const activitiesHtml = entry.items.map(activity => {
                    const dateParts = [];
                    if (activity.startDisplay) {
                        dateParts.push(`${t('start_date')}: ${escapeHtml(activity.startDisplay)}`);
                    }
                    if (activity.endDisplay) {
                        dateParts.push(`${t('end_date')}: ${escapeHtml(activity.endDisplay)}`);
                    }
                    const dateInfo = dateParts.length > 0
                        ? `<div class="mt-3 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">${dateParts.map(part => `<span>${part}</span>`).join('')}</div>`
                        : '';
                    const descriptionHtml = activity.description
                        ? `<p class="mt-2 text-sm text-gray-600 dark:text-gray-300">${escapeHtml(activity.description)}</p>`
                        : '';

                    const rawActivityTitle = activity.title?.trim() || t('activities_untitled_label');
                    const activityTitle = escapeHtml(rawActivityTitle);
                    const labelTemplate = t('evaluation_open_activity_assessment');
                    const accessibleLabel = labelTemplate.startsWith('[')
                        ? activityTitle
                        : escapeHtml(labelTemplate.replace('{{title}}', rawActivityTitle));

                    return `
                        <button
                            type="button"
                            data-action="open-learning-activity-rubric"
                            data-learning-activity-id="${activity.id}"
                            data-evaluation-activity-id="${activity.id}"
                            class="block w-full text-left p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white/80 dark:bg-gray-800/70 shadow-sm hover:border-blue-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-400/60 dark:hover:border-blue-500 dark:focus:ring-blue-500/60 transition-colors"
                            aria-label="${accessibleLabel}"
                        >
                            <div class="flex items-start justify-between gap-3">
                                <h5 class="text-base font-semibold text-gray-800 dark:text-gray-100">${activityTitle}</h5>
                                <span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${meta.badgeClasses}">${escapeHtml(meta.label)}</span>
                            </div>
                            ${descriptionHtml}
                            ${dateInfo}
                        </button>
                    `;
                }).join('');

                return `
                    <section class="space-y-3">
                        <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide">${escapeHtml(meta.label)}</h4>
                        <div class="space-y-3">${activitiesHtml}</div>
                    </section>
                `;
            }).join('');

        const emptyMessage = `<p class="text-sm text-gray-500 dark:text-gray-400">${t('evaluation_class_no_pending')}</p>`;

        return `
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-4 sm:p-6 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-100">${escapeHtml(cls.name)}</h3>
                    <span class="text-sm text-gray-500 dark:text-gray-400">${escapeHtml(pendingLabel)}</span>
                </div>
                ${sectionsHtml || emptyMessage}
            </div>
        `;
    }).join('');

    return `<div class="space-y-6">${classCards}</div>`;
}

function buildEvaluationClassSelection(classes) {
    let selectedClass = classes.find(cls => cls.id === state.selectedEvaluationClassId) || null;
    if (!selectedClass) {
        selectedClass = classes[0] || null;
        if (selectedClass) {
            state.selectedEvaluationClassId = selectedClass.id;
        }
    }

    const classButtonsHtml = classes.map(cls => {
        const isActive = selectedClass && cls.id === selectedClass.id;
        const baseClasses = 'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors';
        const activeClasses = 'bg-blue-600 text-white border-blue-600 shadow-sm';
        const inactiveClasses = 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700';
        return `<button data-action="select-evaluation-class" data-class-id="${cls.id}" class="${baseClasses} ${isActive ? activeClasses : inactiveClasses}">${escapeHtml(cls.name)}</button>`;
    }).join('');

    return { selectedClass, classButtonsHtml };
}

function buildEvaluationTermFilter(selectedTermId) {
    const locale = document.documentElement.lang || 'ca';
    const formatDateForDisplay = (value) => {
        if (!value) return '';
        const normalized = value.includes('T') ? value : `${value}T00:00:00`;
        const date = new Date(normalized);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const termRange = getTermDateRangeById(selectedTermId);
    const hasTerms = Array.isArray(state.terms) && state.terms.length > 0;
    const termOptionsHtml = hasTerms
        ? state.terms.map(term => {
            const start = formatDateForDisplay(term.startDate);
            const end = formatDateForDisplay(term.endDate);
            const range = start && end ? ` (${start} - ${end})` : '';
            const isSelected = term.id === selectedTermId;
            return `<option value="${term.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(`${term.name}${range}`)}</option>`;
        }).join('')
        : '';

    const termFilterHtml = hasTerms
        ? `
            <div class="w-full sm:w-auto">
                <label for="evaluation-term-filter" class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('evaluation_term_filter_label')}</label>
                <select id="evaluation-term-filter" data-action="select-evaluation-term" class="w-full sm:w-64 p-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md text-sm text-gray-700 dark:text-gray-200">
                    <option value="all" ${selectedTermId === 'all' ? 'selected' : ''}>${t('view_all_terms')}</option>
                    ${termOptionsHtml}
                </select>
            </div>
        `
        : '';

    return { termFilterHtml, termRange };
}

function renderEvaluationGradesTab(classes) {
    if (classes.length === 0) {
        return `
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
                <p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_no_classes')}</p>
            </div>
        `;
    }

    const { selectedClass, classButtonsHtml } = buildEvaluationClassSelection(classes);
    const selectedTermId = state.evaluationSelectedTermId || 'all';
    const { termFilterHtml, termRange } = buildEvaluationTermFilter(selectedTermId);
    const locale = document.documentElement.lang || 'ca';
    const classEvaluationConfig = normalizeEvaluationConfig(state.evaluationSettings?.[selectedClass?.id]);

    const filterBySelectedTerm = (activity) => {
        if (!termRange) {
            return true;
        }
        const start = activity.startDate ? new Date(`${activity.startDate}T00:00:00`) : null;
        const end = activity.endDate ? new Date(`${activity.endDate}T23:59:59`) : null;
        if (start && end) {
            return end >= termRange.start && start <= termRange.end;
        }
        if (start) {
            return start >= termRange.start && start <= termRange.end;
        }
        if (end) {
            return end >= termRange.start && end <= termRange.end;
        }
        return true;
    };

    if (!selectedClass) {
        return `
            <div class="space-y-4">
                <div class="flex flex-wrap gap-2">${classButtonsHtml}</div>
                ${termFilterHtml}
                <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
                    <p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_grades_select_class')}</p>
                </div>
            </div>
        `;
    }

    const studentIds = Array.isArray(selectedClass.studentIds) ? selectedClass.studentIds : [];
    const students = state.students
        .filter(student => studentIds.includes(student.id))
        .sort(sortStudentsByName);

    const learningActivities = state.learningActivities
        .filter(activity => activity.classId === selectedClass.id)
        .filter(filterBySelectedTerm)
        .sort((a, b) => getActivitySortOrder(a) - getActivitySortOrder(b));

    const competencies = Array.isArray(selectedClass.competencies) ? selectedClass.competencies : [];
    const criterionIndex = new Map();
    competencies.forEach(competency => {
        const criteria = Array.isArray(competency.criteria) ? competency.criteria : [];
        criteria.forEach(criterion => {
            if (criterion && criterion.id) {
                criterionIndex.set(criterion.id, { competency, criterion });
            }
        });
    });

    const getCriterionHeader = (item) => {
        const info = criterionIndex.get(item.criterionId) || {};
        const criterion = info.criterion || {};
        const competency = info.competency || {};
        const code = typeof criterion.code === 'string' ? criterion.code.trim() : '';
        const name = typeof criterion.name === 'string' ? criterion.name.trim() : '';
        const description = typeof criterion.description === 'string' ? criterion.description.trim() : '';
        const competencyName = typeof competency.name === 'string' ? competency.name.trim() : '';
        const primaryParts = [code, name].filter(Boolean);
        const primary = primaryParts.length > 0 ? primaryParts.join(' · ') : (description || t('evaluation_grades_no_criteria'));
        const secondaryHtml = competencyName
            ? `<div class="text-[11px] text-gray-500 dark:text-gray-400 font-normal">${escapeHtml(competencyName)}</div>`
            : '';
        const scoringMode = item.scoring?.mode === 'numeric' ? 'numeric' : 'competency';
        let scoringInfoHtml = '';
        if (scoringMode === 'numeric') {
            const maxScore = Number(item.scoring?.maxScore);
            const weight = Number(item.weight);
            const hasWeight = Number.isFinite(weight) && weight > 0;
            const formattedWeight = hasWeight
                ? formatDecimal(weight, locale, { maximumFractionDigits: 2, useGrouping: false })
                : '';
            if (Number.isFinite(maxScore) && maxScore > 0) {
                const formattedMax = formatDecimal(maxScore, locale, { maximumFractionDigits: 2, useGrouping: false });
                const suffixTemplate = t('rubric_numeric_header_suffix');
                const suffixText = suffixTemplate.startsWith('[')
                    ? formattedMax
                    : suffixTemplate.replace('{{max}}', formattedMax);
                scoringInfoHtml = `<div class="text-[11px] text-gray-500 dark:text-gray-400 font-normal">${escapeHtml(suffixText)}</div>`;
            }
            if (hasWeight) {
                const weightTemplate = t('rubric_numeric_weight_hint');
                const weightText = weightTemplate.startsWith('[')
                    ? formattedWeight
                    : weightTemplate.replace('{{weight}}', formattedWeight);
                scoringInfoHtml += `<div class="text-[11px] text-gray-500 dark:text-gray-400 font-normal">${escapeHtml(weightText)}</div>`;
            }
        }
        return `
            <div class="space-y-0.5">
                <div>${escapeHtml(primary)}</div>
                ${secondaryHtml}
                ${scoringInfoHtml}
            </div>
        `;
    };

    let contentHtml = '';

    if (learningActivities.length === 0) {
        contentHtml = `<p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_grades_no_activities')}</p>`;
    } else if (students.length === 0) {
        contentHtml = `<p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_grades_no_students')}</p>`;
    } else {
        const headerRow1 = learningActivities.map(activity => {
            const rubricItems = Array.isArray(activity.rubric?.items) ? activity.rubric.items : [];
            const colSpan = Math.max(rubricItems.length, 1);
            const identifier = activity.shortCode?.trim();
            const fallbackTitle = activity.title?.trim() || t('activities_untitled_label');
            const headerLabel = identifier || fallbackTitle;
            return `<th scope="col" colspan="${colSpan}" class="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">${escapeHtml(headerLabel)}</th>`;
        }).join('');

        const headerRow2 = learningActivities.map(activity => {
            const rubricItems = Array.isArray(activity.rubric?.items) ? activity.rubric.items : [];
            if (rubricItems.length === 0) {
                return `<th scope="col" class="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">${t('evaluation_grades_no_criteria')}</th>`;
            }
            return rubricItems.map(item => `<th scope="col" class="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 text-left min-w-[11rem]">${getCriterionHeader(item)}</th>`).join('');
        }).join('');

        const rowsHtml = students.map(student => {
            const activityCells = learningActivities.map(activity => {
                const rubric = activity.rubric || {};
                const rubricItems = Array.isArray(rubric.items) ? rubric.items : [];
                const evaluations = rubric.evaluations && typeof rubric.evaluations === 'object' ? rubric.evaluations : {};
                const evaluation = evaluations[student.id];
                const scores = evaluation && evaluation.scores && typeof evaluation.scores === 'object' ? evaluation.scores : {};
                const generalComment = typeof evaluation?.comment === 'string' ? evaluation.comment.trim() : '';
                const flags = evaluation && typeof evaluation.flags === 'object' ? evaluation.flags : {};
                const isExempt = Boolean(flags.exempt);
                const isNotPresented = Boolean(flags.notPresented);
                const isDeliveredLate = Boolean(flags.deliveredLate);
                const statusTooltipParts = [];
                if (isExempt) {
                    statusTooltipParts.push(t('rubric_flag_exempt'));
                } else if (isNotPresented) {
                    statusTooltipParts.push(t('rubric_flag_not_presented'));
                } else if (isDeliveredLate) {
                    statusTooltipParts.push(t('rubric_flag_delivered_late'));
                }

                if (rubricItems.length === 0) {
                    const tooltipParts = [...statusTooltipParts];
                    if (generalComment) {
                        tooltipParts.push(`${t('evaluation_tooltip_general_comment')}: ${generalComment}`);
                    }
                    const tooltipAttr = tooltipParts.length > 0 ? ` title="${escapeAttribute(tooltipParts.join('\\n'))}"` : '';
                    const textClasses = isExempt
                        ? 'text-emerald-600 dark:text-emerald-300 font-semibold'
                        : isNotPresented
                            ? 'text-red-600 dark:text-red-300 font-semibold'
                            : isDeliveredLate
                                ? 'text-amber-600 dark:text-amber-300 font-semibold'
                                : 'text-gray-400';
                    const label = isExempt
                        ? t('rubric_flag_exempt_short')
                        : isNotPresented
                            ? t('rubric_flag_not_presented_short')
                            : isDeliveredLate
                                ? t('rubric_flag_delivered_late_short')
                                : '—';
                    const deliveredLateIcon = '<i data-lucide="file-clock" class="w-3.5 h-3.5 inline-block align-text-top ml-1 text-amber-500 dark:text-amber-300"></i>';
                    const exemptIcon = '<i data-lucide="book-dashed" class="w-3.5 h-3.5 inline-block align-text-top ml-1 text-emerald-500 dark:text-emerald-300"></i>';
                    const statusIcon = isExempt
                        ? exemptIcon
                        : isNotPresented
                            ? '<i data-lucide="shredder" class="w-3.5 h-3.5 inline-block align-text-top ml-1"></i>'
                            : isDeliveredLate
                                ? deliveredLateIcon
                                : '';
                    return `<td class="px-3 py-2 text-sm text-center align-middle"${tooltipAttr}><span class="${textClasses}">${escapeHtml(label)}</span>${statusIcon}</td>`;
                }

                return rubricItems.map(item => {
                    const scoringMode = item.scoring?.mode === 'numeric' ? 'numeric' : 'competency';
                    const rawScore = scores[item.id];
                    const scoreLevel = scoringMode === 'numeric' ? '' : (rawScore || '');
                    const levelComment = scoreLevel && item.levelComments && typeof item.levelComments === 'object'
                        ? (item.levelComments[scoreLevel] || '')
                        : '';
                    const tooltipParts = [...statusTooltipParts];
                    if (levelComment) {
                        tooltipParts.push(`${t('evaluation_tooltip_criterion_comment')}: ${levelComment}`);
                    }
                    if (generalComment) {
                        tooltipParts.push(`${t('evaluation_tooltip_general_comment')}: ${generalComment}`);
                    }

                    let labelHtml;
                    let textClasses;

                    if (isExempt) {
                        textClasses = 'text-emerald-600 dark:text-emerald-300 font-semibold';
                        labelHtml = `<span class="${textClasses}">${escapeHtml(t('rubric_flag_exempt_short'))}</span>`;
                    } else if (isNotPresented) {
                        textClasses = 'text-red-600 dark:text-red-300 font-semibold';
                        labelHtml = `<span class="${textClasses}">${escapeHtml(t('rubric_flag_not_presented_short'))}</span>`;
                    } else if (scoringMode === 'numeric') {
                        const numericValue = getRubricNumericValue(rawScore);
                        const maxScore = Number(item.scoring?.maxScore);
                        const hasNumericValue = Number.isFinite(numericValue);
                        const hasValidMax = Number.isFinite(maxScore) && maxScore > 0;
                        if (hasNumericValue && hasValidMax) {
                            const numericResult = computeNumericEvidence(numericValue, maxScore, null, { normalizedConfig: classEvaluationConfig });
                            const levelId = numericResult?.levelId || '';
                            const levelLabel = levelId ? t(`rubric_level_${levelId}_label`) : '';
                            const formattedValue = formatDecimal(numericValue, locale, { maximumFractionDigits: 2, useGrouping: false });
                            const formattedMax = formatDecimal(maxScore, locale, { maximumFractionDigits: 2, useGrouping: false });
                            const formattedNormalized = Number.isFinite(numericResult?.scoreOutOfFour)
                                ? formatDecimal(numericResult.scoreOutOfFour, locale, { maximumFractionDigits: 2, useGrouping: false })
                                : '';
                            const ratioTemplate = t('rubric_numeric_ratio');
                            const ratioText = ratioTemplate.startsWith('[')
                                ? `${formattedValue} / ${formattedMax}`
                                : ratioTemplate.replace('{{value}}', formattedValue).replace('{{max}}', formattedMax);
                            const equivalenceTemplate = t('rubric_numeric_equivalence');
                            const equivalenceText = levelId && formattedNormalized
                                ? (equivalenceTemplate.startsWith('[')
                                    ? `${levelId} (${formattedNormalized}/4)`
                                    : equivalenceTemplate
                                        .replace('{{level}}', levelId)
                                        .replace('{{level_label}}', levelLabel.startsWith('[') ? levelId : levelLabel)
                                        .replace('{{score}}', formattedNormalized))
                                : '';
                            const summary = equivalenceText ? `${ratioText} · ${equivalenceText}` : ratioText;
                            textClasses = 'text-gray-800 dark:text-gray-100 font-medium';
                            const srOnlyLabel = levelLabel && !levelLabel.startsWith('[')
                                ? `<span class="sr-only"> (${escapeHtml(levelLabel)})</span>`
                                : '';
                            labelHtml = `<span class="${textClasses}">${escapeHtml(summary)}</span>${srOnlyLabel}`;
                            tooltipParts.push(ratioText);
                            if (equivalenceText) {
                                tooltipParts.push(equivalenceText);
                            }
                        } else if (hasValidMax) {
                            const maxHintTemplate = t('rubric_numeric_max_hint');
                            const formattedMax = formatDecimal(maxScore, locale, { maximumFractionDigits: 2, useGrouping: false });
                            const maxHint = maxHintTemplate.startsWith('[')
                                ? formattedMax
                                : maxHintTemplate.replace('{{max}}', formattedMax);
                            textClasses = 'text-gray-400';
                            labelHtml = `<span class="${textClasses}">${escapeHtml(maxHint)}</span>`;
                            tooltipParts.push(maxHint);
                        } else {
                            const missingMaxTemplate = t('rubric_numeric_missing_max');
                            textClasses = 'text-red-600 dark:text-red-300 font-semibold';
                            const message = missingMaxTemplate.startsWith('[') ? '—' : missingMaxTemplate;
                            labelHtml = `<span class="${textClasses}">${escapeHtml(message)}</span>`;
                        }
                    } else if (scoreLevel) {
                        const key = `rubric_level_${scoreLevel}_label`;
                        const translated = t(key);
                        textClasses = 'text-gray-800 dark:text-gray-100 font-medium';
                        const srOnlyLabel = translated !== `[${key}]`
                            ? `<span class="sr-only"> (${escapeHtml(translated)})</span>`
                            : '';
                        labelHtml = `<span class="${textClasses}">${escapeHtml(scoreLevel)}</span>${srOnlyLabel}`;
                    } else {
                        textClasses = isDeliveredLate
                            ? 'text-amber-600 dark:text-amber-300 font-semibold'
                            : 'text-gray-400';
                        labelHtml = `<span class="${textClasses}">${escapeHtml(isDeliveredLate ? t('rubric_flag_delivered_late_short') : '—')}</span>`;
                    }

                    const tooltipAttr = tooltipParts.length > 0 ? ` title="${escapeAttribute(tooltipParts.join('\\n'))}"` : '';
                    const deliveredLateIcon = '<i data-lucide="file-clock" class="w-3.5 h-3.5 inline-block align-text-top ml-1 text-amber-500 dark:text-amber-300"></i>';
                    const exemptIcon = '<i data-lucide="book-dashed" class="w-3.5 h-3.5 inline-block align-text-top ml-1 text-emerald-500 dark:text-emerald-300"></i>';
                    const statusIcon = isExempt
                        ? exemptIcon
                        : isNotPresented
                            ? '<i data-lucide="shredder" class="w-3.5 h-3.5 inline-block align-text-top ml-1"></i>'
                            : isDeliveredLate
                                ? deliveredLateIcon
                                : '';
                    return `<td class="px-3 py-2 text-sm text-center align-middle"${tooltipAttr}>${labelHtml}${statusIcon}</td>`;
                }).join('');
            }).join('');

            return `<tr class="border-b border-gray-100 dark:border-gray-800"><th scope="row" class="px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100 text-left min-w-[12rem]">${escapeHtml(student.name)}</th>${activityCells}</tr>`;
        }).join('');

        contentHtml = `
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-left">
                    <thead class="bg-white dark:bg-gray-800">
                        <tr>
                            <th scope="col" rowspan="2" class="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 min-w-[12rem]">${t('evaluation_grades_student_column')}</th>
                            ${headerRow1}
                        </tr>
                        <tr>
                            ${headerRow2}
                        </tr>
                    </thead>
                    <tbody class="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }

    return `
        <div class="space-y-4">
            <div class="flex flex-wrap gap-2">${classButtonsHtml}</div>
            ${termFilterHtml}
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6 shadow-sm">
                ${contentHtml}
            </div>
        </div>
    `;
}

function renderEvaluationTermGradesTab(classes) {
    if (classes.length === 0) {
        return `
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
                <p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_no_classes')}</p>
            </div>
        `;
    }

    const { selectedClass, classButtonsHtml } = buildEvaluationClassSelection(classes);
    const selectedTermId = state.evaluationSelectedTermId || 'all';
    const { termFilterHtml } = buildEvaluationTermFilter(selectedTermId);

    if (!selectedClass) {
        return `
            <div class="space-y-4">
                <div class="flex flex-wrap gap-2">${classButtonsHtml}</div>
                ${termFilterHtml}
                <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
                    <p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_grades_select_class')}</p>
                </div>
            </div>
        `;
    }

    const normalizedConfig = normalizeEvaluationConfig(state.evaluationSettings[selectedClass.id]);
    const levelOptions = Array.isArray(normalizedConfig.competency.levels)
        ? normalizedConfig.competency.levels
        : [];
    const expandedByClass = state.termGradeExpandedCompetencies?.[selectedClass.id] || {};
    const expandedCompetencyIds = new Set(Array.isArray(expandedByClass?.[selectedTermId]) ? expandedByClass[selectedTermId] : []);
    const classIdAttr = escapeAttribute(selectedClass.id || '');
    const termIdAttr = escapeAttribute(selectedTermId || '');

    const calculationMode = state.termGradeCalculationMode || 'dates';
    const record = state.termGradeRecords?.[selectedClass.id]?.[selectedTermId] || null;
    const hasExistingTermGrades = Boolean(record && Object.keys(record.students || {}).length > 0);
    const calculationModeSelector = `
        <fieldset class="term-grade-mode flex flex-col gap-1">
            <legend class="text-sm font-medium text-gray-700 dark:text-gray-200">${t('evaluation_term_grades_mode_label')}</legend>
            <div class="flex items-center gap-4">
                <label class="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                    <input type="radio" name="term-grade-mode" value="dates" data-action="set-term-grade-calculation-mode" data-event="change" class="rounded text-blue-600 focus:ring-blue-500" ${calculationMode === 'dates' ? 'checked' : ''}>
                    <span>${t('evaluation_term_grades_mode_dates')}</span>
                </label>
                <label class="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                    <input type="radio" name="term-grade-mode" value="accumulated" data-action="set-term-grade-calculation-mode" data-event="change" class="rounded text-blue-600 focus:ring-blue-500" ${calculationMode === 'accumulated' ? 'checked' : ''}>
                    <span>${t('evaluation_term_grades_mode_accumulated')}</span>
                </label>
            </div>
        </fieldset>
    `;

    const calculateButtonHtml = `
        <button data-action="calculate-term-grades" data-class-id="${selectedClass.id}" data-term-id="${selectedTermId}" class="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            <i data-lucide="calculator" class="w-4 h-4"></i>
            ${t('evaluation_term_grades_calculate_button')}
        </button>
    `;

    const recalculateFinalButtonHtml = `
        <button data-action="recalculate-term-final-grades" data-class-id="${classIdAttr}" data-term-id="${termIdAttr}" class="inline-flex items-center gap-2 px-3 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
            ${t('evaluation_term_grades_recalculate_final_button')}
        </button>
    `;

    const clearButtonDisabledAttr = hasExistingTermGrades ? '' : ' disabled';
    const clearButtonClasses = hasExistingTermGrades
        ? 'inline-flex items-center gap-2 px-3 py-2 border border-red-600 text-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20'
        : 'inline-flex items-center gap-2 px-3 py-2 border border-red-600 text-red-600 rounded-md opacity-50 cursor-not-allowed';
    const clearButtonLabel = t('evaluation_term_grades_clear_button');
    const clearButtonHtml = `
        <button data-action="clear-term-grades" data-class-id="${selectedClass.id}" data-term-id="${selectedTermId}" class="${clearButtonClasses}"${clearButtonDisabledAttr} aria-label="${escapeAttribute(clearButtonLabel)}" title="${escapeAttribute(clearButtonLabel)}">
            <i data-lucide="eraser" class="w-4 h-4"></i>
        </button>
    `;

    const calculationControlsHtml = `
        <div class="flex flex-wrap items-end gap-4">
            ${termFilterHtml}
            ${calculationModeSelector}
            <div class="flex flex-wrap gap-2">
                ${calculateButtonHtml}
                ${recalculateFinalButtonHtml}
                ${clearButtonHtml}
            </div>
        </div>
    `;

    const studentIds = Array.isArray(selectedClass.studentIds) ? selectedClass.studentIds : [];
    const students = state.students
        .filter(student => studentIds.includes(student.id))
        .sort(sortStudentsByName);

    if (students.length === 0) {
        const calculationHint = `<p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_grades_no_students')}</p>`;
        return `
            <div class="space-y-4">
                <div class="flex flex-wrap gap-2">${classButtonsHtml}</div>
                ${calculationControlsHtml}
                <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
                    ${calculationHint}
                </div>
            </div>
        `;
    }

    const competencies = Array.isArray(selectedClass.competencies) ? selectedClass.competencies : [];
    const usedFootnoteSymbols = new Set();

    const headerRow1 = competencies.map(comp => {
        const criteria = Array.isArray(comp.criteria) ? comp.criteria : [];
        const criteriaCount = criteria.length;
        const competencyId = comp.id;
        const label = comp.code?.trim() || t('competency_without_code');
        const hasCriteria = criteriaCount > 0;
        const canToggle = hasCriteria && competencyId;
        const isExpanded = hasCriteria ? (canToggle ? expandedCompetencyIds.has(competencyId) : true) : false;
        const colSpan = Math.max((isExpanded ? criteriaCount : 0) + 1, 1);
        const baseClasses = 'term-grade-header term-grade-header--group term-grade-separator px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400';

        if (!canToggle) {
            return `<th scope="col" colspan="${colSpan}" class="${baseClasses}">${escapeHtml(label)}</th>`;
        }

        const toggleLabel = isExpanded
            ? t('evaluation_term_grades_hide_criteria')
            : t('evaluation_term_grades_show_criteria');
        const ariaLabel = `${toggleLabel} · ${label}`;
        const icon = isExpanded ? 'chevron-down' : 'chevron-right';

        return `
            <th scope="col" colspan="${colSpan}" class="${baseClasses}">
                <button type="button"
                    class="term-grade-toggle inline-flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 rounded"
                    data-action="toggle-term-grade-competency"
                    data-class-id="${classIdAttr}"
                    data-term-id="${termIdAttr}"
                    data-competency-id="${escapeAttribute(competencyId)}"
                    aria-expanded="${isExpanded ? 'true' : 'false'}"
                    aria-label="${escapeAttribute(ariaLabel)}"
                >
                    <i data-lucide="${icon}" class="w-4 h-4"></i>
                    <span>${escapeHtml(label)}</span>
                </button>
            </th>
        `;
    }).join('');

    const headerRow2 = competencies.map(comp => {
        const criteria = Array.isArray(comp.criteria) ? comp.criteria : [];
        const criteriaCount = criteria.length;
        const competencyId = comp.id;
        const hasCriteria = criteriaCount > 0;
        const canToggle = hasCriteria && competencyId;
        const isExpanded = hasCriteria ? (canToggle ? expandedCompetencyIds.has(competencyId) : true) : false;
        const criteriaCells = isExpanded
            ? criteria.map(criterion => {
                const criterionLabel = criterion.code?.trim() || t('criterion_without_code');
                return `<th scope="col" class="term-grade-header term-grade-header--criterion px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">${escapeHtml(criterionLabel)}</th>`;
            }).join('')
            : '';
        const competencyLabel = comp.code?.trim() || t('competency_without_code');
        return `${criteriaCells}<th scope="col" class="term-grade-header term-grade-header--competency term-grade-separator px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">${escapeHtml(competencyLabel)}</th>`;
    }).join('');

    const rowsHtml = students.map(student => {
        const studentCells = [];
        const studentName = student.name || '';

        competencies.forEach(comp => {
            const criteria = Array.isArray(comp.criteria) ? comp.criteria : [];
            const criteriaCount = criteria.length;
            const competencyId = comp.id;
            const hasCriteria = criteriaCount > 0;
            const canToggle = hasCriteria && competencyId;
            const isExpanded = hasCriteria ? (canToggle ? expandedCompetencyIds.has(competencyId) : true) : false;

            if (isExpanded && hasCriteria) {
                criteria.forEach(criterion => {
                    const entry = getTermGradeEntry(record, student.id, 'criteria', criterion.id);
                    (entry.noteSymbols || []).forEach(symbol => symbol && usedFootnoteSymbols.add(symbol));
                    const label = `${comp.code?.trim() || t('competency_without_code')} · ${criterion.code?.trim() || t('criterion_without_code')}`;
                    studentCells.push(renderTermGradeCell(entry, {
                        classId: selectedClass.id,
                        termId: selectedTermId,
                        studentId: student.id,
                        scope: 'criteria',
                        targetId: criterion.id,
                        label,
                        studentName,
                        levelOptions,
                        cellClasses: 'term-grade-cell--criterion',
                    }));
                });
            }

            const compEntry = getTermGradeEntry(record, student.id, 'competencies', comp.id);
            (compEntry.noteSymbols || []).forEach(symbol => symbol && usedFootnoteSymbols.add(symbol));
            const compLabel = comp.code?.trim() || t('competency_without_code');
            studentCells.push(renderTermGradeCell(compEntry, {
                classId: selectedClass.id,
                termId: selectedTermId,
                studentId: student.id,
                scope: 'competencies',
                targetId: comp.id,
                label: compLabel,
                studentName,
                levelOptions,
                cellClasses: 'term-grade-cell--competency term-grade-separator',
            }));
        });

        const finalEntry = getTermGradeEntry(record, student.id, 'final', 'final');
        (finalEntry.noteSymbols || []).forEach(symbol => symbol && usedFootnoteSymbols.add(symbol));
        const finalCell = renderTermGradeCell(finalEntry, {
            classId: selectedClass.id,
            termId: selectedTermId,
            studentId: student.id,
            scope: 'final',
            targetId: 'final',
            label: t('evaluation_term_grades_final_label'),
            studentName,
            levelOptions,
            cellClasses: 'term-grade-cell--final term-grade-separator',
        });

        const studentCellsHtml = studentCells.join('');
        return `<tr class="term-grade-row border-b border-gray-100 dark:border-gray-800"><th scope="row" class="term-grade-student-cell px-3 py-2 text-sm font-medium text-left text-gray-800 dark:text-gray-100 min-w-[12rem]">${escapeHtml(studentName)}</th>${studentCellsHtml}${finalCell}</tr>`;
    }).join('');

    const totalVisibleColumns = competencies.reduce((sum, comp) => {
        const criteria = Array.isArray(comp.criteria) ? comp.criteria : [];
        const criteriaCount = criteria.length;
        const competencyId = comp.id;
        const hasCriteria = criteriaCount > 0;
        const canToggle = hasCriteria && competencyId;
        const isExpanded = hasCriteria ? (canToggle ? expandedCompetencyIds.has(competencyId) : true) : false;
        const visibleCriteria = isExpanded ? criteriaCount : 0;
        return sum + visibleCriteria + 1;
    }, 1) + 1;
    const tableBodyHtml = rowsHtml || `<tr class="term-grade-row"><td colspan="${totalVisibleColumns}" class="px-3 py-4 text-sm text-center text-gray-600 dark:text-gray-300">${t('evaluation_grades_no_students')}</td></tr>`;

    const tableHtml = `
        <table class="term-grades-table min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-left">
            <thead class="term-grade-header-group bg-white dark:bg-gray-800">
                <tr>
                    <th scope="col" rowspan="2" class="term-grade-student-header term-grade-header px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 min-w-[12rem]">${t('evaluation_grades_student_column')}</th>
                    ${headerRow1}
                    <th scope="col" rowspan="2" class="term-grade-header term-grade-header--final term-grade-separator px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">${t('evaluation_term_grades_final_label')}</th>
                </tr>
                ${competencies.length > 0 ? `<tr>${headerRow2}</tr>` : ''}
            </thead>
            <tbody class="term-grade-tbody bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
                ${tableBodyHtml}
            </tbody>
        </table>
    `;

    const hasCalculatedData = record && Object.keys(record.students || {}).length > 0;
    const calculationHint = hasCalculatedData
        ? ''
        : `<p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_term_grades_empty_state')}</p>`;

    const footnoteMessages = {
        '*': t('evaluation_term_grades_footnote_weighted'),
        '**': t('evaluation_term_grades_footnote_ca'),
    };
    const footnotesHtml = Array.from(usedFootnoteSymbols)
        .filter(symbol => footnoteMessages[symbol])
        .sort((a, b) => a.length - b.length)
        .map(symbol => `<li class="text-xs text-gray-600 dark:text-gray-300"><span class="font-semibold mr-1">${escapeHtml(symbol)}</span>${escapeHtml(footnoteMessages[symbol])}</li>`)
        .join('');
    const footnotesSection = footnotesHtml
        ? `<div class="pt-3 border-t border-gray-100 dark:border-gray-800"><ul class="space-y-1">${footnotesHtml}</ul></div>`
        : '';

    return `
        <div class="space-y-4">
            <div class="flex flex-wrap gap-2">${classButtonsHtml}</div>
            ${calculationControlsHtml}
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6 shadow-sm space-y-4">
                ${calculationHint}
                <div class="overflow-x-auto">${tableHtml}</div>
                ${footnotesSection}
            </div>
        </div>
    `;
}

function getTermGradeEntry(record, studentId, scope, targetId) {
    if (!record || !record.students || !record.students[studentId]) {
        return { numericScore: '', levelId: '', noteSymbols: [] };
    }
    const studentRecord = record.students[studentId];
    if (scope === 'final') {
        return studentRecord.final || { numericScore: '', levelId: '', noteSymbols: [] };
    }
    const container = scope === 'competencies' ? studentRecord.competencies : studentRecord.criteria;
    if (!container || typeof container !== 'object') {
        return { numericScore: '', levelId: '', noteSymbols: [] };
    }
    return container[targetId] || { numericScore: '', levelId: '', noteSymbols: [] };
}

function renderTermGradeCell(entry, meta) {
    const {
        classId,
        termId,
        studentId,
        scope,
        targetId,
        label,
        studentName,
        levelOptions,
    } = meta;

    const numericValue = typeof entry?.numericScore === 'string'
        ? entry.numericScore
        : (Number.isFinite(entry?.numericScore) ? String(entry.numericScore) : '');
    const levelValue = entry?.levelId || '';
    const noteSymbols = Array.isArray(entry?.noteSymbols) ? entry.noteSymbols.filter(Boolean) : [];
    const footnoteHtml = noteSymbols.length > 0
        ? `<span class="term-grade-footnote text-xs text-gray-500 dark:text-gray-400">${escapeHtml(noteSymbols.join(''))}</span>`
        : '';
    const dataTargetId = scope === 'final' ? 'final' : (targetId || '');
    const ariaLabel = `${studentName} · ${label}`;
    const levelOptionsHtml = [
        '<option value="">—</option>',
        ...levelOptions.map(level => `<option value="${level.id}" ${level.id === levelValue ? 'selected' : ''}>${escapeHtml(level.label || level.id)}</option>`),
    ].join('');

    const extraCellClasses = typeof meta?.cellClasses === 'string' ? meta.cellClasses.trim() : '';
    const cellClassNames = [
        'px-3',
        'py-2',
        'text-sm',
        'text-center',
        'align-middle',
        'term-grade-cell',
    ];
    if (extraCellClasses) {
        cellClassNames.push(extraCellClasses);
    }
    const selectedLevelAttr = escapeAttribute(levelValue || 'none');

    return `
        <td class="${cellClassNames.join(' ')}">
            <div class="term-grade-cell-content">
                <input
                    type="number"
                    step="0.01"
                    data-action="update-term-grade-numeric"
                    data-event="change"
                    data-class-id="${classId}"
                    data-term-id="${termId}"
                    data-student-id="${studentId}"
                    data-scope="${scope}"
                    data-target-id="${dataTargetId}"
                    value="${escapeAttribute(numericValue || '')}"
                    class="term-grade-score-input border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-xs text-gray-800 dark:text-gray-100 text-right"
                    aria-label="${escapeAttribute(ariaLabel)}"
                >
                <select
                    data-action="update-term-grade-level"
                    data-event="change"
                    data-class-id="${classId}"
                    data-term-id="${termId}"
                    data-student-id="${studentId}"
                    data-scope="${scope}"
                    data-target-id="${dataTargetId}"
                    class="term-grade-level-select border border-gray-300 dark:border-gray-600 rounded-md text-xs text-gray-700 dark:text-gray-200"
                    aria-label="${escapeAttribute(ariaLabel)}"
                    data-selected-level="${selectedLevelAttr}"
                >
                    ${levelOptionsHtml}
                </select>
                ${footnoteHtml}
            </div>
        </td>
    `;
}

export function renderLearningActivityEditorView() {
    const draft = state.learningActivityDraft;
    if (!draft) {
        renderMobileHeaderActions([
            { action: 'back-to-activities', label: t('back_to_activities'), icon: 'arrow-left' }
        ]);
        return `
            <div class="p-6">
                <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
                    <p class="text-sm text-yellow-800 dark:text-yellow-200">${t('activities_editor_missing')}</p>
                    <button data-action="back-to-activities" class="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        <i data-lucide="arrow-left" class="w-4 h-4"></i>
                        ${t('back_to_activities')}
                    </button>
                </div>
            </div>
        `;
    }

    const targetClass = state.activities.find(a => a.id === draft.classId);
    if (!targetClass) {
        renderMobileHeaderActions([
            { action: 'back-to-activities', label: t('back_to_activities'), icon: 'arrow-left' }
        ]);
        return `
            <div class="p-6">
                <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
                    <p class="text-sm text-red-800 dark:text-red-200">${t('activities_editor_missing')}</p>
                    <button data-action="back-to-activities" class="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        <i data-lucide="arrow-left" class="w-4 h-4"></i>
                        ${t('back_to_activities')}
                    </button>
                </div>
            </div>
        `;
    }

    const mobileActions = [
        ...(draft.isNew ? [] : [
            { action: 'go-to-evaluation-for-learning-activity', label: t('activities_go_to_evaluation'), icon: 'check-circle-2' },
            { action: 'open-learning-activity-rubric', label: t('activities_rubric_button_label'), icon: 'table-properties' }
        ]),
        { action: 'save-learning-activity-draft', label: t('activities_save_button'), icon: 'save' },
        { action: 'back-to-activities', label: t('back_to_activities'), icon: 'arrow-left' }
    ];

    renderMobileHeaderActions(mobileActions);

    const evaluationConfig = normalizeEvaluationConfig(state.evaluationSettings[targetClass.id]);
    const usesNumericEvaluation = evaluationConfig.modality === EVALUATION_MODALITIES.NUMERIC;
    const numericDraft = normalizeLearningActivityNumeric(draft.numeric);
    const numericWeightValue = numericDraft.weight === '' ? '' : String(numericDraft.weight);
    const numericCategories = Array.isArray(evaluationConfig.numeric?.categories)
        ? evaluationConfig.numeric.categories
        : [];
    const numericCategoryOptions = numericCategories.map((category, index) => {
        const label = category.name?.trim()
            ? category.name.trim()
            : t('evaluation_numeric_category_fallback', { index: index + 1 });
        const isSelected = category.id === numericDraft.categoryId;
        return `<option value="${category.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');

    const competencies = Array.isArray(targetClass.competencies) ? targetClass.competencies : [];
    const selectedRefs = Array.isArray(draft.criteriaRefs) ? draft.criteriaRefs : [];

    const selectedCriteria = selectedRefs.map(ref => {
        const competency = competencies.find(c => c.id === ref.competencyId);
        const criterion = competency?.criteria?.find(cr => cr.id === ref.criterionId);
        if (!criterion) return null;
        return {
            competency,
            criterion,
        };
    }).filter(Boolean);

    const startDateValue = draft.startDate || '';
    const endDateValue = draft.endDate || '';
    const currentStatusValue = draft.statusIsManual && Object.values(LEARNING_ACTIVITY_STATUS).includes(draft.status)
        ? draft.status
        : 'auto';
    const automaticStatusPreview = calculateLearningActivityStatus({
        ...draft,
        statusIsManual: false,
    });
    const automaticStatusLabelKey = {
        [LEARNING_ACTIVITY_STATUS.SCHEDULED]: 'learning_activity_status_scheduled',
        [LEARNING_ACTIVITY_STATUS.OPEN_SUBMISSIONS]: 'learning_activity_status_open',
        [LEARNING_ACTIVITY_STATUS.PENDING_REVIEW]: 'learning_activity_status_pending',
        [LEARNING_ACTIVITY_STATUS.CORRECTED]: 'learning_activity_status_corrected',
    }[automaticStatusPreview] || 'learning_activity_status_scheduled';
    const automaticStatusLabel = t(automaticStatusLabelKey);
    const statusOptions = [
        { value: 'auto', label: t('learning_activity_status_auto') },
        { value: LEARNING_ACTIVITY_STATUS.SCHEDULED, label: t('learning_activity_status_scheduled') },
        { value: LEARNING_ACTIVITY_STATUS.OPEN_SUBMISSIONS, label: t('learning_activity_status_open') },
        { value: LEARNING_ACTIVITY_STATUS.PENDING_REVIEW, label: t('learning_activity_status_pending') },
        { value: LEARNING_ACTIVITY_STATUS.CORRECTED, label: t('learning_activity_status_corrected') },
    ];
    const statusSelectOptions = statusOptions.map(option => `
        <option value="${option.value}" ${option.value === currentStatusValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>
    `).join('');
    const weightValue = draft.weight === '' ? '' : draft.weight;
    const weightInputValue = weightValue === '' ? '' : String(weightValue);
    const statusHelpText = (() => {
        const raw = t('activities_form_status_help');
        if (!raw || raw.startsWith('[')) {
            return '';
        }
        return raw.replace('{{status}}', automaticStatusLabel);
    })();
    const weightHelpText = (() => {
        const raw = t('activities_form_weight_help');
        if (!raw || raw.startsWith('[')) {
            return '';
        }
        return raw;
    })();
    const numericWeightHelp = (() => {
        const raw = t('activities_form_numeric_weight_help');
        if (!raw || raw.startsWith('[')) {
            return '';
        }
        return raw;
    })();
    const numericControlsHtml = usesNumericEvaluation ? `
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('activities_form_numeric_category_label')}</label>
                <select data-action="update-learning-activity-numeric-category" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md">
                    <option value="">${t('activities_form_numeric_category_placeholder')}</option>
                    ${numericCategoryOptions}
                </select>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('activities_form_numeric_weight_label')}</label>
                <input type="number" min="0" step="0.1" value="${escapeHtml(numericWeightValue)}" data-action="update-learning-activity-numeric-weight" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md">
                ${numericWeightHelp ? `<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(numericWeightHelp)}</p>` : ''}
            </div>
        </div>
    ` : '';

    const selectedCriteriaHtml = selectedCriteria.length > 0
        ? `<ul class="space-y-2">${selectedCriteria.map(item => `
                <li class="px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-sm text-gray-700 dark:text-gray-200">
                    <span class="font-semibold">${item.criterion.code || t('criterion_without_code')}</span>
                    <span class="text-gray-500 dark:text-gray-400">— ${item.criterion.description || t('criterion_without_description')}</span>
                </li>
            `).join('')}</ul>`
        : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('activities_no_criteria_selected')}</p>`;

    const guideToggleIcon = state.learningActivityGuideVisible ? 'book-x' : 'book-open';
    const guideToggleLabel = state.learningActivityGuideVisible ? t('activities_hide_guide') : t('activities_show_guide');

    const competencyGuideHtml = state.learningActivityGuideVisible
        ? `
            <div class="mt-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3 bg-white dark:bg-gray-800">
                ${competencies.length > 0 ? competencies.map(comp => {
                    const criteria = Array.isArray(comp.criteria) ? comp.criteria : [];
                    return `
                        <div class="space-y-2">
                            <p class="font-semibold text-gray-800 dark:text-gray-100">${comp.code || t('competency_without_code')} · <span class="font-normal text-sm text-gray-600 dark:text-gray-300">${comp.description || t('competency_without_description')}</span></p>
                            ${criteria.length > 0 ? `<ul class="space-y-1 text-sm text-gray-600 dark:text-gray-300 list-disc list-inside">${criteria.map(cr => `<li><span class="font-medium">${cr.code || t('criterion_without_code')}</span> — ${cr.description || t('criterion_without_description')}</li>`).join('')}</ul>` : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('activities_no_criteria_for_competency')}</p>`}
                        </div>
                    `;
                }).join('') : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('activities_no_competencies_help')}</p>`}
            </div>
        `
        : '';

    const availableCriteriaHtml = competencies.length > 0
        ? competencies.map(comp => {
            const criteria = Array.isArray(comp.criteria) ? comp.criteria : [];
            if (criteria.length === 0) {
                return `
                    <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                        <p class="font-semibold text-gray-700 dark:text-gray-200">${comp.code || t('competency_without_code')}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">${comp.description || t('competency_without_description')}</p>
                        <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">${t('activities_no_criteria_for_competency')}</p>
                    </div>
                `;
            }

            const criteriaItems = criteria.map(criterion => {
                const isChecked = selectedRefs.some(ref => ref.competencyId === comp.id && ref.criterionId === criterion.id);
                return `
                    <label class="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg ${isChecked ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700' : 'bg-white dark:bg-gray-800'}">
                        <input type="checkbox" class="mt-1" data-action="toggle-learning-activity-criterion" data-competency-id="${comp.id}" data-criterion-id="${criterion.id}" ${isChecked ? 'checked' : ''}>
                        <div>
                            <p class="font-semibold text-gray-800 dark:text-gray-100">${criterion.code || t('criterion_without_code')}</p>
                            <p class="text-sm text-gray-600 dark:text-gray-300">${criterion.description || t('criterion_without_description')}</p>
                        </div>
                    </label>
                `;
            }).join('');

            return `
                <div class="space-y-2">
                    <p class="font-semibold text-gray-700 dark:text-gray-200">${comp.code || t('competency_without_code')}</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">${comp.description || t('competency_without_description')}</p>
                    <div class="space-y-2">
                        ${criteriaItems}
                    </div>
                </div>
            `;
        }).join('<hr class="my-4 border-gray-200 dark:border-gray-700">')
        : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('activities_no_competencies_help')}</p>`;

    const selectedCount = selectedCriteria.length;
    const isCriteriaModalOpen = state.learningActivityCriteriaModalOpen;
    const shortcutButtonsHtml = draft.isNew ? '' : `
        <button
            type="button"
            data-action="go-to-evaluation-for-learning-activity"
            data-learning-activity-id="${draft.id}"
            data-class-id="${targetClass.id}"
            class="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
            <i data-lucide="check-circle-2" class="w-4 h-4"></i>
            <span>${t('activities_go_to_evaluation')}</span>
        </button>
        <button
            type="button"
            data-action="open-learning-activity-rubric"
            data-learning-activity-id="${draft.id}"
            class="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
            <i data-lucide="table-properties" class="w-4 h-4"></i>
            <span>${t('activities_rubric_button_label')}</span>
        </button>
    `;
    const deleteButtonHtml = draft.isNew ? '' : `
        <button
            type="button"
            data-action="delete-learning-activity"
            data-learning-activity-id="${draft.id}"
            class="px-4 py-2 rounded-md border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center justify-center"
            aria-label="${t('activities_delete_button')}"
            title="${t('activities_delete_button')}"
        >
            <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
    `;
    const criteriaModalHtml = !isCriteriaModalOpen ? '' : `
        <div class="fixed inset-0 z-40 flex items-center justify-center px-4 py-6">
            <div class="absolute inset-0 bg-gray-900/50 dark:bg-gray-900/70" data-action="close-learning-activity-criteria"></div>
            <div class="relative max-w-3xl w-full bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-6">
                <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div>
                        <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-100">${t('activities_available_criteria_title')}</h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400">${t('activities_selected_criteria_help')}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" data-action="go-to-competency-settings" data-class-id="${targetClass.id}" class="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 rounded-md border border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/40">
                            <i data-lucide="target" class="w-4 h-4"></i>
                            <span>${t('activities_go_to_competency_settings')}</span>
                        </button>
                        <button type="button" data-action="close-learning-activity-criteria" class="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </div>
                </div>
                <div class="mt-4 space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                    ${availableCriteriaHtml}
                </div>
            </div>
        </div>
    `;

    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full">
            <div class="max-w-5xl mx-auto space-y-6">
                <div class="flex flex-col sm:flex-row justify-between gap-4">
                    <div>
                        <p class="text-sm text-gray-500 dark:text-gray-400">${t('activities_editor_class_prefix')} <span class="font-semibold text-gray-800 dark:text-gray-100">${targetClass.name}</span></p>
                        <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">${draft.isNew ? t('activities_editor_title_new') : t('activities_editor_title_edit')}</h2>
                    </div>
                    <div class="flex flex-wrap gap-2 justify-end">
                        ${shortcutButtonsHtml}
                        <button data-action="back-to-activities" class="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2">
                            <i data-lucide="arrow-left" class="w-4 h-4"></i>
                            ${t('activities_cancel_button')}
                        </button>
                        ${deleteButtonHtml}
                        <button data-action="save-learning-activity-draft" class="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2">
                            <i data-lucide="save" class="w-4 h-4"></i>
                            ${t('activities_save_button')}
                        </button>
                    </div>
                </div>

                <div class="space-y-6">
                    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-4">
                        <div>
                            <label for="learning-activity-title" class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('activities_form_title_label')}</label>
                            <div class="flex flex-col sm:flex-row gap-3">
                                <div class="sm:w-36">
                                    <label for="learning-activity-short-code" class="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1 sm:mb-2">${t('activities_form_identifier_label')}</label>
                                    <input id="learning-activity-short-code" type="text" value="${draft.shortCode || ''}" data-action="update-learning-activity-short-code" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md" placeholder="${t('activities_form_identifier_placeholder')}" maxlength="32">
                                </div>
                                <div class="flex-1">
                                    <label for="learning-activity-title" class="sr-only">${t('activities_form_title_label')}</label>
                                    <input id="learning-activity-title" type="text" value="${draft.title || ''}" data-action="update-learning-activity-title" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md" placeholder="${t('activities_form_title_placeholder')}">
                                </div>
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('activities_form_description_label')}</label>
                            <textarea data-action="update-learning-activity-description" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md h-36" placeholder="${t('activities_form_description_placeholder')}">${draft.description || ''}</textarea>
                        </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('start_date')}</label>
                            <input type="date" id="learning-activity-start-date" value="${startDateValue}" data-action="update-learning-activity-start-date" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('end_date')}</label>
                            <input type="date" id="learning-activity-end-date" value="${endDateValue}" data-action="update-learning-activity-end-date" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('activities_form_status_label')}</label>
                            <select data-action="update-learning-activity-status" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md">${statusSelectOptions}</select>
                            ${statusHelpText ? `<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(statusHelpText)}</p>` : ''}
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('activities_form_weight_label')}</label>
                            <input type="number" min="0" step="0.1" value="${escapeHtml(weightInputValue)}" data-action="update-learning-activity-weight" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md">
                            ${weightHelpText ? `<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(weightHelpText)}</p>` : ''}
                        </div>
                    </div>
                    ${numericControlsHtml}
                    </div>

                    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-4">
                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-100">${t('activities_selected_criteria_label')}</h3>
                                <p class="text-sm text-gray-500 dark:text-gray-400">${t('activities_selected_criteria_help')}</p>
                            </div>
                            <button type="button" data-action="open-learning-activity-criteria" class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/40 focus:outline-none focus:ring-2 focus:ring-blue-400/60">
                                <i data-lucide="list-checks" class="w-4 h-4"></i>
                                <span><span class="font-semibold">${selectedCount}</span> ${t('activities_selected_count_label')}</span>
                            </button>
                        </div>
                        ${selectedCriteriaHtml}
                        <button data-action="toggle-competency-guide" class="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                            <i data-lucide="${guideToggleIcon}" class="w-4 h-4"></i>
                            <span>${guideToggleLabel}</span>
                        </button>
                        ${competencyGuideHtml}
                    </div>

                </div>
            </div>
        </div>
        ${criteriaModalHtml}
    `;
}

export function renderStudentDetailView() {
    renderMobileHeaderActions([
        { action: 'export-student-docx', label: t('export_to_docx'), icon: 'file-text' },
        { action: 'print-student-sheet', label: t('print'), icon: 'printer' },
        { action: 'back-to-classes', label: t('back'), icon: 'arrow-left' },
    ]);

    const student = state.students.find(s => s.id === state.selectedStudentId);
    if (!student) {
        return `<div class="p-6"><p class="text-red-500">${t('student_not_found')}</p><button data-action="back-to-classes">${t('back')}</button></div>`;
    }

    const termRange = getCurrentTermDateRange();
    
    const locale = document.documentElement.lang || 'es';
    const attendanceMeta = [
        {
            status: STUDENT_ATTENDANCE_STATUS.ABSENCE,
            icon: 'circle-x',
            label: t('attendance_absence'),
            badgeClasses: 'bg-red-100 text-red-700 border border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700'
        },
        {
            status: STUDENT_ATTENDANCE_STATUS.LATE_SHORT,
            icon: 'clock-2',
            label: t('attendance_late_short'),
            badgeClasses: 'bg-yellow-100 text-yellow-700 border border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-200 dark:border-yellow-700'
        },
        {
            status: STUDENT_ATTENDANCE_STATUS.LATE_LONG,
            icon: 'clock-alert',
            label: t('attendance_late_long'),
            badgeClasses: 'bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-700'
        }
    ];

    const attendanceCounts = {
        [STUDENT_ATTENDANCE_STATUS.ABSENCE]: 0,
        [STUDENT_ATTENDANCE_STATUS.LATE_SHORT]: 0,
        [STUDENT_ATTENDANCE_STATUS.LATE_LONG]: 0
    };

    let positivesTotal = 0;
    let incidentsTotal = 0;
    let commentsTotal = 0;

    const annotationsByClass = {};
    const studentEntries = [];

    Object.entries(state.classEntries).forEach(([entryId, entryData]) => {
        const rawAnnotation = entryData.annotations?.[student.id];
        if (!rawAnnotation) {
            return;
        }

        const normalized = normalizeStudentAnnotation(rawAnnotation, entryId);
        const hasAttendance = Boolean(normalized.attendance);
        const hasPositives = Array.isArray(normalized.positives) && normalized.positives.length > 0;
        const hasIncidents = Array.isArray(normalized.incidents) && normalized.incidents.length > 0;
        const hasComments = Array.isArray(normalized.comments) && normalized.comments.length > 0;

        if (!hasAttendance && !hasPositives && !hasIncidents && !hasComments) {
            return;
        }

        const [activityId, dateString] = entryId.split('_');
        const date = new Date(dateString + 'T00:00:00');

        if (termRange && (date < termRange.start || date > termRange.end)) {
            return;
        }

        const activity = state.activities.find(a => a.id === activityId);
        if (!annotationsByClass[activityId]) {
            annotationsByClass[activityId] = {
                name: activity ? activity.name : 'Clase eliminada',
                color: activity ? activity.color : '#cccccc',
                annotations: []
            };
        }

        const annotationEntry = {
            entryId,
            date,
            attendance: normalized.attendance || null,
            positives: Array.isArray(normalized.positives) ? normalized.positives : [],
            incidents: Array.isArray(normalized.incidents) ? normalized.incidents : [],
            comments: Array.isArray(normalized.comments) ? normalized.comments : []
        };

        annotationsByClass[activityId].annotations.push(annotationEntry);
        studentEntries.push({ ...annotationEntry, activityId });

        if (annotationEntry.attendance && attendanceCounts[annotationEntry.attendance] !== undefined) {
            attendanceCounts[annotationEntry.attendance] += 1;
        }
        positivesTotal += annotationEntry.positives.length;
        incidentsTotal += annotationEntry.incidents.length;
        commentsTotal += annotationEntry.comments.length;
    });

    for (const activityId in annotationsByClass) {
        annotationsByClass[activityId].annotations.sort((a, b) => b.date - a.date);
    }

    const annotationClasses = Object.entries(annotationsByClass).sort(([, a], [, b]) => a.name.localeCompare(b.name));

    const totalEntries = studentEntries.length;
    const attendanceSessions = Object.values(attendanceCounts).reduce((sum, value) => sum + value, 0);

    const validFilters = ['all', 'positive', 'comment', 'incident'];
    const timelineFilter = validFilters.includes(state.studentTimelineFilter) ? state.studentTimelineFilter : 'all';
    state.studentTimelineFilter = timelineFilter;

    const classSelectorOptions = annotationClasses.map(([activityId, classData]) =>
        `<option value="${activityId}">${classData.name}</option>`
    ).join('');

    const classSelectorHtml = annotationClasses.length > 0 ? `
        <div class="mb-4 no-print">
            <label for="annotation-class-nav" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('quick_nav_to_class')}</label>
            <select id="annotation-class-nav"
                    onchange="if(this.value) { document.getElementById('annotation-block-' + this.value).scrollIntoView({ behavior: 'smooth', block: 'start' }); }"
                    class="mt-1 block w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
                <option value="">-- ${t('choose_a_class')} --</option>
                ${classSelectorOptions}
            </select>
        </div>
    ` : '';

    const baseFilterBtnClass = 'px-3 py-1.5 rounded-full text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600';
    const inactiveFilterBtnClass = 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700';
    const activeFilterBtnClass = 'bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500';

    const filterButtonsHtml = [
        { key: 'all', label: `${t('student_records_filter_all')} (${totalEntries})` },
        { key: 'positive', label: `${t('student_records_filter_positive')} (${positivesTotal})` },
        { key: 'comment', label: `${t('student_records_filter_comment')} (${commentsTotal})` },
        { key: 'incident', label: `${t('student_records_filter_incident')} (${incidentsTotal})` }
    ].map(filter => {
        const isActive = timelineFilter === filter.key;
        const classes = `${baseFilterBtnClass} ${isActive ? activeFilterBtnClass : inactiveFilterBtnClass}`;
        return `<button type="button" data-action="set-student-timeline-filter" data-filter="${filter.key}" class="${classes}" aria-pressed="${isActive}">${filter.label}</button>`;
    }).join('');

    const formatPercentage = (count) => {
        if (!attendanceSessions) return '0';
        const value = (count / attendanceSessions) * 100;
        return value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
    };

    const attendanceSummaryHtml = attendanceSessions > 0
        ? attendanceMeta.map(meta => {
            const count = attendanceCounts[meta.status] || 0;
            return `
                <p class="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${meta.badgeClasses}">
                        <i data-lucide="${meta.icon}" class="w-3 h-3"></i>
                        ${meta.label}
                    </span>
                    <span>${formatPercentage(count)}% (${count})</span>
                </p>
            `;
        }).join('')
        : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('attendance_summary_no_data')}</p>`;

    const recordsSummaryHtml = `
        <div class="mb-4">
            <div class="p-4 bg-gray-100 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg space-y-4">
                <div>
                    <p class="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">${t('student_records_summary_title')}</p>
                    <div class="flex flex-wrap gap-2">${filterButtonsHtml}</div>
                </div>
                <div>
                    <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold mb-2">${t('attendance_summary_title')}</p>
                    <div class="space-y-1">${attendanceSummaryHtml}</div>
                </div>
            </div>
        </div>
    `;

    const formatRecordTimestamp = (record) => {
        if (!record?.createdAt) return '';
        const recordDate = new Date(record.createdAt);
        if (Number.isNaN(recordDate.getTime())) return '';
        return recordDate.toLocaleString(locale, { hour: '2-digit', minute: '2-digit' });
    };

    const annotationsTimelineHtml = annotationClasses.map(([activityId, classData]) => {
        const filteredAnnotations = classData.annotations.filter(item => {
            if (timelineFilter === 'positive') {
                return item.positives.length > 0;
            }
            if (timelineFilter === 'incident') {
                return item.incidents.length > 0;
            }
            if (timelineFilter === 'comment') {
                return item.comments.length > 0;
            }
            return true;
        });

        if (filteredAnnotations.length === 0) {
            return '';
        }

        return `
            <div id="annotation-block-${activityId}" class="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-4">
                <h4 class="flex items-center gap-2 mb-3 text-md font-semibold">
                    <span class="w-4 h-4 rounded-full" style="background-color: ${classData.color};"></span>
                    <span>${classData.name}</span>
                </h4>
                <div class="space-y-3 pl-6 border-l-2 border-gray-200 dark:border-gray-600">
                ${filteredAnnotations.map(item => {
                    const attendanceInfo = item.attendance ? (() => {
                        const meta = attendanceMeta.find(opt => opt.status === item.attendance);
                        if (!meta) return '';
                        return `
                            <div class="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
                                <span class="font-semibold">${t('attendance_record_label')}</span>
                                <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold ${meta.badgeClasses}">
                                    <i data-lucide="${meta.icon}" class="w-3 h-3"></i>
                                    ${meta.label}
                                </span>
                            </div>
                        `;
                    })() : '';

                    const positivesSection = item.positives.length > 0 ? `
                        <div class="space-y-1">
                            <p class="text-xs font-semibold text-green-700 dark:text-green-300 flex items-center gap-1">
                                <i data-lucide="shield-plus" class="w-3 h-3"></i>
                                ${t('positive_record_label')}
                            </p>
                            <ul class="space-y-1">
                                ${item.positives.map(record => `
                                    <li>
                                        <button type="button" data-action="edit-positive-record" data-entry-id="${item.entryId}" data-student-id="${student.id}" data-record-id="${record.id}" class="w-full text-left bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/40 rounded-md p-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-green-100 dark:hover:bg-green-900/30 focus:outline-none focus:ring-2 focus:ring-green-400/60">
                                            <p>${record.content}</p>
                                            ${formatRecordTimestamp(record) ? `<p class="text-[10px] text-green-600 dark:text-green-300 mt-1">${formatRecordTimestamp(record)}</p>` : ''}
                                        </button>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : '';

                    const commentsSection = item.comments.length > 0 ? `
                        <div class="space-y-1">
                            <p class="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1">
                                <i data-lucide="message-square-more" class="w-3 h-3"></i>
                                ${t('comment_record_label')}
                            </p>
                            <ul class="space-y-1">
                                ${item.comments.map(record => `
                                    <li>
                                        <button type="button" data-action="edit-comment-record" data-entry-id="${item.entryId}" data-student-id="${student.id}" data-record-id="${record.id}" class="w-full text-left bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-md p-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-900/30 focus:outline-none focus:ring-2 focus:ring-blue-400/60">
                                            <p>${record.content}</p>
                                            ${formatRecordTimestamp(record) ? `<p class="text-[10px] text-blue-600 dark:text-blue-300 mt-1">${formatRecordTimestamp(record)}</p>` : ''}
                                        </button>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : '';

                    const incidentsSection = item.incidents.length > 0 ? `
                        <div class="space-y-1">
                            <p class="text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-1">
                                <i data-lucide="shield-alert" class="w-3 h-3"></i>
                                ${t('incident_record_label')}
                            </p>
                            <ul class="space-y-1">
                                ${item.incidents.map(record => `
                                    <li>
                                        <button type="button" data-action="edit-incident-record" data-entry-id="${item.entryId}" data-student-id="${student.id}" data-record-id="${record.id}" class="w-full text-left bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 rounded-md p-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-red-100 dark:hover:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-400/60">
                                            <p>${record.content}</p>
                                            ${formatRecordTimestamp(record) ? `<p class="text-[10px] text-red-600 dark:text-red-300 mt-1">${formatRecordTimestamp(record)}</p>` : ''}
                                        </button>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : '';

                    return `
                        <div class="relative space-y-2">
                            <span class="absolute -left-[31px] top-1 h-4 w-4 rounded-full bg-gray-300 dark:bg-gray-500 border-4 border-gray-50 dark:border-gray-700/50"></span>
                            <p class="text-xs text-gray-500 dark:text-gray-400">${item.date.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                            ${attendanceInfo}
                            ${positivesSection}
                            ${commentsSection}
                            ${incidentsSection}
                        </div>
                    `;
                }).join('')}
                </div>
            </div>
        `;
    }).filter(Boolean).join('');

    const annotationsHistoryContent = annotationsTimelineHtml || `<p class="text-gray-500 dark:text-gray-400">${t('no_session_notes')}</p>`;

    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full">
            <div class="hidden sm:flex justify-between items-center mb-6 no-print">
                <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200">${t('student_detail_view_title')}</h2>
                <div class="flex items-center gap-2">
                     <button data-action="export-student-docx" class="bg-blue-800 text-white px-4 py-2 rounded-md hover:bg-blue-900 flex items-center gap-2">
                        <i data-lucide="file-text"></i> ${t('export_to_docx')}
                    </button>
                     <button data-action="print-student-sheet" class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2">
                        <i data-lucide="printer"></i> ${t('print')}
                    </button>
                    <button data-action="back-to-classes" class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center gap-2">
                        <i data-lucide="arrow-left"></i> ${t('back')}
                    </button>
                </div>
            </div>
            <div id="student-sheet-content" class="printable-area bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-lg shadow-md max-w-4xl mx-auto">
                <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-6 print:block hidden">${student.name}</h2>
                <div class="space-y-6">
                    <div>
                        <label for="edit-student-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('student_name_label')}</label>
                        <input type="text" id="edit-student-name" data-action="edit-student-name" data-student-id="${student.id}" value="${student.name}" class="mt-1 block w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
                    </div>

                    <div>
                        <label for="edit-student-notes" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('general_notes_label')}</label>
                        <textarea id="edit-student-notes" data-action="edit-student-notes" data-student-id="${student.id}" placeholder="${t('general_notes_placeholder')}" class="mt-1 block w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 h-32">${student.generalNotes || ''}</textarea>
                    </div>
                    <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
                        <h3 class="text-lg font-medium text-gray-900 dark:text-gray-200 mb-3">${t('session_notes_history_title')}</h3>
                        ${classSelectorHtml}
                        ${recordsSummaryHtml}
                        <div class="space-y-4 pr-2">${annotationsHistoryContent}</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderCompetencyDetailView() {
    renderMobileHeaderActions([
        { action: 'back-to-competencies', label: t('back_to_competencies'), icon: 'arrow-left' }
    ]);

    const selection = state.selectedCompetency;
    if (!selection) {
        return `<div class="p-6"><p class="text-red-500">${t('competency_not_found')}</p><button data-action="back-to-competencies" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md">${t('back_to_competencies')}</button></div>`;
    }

    const activity = state.activities.find(a => a.id === selection.activityId);
    if (!activity) {
        return `<div class="p-6"><p class="text-red-500">${t('competency_not_found')}</p><button data-action="back-to-competencies" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md">${t('back_to_competencies')}</button></div>`;
    }

    const competency = activity.competencies?.find(c => c.id === selection.competencyId);
    if (!competency) {
        return `<div class="p-6"><p class="text-red-500">${t('competency_not_found')}</p><button data-action="back-to-competencies" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md">${t('back_to_competencies')}</button></div>`;
    }

    const criteria = competency.criteria || [];

    const criteriaHtml = criteria.length > 0
        ? criteria.map(criterion => `
            <div class="border border-gray-200 dark:border-gray-700 rounded-md p-4 space-y-3">
                <div class="flex items-start gap-2">
                    <div class="flex-1">
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('criterion_identifier_label')}</label>
                        <input type="text" value="${criterion.code || ''}" data-action="update-criterion-code" data-activity-id="${activity.id}" data-competency-id="${competency.id}" data-criterion-id="${criterion.id}" placeholder="${t('criterion_identifier_placeholder')}" class="mt-1 block w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                    </div>
                    <button data-action="delete-criterion" data-activity-id="${activity.id}" data-competency-id="${competency.id}" data-criterion-id="${criterion.id}" class="text-red-500 hover:text-red-700 mt-6"><i data-lucide="trash-2" class="w-5 h-5"></i></button>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('criterion_description_label')}</label>
                    <textarea data-action="update-criterion-description" data-activity-id="${activity.id}" data-competency-id="${competency.id}" data-criterion-id="${criterion.id}" placeholder="${t('criterion_description_placeholder')}" class="mt-1 block w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md h-20">${criterion.description || ''}</textarea>
                </div>
            </div>
        `).join('')
        : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('no_criteria_defined')}</p>`;

    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full space-y-6">
            <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                    <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200">${competency.code || t('competency_identifier_label')}</h2>
                    <p class="text-gray-500 dark:text-gray-400">${t('competency_class_label')}: ${activity.name}</p>
                </div>
                <div class="flex flex-col sm:flex-row gap-2">
                    <button data-action="back-to-competencies" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center gap-2"><i data-lucide="arrow-left" class="w-4 h-4"></i>${t('back_to_competencies')}</button>
                    <button data-action="delete-competency" data-activity-id="${activity.id}" data-competency-id="${competency.id}" class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center gap-2"><i data-lucide="trash-2" class="w-4 h-4"></i>${t('delete_competency')}</button>
                </div>
            </div>
            <div class="grid lg:grid-cols-2 gap-6 items-stretch">
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4 h-full">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('competency_identifier_label')}</label>
                        <input type="text" value="${competency.code || ''}" data-action="update-competency-code" data-activity-id="${activity.id}" data-competency-id="${competency.id}" placeholder="${t('competency_identifier_placeholder')}" class="mt-1 block w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('competency_description_label')}</label>
                        <textarea data-action="update-competency-description" data-activity-id="${activity.id}" data-competency-id="${competency.id}" placeholder="${t('competency_description_placeholder')}" class="mt-1 block w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md h-32">${competency.description || ''}</textarea>
                    </div>
                </div>
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md flex flex-col h-full">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200">${t('criteria_list_title')}</h3>
                        <button data-action="add-criterion" data-activity-id="${activity.id}" data-competency-id="${competency.id}" class="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"><i data-lucide="plus" class="w-4 h-4"></i>${t('add_criterion')}</button>
                    </div>
                    <div class="space-y-4 overflow-y-auto pr-1 flex-1 min-h-0">
                        ${criteriaHtml}
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderSettingsView() {
    renderMobileHeaderActions([]);
    
    const tabs = [
        { id: 'calendar', labelKey: 'settings_tab_calendar', icon: 'calendar-days' },
        { id: 'schedule', labelKey: 'settings_tab_schedule', icon: 'clock' },
        { id: 'activities', labelKey: 'settings_tab_activities', icon: 'users' },
        { id: 'competencies', labelKey: 'settings_tab_competencies', icon: 'target' },
        { id: 'evaluation', labelKey: 'settings_tab_evaluation', icon: 'list-checks' },
        { id: 'data', labelKey: 'settings_tab_data', icon: 'database' }
    ];

    const tabButtonsHtml = tabs.map(tab => {
        const isActive = state.settingsActiveTab === tab.id;
        return `
            <button 
                data-action="select-settings-tab" 
                data-tab-id="${tab.id}" 
                class="flex-1 sm:flex-initial sm:flex-grow-0 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors
                ${isActive ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
            >
                <i data-lucide="${tab.icon}" class="w-5 h-5"></i>
                <span class="hidden sm:inline">${t(tab.labelKey)}</span>
            </button>
        `;
    }).join('');

    // --- Calendar Tab Content ---
    const termsHtml = state.terms.map(term => `
        <div class="p-3 border border-gray-200 dark:border-gray-600 rounded-md">
            <div class="flex justify-between items-center">
                <div>
                    <p class="font-semibold">${term.name}</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">${new Date(term.startDate+'T00:00:00').toLocaleDateString(document.documentElement.lang)} - ${new Date(term.endDate+'T00:00:00').toLocaleDateString(document.documentElement.lang)}</p>
                </div>
                <button data-action="delete-term" data-id="${term.id}" class="text-red-500 hover:text-red-700"><i data-lucide="trash-2" class="w-5 h-5"></i></button>
            </div>
        </div>
    `).join('');

    const holidaysHtml = state.holidays.map(holiday => `
        <div class="p-3 border border-gray-200 dark:border-gray-600 rounded-md flex justify-between items-center">
            <div>
                <p class="font-semibold">${holiday.name}</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                    ${new Date(holiday.startDate + 'T00:00:00').toLocaleDateString(document.documentElement.lang)}
                    ${holiday.endDate !== holiday.startDate ? ' - ' + new Date(holiday.endDate + 'T00:00:00').toLocaleDateString(document.documentElement.lang) : ''}
                </p>
            </div>
            <button data-action="delete-holiday" data-id="${holiday.id}" class="text-red-500 hover:text-red-700"><i data-lucide="trash-2" class="w-5 h-5"></i></button>
        </div>
    `).join('');

    const calendarTabContent = `
        <div class="grid lg:grid-cols-2 gap-8 items-start">
            <div class="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <h3 class="text-lg font-semibold mb-3">${t('course_dates_title')}</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('start_date')}</label>
                        <input type="date" data-action="update-course-date" data-type="start" value="${state.courseStartDate}" class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('end_date')}</label>
                        <input type="date" data-action="update-course-date" data-type="end" value="${state.courseEndDate}" class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                    </div>
                </div>
            </div>
            <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <h3 class="text-lg font-semibold mb-3">${t('terms_management_title')}</h3>
                <div class="space-y-4 p-4 border border-dashed dark:border-gray-600 rounded-md">
                    <input type="text" id="new-term-name" placeholder="${t('term_name_placeholder')}" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('start_date')}</label>
                            <input type="date" id="new-term-start" class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('end_date')}</label>
                            <input type="date" id="new-term-end" class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                        </div>
                    </div>
                    <button data-action="add-term" class="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center justify-center gap-2"><i data-lucide="plus" class="w-5 h-5"></i>${t('add_term')}</button>
                </div>
                <div class="space-y-3 mt-4">${termsHtml}</div>
            </div>
            <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <h3 class="text-lg font-semibold mb-3">${t('holidays_management_title')}</h3>
                <div class="space-y-4 p-4 border border-dashed dark:border-gray-600 rounded-md">
                    <input type="text" id="new-holiday-name" placeholder="${t('holiday_name_placeholder')}" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('start_date')}</label>
                            <input type="date" id="new-holiday-start" class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${t('end_date_optional')}</label>
                            <input type="date" id="new-holiday-end" class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                        </div>
                    </div>
                    <button data-action="add-holiday" class="w-full bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 flex items-center justify-center gap-2"><i data-lucide="plus" class="w-5 h-5"></i>${t('add_holiday')}</button>
                </div>
                <div class="space-y-3 mt-4">${holidaysHtml}</div>
            </div>
        </div>
    `;

    // --- Schedule Tab Content ---
    const timeSlotsHtml = state.timeSlots.map((slot, index) => {
        if (state.editingTimeSlotId === slot.id) {
            return `
            <div class="flex justify-between items-center bg-white dark:bg-gray-700 p-2 rounded-md border border-blue-500">
                <input type="text" data-action="edit-timeslot-input" value="${slot.label}" class="flex-grow p-1 border-0 bg-transparent rounded-md focus:ring-0">
                <div class="flex items-center gap-2">
                    <button data-action="save-timeslot" data-id="${slot.id}" class="text-green-600 hover:text-green-800"><i data-lucide="check" class="w-5 h-5"></i></button>
                    <button data-action="cancel-edit-timeslot" class="text-red-600 hover:text-red-800"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>
            </div>`;
        }
        return `
            <div class="flex justify-between items-center bg-gray-100 dark:bg-gray-700 p-2 rounded-md">
                <span class="flex-grow cursor-pointer" data-action="edit-timeslot" data-id="${slot.id}">${slot.label}</span>
                <div class="flex items-center gap-2">
                    <button data-action="reorder-timeslot" data-index="${index}" data-direction="up" ${index === 0 ? 'disabled' : ''} class="disabled:opacity-25 disabled:cursor-not-allowed text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"><i data-lucide="chevron-up" class="w-5 h-5"></i></button>
                    <button data-action="reorder-timeslot" data-index="${index}" data-direction="down" ${index === state.timeSlots.length - 1 ? 'disabled' : ''} class="disabled:opacity-25 disabled:cursor-not-allowed text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"><i data-lucide="chevron-down" class="w-5 h-5"></i></button>
                    <button data-action="delete-timeslot" data-id="${slot.id}" class="text-red-500 hover:text-red-700"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </div>
            </div>`;
    }).join('');
    
    const scheduleSelectableActivities = state.activities.filter(act => !(act.type === 'class' && act.isTemplate));

    const scheduleTableRows = state.timeSlots.map(time => {
        const cells = DAY_KEYS.map(day => `
            <td class="p-1 border border-gray-200 dark:border-gray-700">
                <select data-action="schedule-change" data-day="${day}" data-time="${time.label}" class="w-full p-1 border-0 rounded-md focus:ring-1 focus:ring-blue-500 text-xs bg-white dark:bg-gray-700">
                    <option value="">${t('free')}</option>
                    ${scheduleSelectableActivities.map(act => `<option value="${act.id}" ${state.schedule[`${day}-${time.label}`] === act.id ? 'selected' : ''}>${act.name}</option>`).join('')}
                </select>
            </td>
        `).join('');
        return `<tr><td class="p-2 border border-gray-200 dark:border-gray-700 font-mono bg-gray-50 dark:bg-gray-800">${time.label}</td>${cells}</tr>`;
    }).join('');
    
    const scheduleOverridesHtml = state.scheduleOverrides.map(ov => {
        const activity = state.activities.find(a => a.id === ov.activityId);
        return `
            <div class="text-sm p-2 bg-gray-100 dark:bg-gray-700 rounded-md flex justify-between items-center">
                <div>
                    <span class="font-semibold">${t(ov.day.toLowerCase())} ${ov.time}</span> <i data-lucide="arrow-right" class="inline-block w-4 h-4"></i> <span class="font-semibold">${activity ? activity.name : 'Clase eliminada'}</span>
                    <div class="text-xs text-gray-600 dark:text-gray-400">${ov.startDate} a ${ov.endDate}</div>
                </div>
                <button data-action="delete-schedule-override" data-id="${ov.id}" class="text-red-500 hover:text-red-700"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
        `
    }).join('');

    const scheduleTabContent = `
        <div class="grid lg:grid-cols-2 gap-8 items-start">
            <div class="space-y-8">
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                    <h3 class="text-lg font-semibold mb-3 flex items-center gap-2"><i data-lucide="wand-2" class="w-5 h-5"></i> ${t('schedule_generator_title')}</h3>
                    <div class="grid grid-cols-2 gap-4">
                        <div><label class="block text-sm font-medium">${t('start_time')}</label><input type="time" id="gen-start-time" value="08:00" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"></div>
                        <div><label class="block text-sm font-medium">${t('end_time')}</label><input type="time" id="gen-end-time" value="17:00" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"></div>
                        <div><label class="block text-sm font-medium">${t('class_duration_min')}</label><input type="number" id="gen-class-duration" value="60" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"></div>
                        <div><label class="block text-sm font-medium">${t('break_duration_min')}</label><input type="number" id="gen-break-duration" value="30" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"></div>
                        <div class="col-span-2"><label class="block text-sm font-medium">${t('break_start_time_optional')}</label><input type="time" id="gen-break-start" value="11:00" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"></div>
                    </div>
                    <button data-action="generate-schedule-slots" class="mt-4 w-full bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 flex items-center justify-center gap-2">${t('generate_slots')}</button>
                </div>
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                    <h3 class="text-lg font-semibold mb-3 flex items-center gap-2"><i data-lucide="clock" class="w-5 h-5"></i> ${t('timeslots_management_title')}</h3>
                    <div class="flex gap-2 mb-4">
                        <input type="text" id="new-timeslot-label" placeholder="${t('timeslot_placeholder')}" class="flex-grow p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"/>
                        <button data-action="add-timeslot" class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2"><i data-lucide="plus-circle" class="w-5 h-5"></i>${t('add')}</button>
                    </div>
                    <div class="space-y-2">${timeSlotsHtml}</div>
                </div>
            </div>
            <div class="space-y-8">
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                    <h3 class="text-lg font-semibold mb-3">${t('weekly_schedule_config_title')}</h3>
                    <div class="overflow-x-auto">
                        <table class="w-full border-collapse text-sm">
                            <thead><tr class="bg-gray-100 dark:bg-gray-900"><th class="p-2 border border-gray-200 dark:border-gray-700">${t('hour')}</th>${DAY_KEYS.map(day => `<th class="p-2 border border-gray-200 dark:border-gray-700">${t(day.toLowerCase())}</th>`).join('')}</tr></thead>
                            <tbody>${scheduleTableRows}</tbody>
                        </table>
                    </div>
                </div>
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                    <h3 class="text-lg font-semibold mb-3">${t('schedule_overrides_title')}</h3>
                    <div class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div><label class="block text-sm font-medium">${t('day')}</label><select id="override-day" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">${DAY_KEYS.map(day => `<option value="${day}">${t(day.toLowerCase())}</option>`).join('')}</select></div>
                            <div><label class="block text-sm font-medium">${t('timeslot')}</label><select id="override-time" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">${state.timeSlots.map(t => `<option>${t.label}</option>`).join('')}</select></div>
                        </div>
                        <div><label class="block text-sm font-medium">${t('replace_with')}</label><select id="override-activity" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">${scheduleSelectableActivities.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select></div>
                        <div class="grid grid-cols-2 gap-4">
                            <div><label class="block text-sm font-medium">${t('from_date')}</label><input type="date" id="override-start-date" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"></div>
                            <div><label class="block text-sm font-medium">${t('until_date')}</label><input type="date" id="override-end-date" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"></div>
                        </div>
                        <button data-action="add-schedule-override" class="w-full bg-orange-500 text-white px-4 py-2 rounded-md hover:bg-orange-600">${t('add_override')}</button>
                    </div>
                    <div class="mt-6 space-y-2">${scheduleOverridesHtml}</div>
                </div>
            </div>
        </div>
    `;

    // --- Activities Tab Content ---
    const templateClasses = state.activities
        .filter(act => act.type === 'class' && act.isTemplate)
        .sort((a, b) => a.name.localeCompare(b.name));
    const templateMap = new Map(templateClasses.map(tpl => [tpl.id, tpl]));
    const activitiesList = [...state.activities].sort((a, b) => {
        if (a.type === b.type) {
            if (a.type === 'class' && b.type === 'class') {
                if (Boolean(a.isTemplate) !== Boolean(b.isTemplate)) {
                    return a.isTemplate ? -1 : 1;
                }
            }
            return a.name.localeCompare(b.name);
        }
        if (a.type === 'class') return -1;
        if (b.type === 'class') return 1;
        return a.name.localeCompare(b.name);
    });

    const activitiesHtml = activitiesList.map(act => {
        const isClass = act.type === 'class';
        const isTemplate = isClass && Boolean(act.isTemplate);
        const parentTemplate = isClass && !isTemplate ? templateMap.get(act.templateId) : null;

        let studentsInClassHtml = '';
        if (isClass && !isTemplate) {
            const enrolledStudents = state.students
                .filter(s => act.studentIds?.includes(s.id))
                .sort(sortStudentsByName);

            const enrolledStudentsHtml = enrolledStudents.map(student => `
                <div class="flex items-center justify-between bg-gray-100 dark:bg-gray-700 p-2 rounded-md text-sm">
                    <button data-action="select-student" data-student-id="${student.id}" class="text-left font-medium text-blue-600 dark:text-blue-400 hover:underline flex-grow">${student.name}</button>
                    <button data-action="remove-student-from-class" data-activity-id="${act.id}" data-student-id="${student.id}" class="text-red-500 hover:text-red-700 ml-2 flex-shrink-0"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>
            `).join('');

            const availableStudents = state.students
                .filter(s => !act.studentIds?.includes(s.id))
                .sort(sortStudentsByName);

            const availableStudentsOptions = availableStudents.map(student => `<option value="${student.id}">${student.name}</option>`).join('');

            studentsInClassHtml = `
                <div class="mt-3 space-y-3">
                    <div>
                        <h4 class="text-sm font-medium mb-2">${t('students_in_this_class')}</h4>
                        <div class="space-y-2">
                            ${enrolledStudents.length > 0 ? enrolledStudentsHtml : `<p class="text-xs text-gray-500 dark:text-gray-400">${t('no_students_assigned_short')}</p>`}
                        </div>
                    </div>
                    <div class="border-t border-gray-200 dark:border-gray-700 pt-3">
                        <h4 class="text-sm font-medium mb-2">${t('add_existing_student')}</h4>
                        <div class="flex gap-2">
                            <select id="add-student-select-${act.id}" class="flex-grow p-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700">
                                <option value="">${t('select_student')}</option>
                                ${availableStudentsOptions}
                            </select>
                            <button data-action="add-selected-student-to-class" data-activity-id="${act.id}" class="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 flex-shrink-0"><i data-lucide="plus" class="w-5 h-5"></i></button>
                        </div>
                    </div>
                </div>
            `;
        }

        const badgeHtml = isTemplate
            ? `<span class="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 px-2 py-1 rounded-full">${t('template_group_badge')}</span>`
            : '';

        const templateInfoView = isClass
            ? `<div class="mt-2 text-xs text-gray-600 dark:text-gray-400 space-y-1">
                    <div>${t('template_group_label')}: <span class="font-semibold">${parentTemplate ? parentTemplate.name : t('template_group_none')}</span></div>
                    ${isTemplate ? `<div class="text-blue-600 dark:text-blue-300">${t('template_group_template_notice')}</div>` : parentTemplate ? `<div>${t('template_group_inherited_notice')}</div>` : ''}
               </div>`
            : '';

        if (state.editingActivityId === act.id) {
            const availableTemplateOptions = templateClasses
                .filter(tpl => tpl.id !== act.id)
                .map(tpl => `<option value="${tpl.id}" ${act.templateId === tpl.id ? 'selected' : ''}>${tpl.name}</option>`)
                .join('');
            const templateControls = isClass
                ? (isTemplate
                    ? `<p class="mt-4 text-xs text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 px-3 py-2 rounded-md">${t('template_group_template_notice')}</p>`
                    : `<div class="mt-4">
                            <label class="block text-sm font-medium text-gray-600 dark:text-gray-300">${t('assign_template_group')}</label>
                            <select data-action="update-class-template" data-event="change" data-activity-id="${act.id}" class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm">
                                <option value="">${t('template_group_none')}</option>
                                ${availableTemplateOptions}
                            </select>
                            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">${t('template_group_cascade_hint')}</p>
                            ${parentTemplate ? `<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${t('template_group_inherited_notice')}</p>` : ''}
                        </div>`)
                : '';

            return `
            <div id="edit-activity-form-${act.id}" class="p-4 border rounded-md bg-white dark:bg-gray-700 border-blue-500">
                <div class="flex justify-between items-center gap-2">
                    <div class="flex items-center gap-2 flex-grow">
                        <input type="color" data-action="change-activity-color" data-id="${act.id}" value="${act.color}" class="p-0 border-none rounded-full cursor-pointer w-7 h-7">
                        <input type="text" id="edit-activity-name-${act.id}" value="${act.name}" class="flex-grow p-1 border-0 bg-transparent rounded-md focus:ring-0 font-semibold">
                        ${badgeHtml}
                    </div>
                    <div class="flex items-center gap-2">
                        <button data-action="save-activity" data-id="${act.id}" class="text-green-600 hover:text-green-800"><i data-lucide="check" class="w-5 h-5"></i></button>
                        <button data-action="cancel-edit-activity" class="text-red-600 hover:text-red-800"><i data-lucide="x" class="w-5 h-5"></i></button>
                    </div>
                </div>
                <div class="mt-4 grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <label class="block font-medium text-gray-600 dark:text-gray-300">${t('start_date')}</label>
                        <input type="date" id="edit-activity-start-${act.id}" value="${act.startDate || ''}" class="w-full p-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md">
                    </div>
                    <div>
                        <label class="block font-medium text-gray-600 dark:text-gray-300">${t('end_date')}</label>
                        <input type="date" id="edit-activity-end-${act.id}" value="${act.endDate || ''}" class="w-full p-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md">
                    </div>
                </div>
                ${templateControls}
                ${studentsInClassHtml}
            </div>`;
        }

        return `
        <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-md">
            <div class="flex justify-between items-start gap-2">
                <div class="flex items-center gap-2 flex-grow">
                   <input type="color" data-action="change-activity-color" data-id="${act.id}" value="${act.color}" class="p-0 border-none rounded-full cursor-pointer w-7 h-7">
                   <span class="font-semibold cursor-pointer" data-action="edit-activity" data-id="${act.id}">${act.name} <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(${isClass ? (isTemplate ? t('template_group_badge') : t('class')) : t('general')})</span></span>
                   ${badgeHtml}
                </div>
                <button data-action="delete-activity" data-id="${act.id}" class="text-red-500 hover:text-red-700 ml-2"><i data-lucide="trash-2" class="w-5 h-5"></i></button>
            </div>
            ${templateInfoView}
            ${studentsInClassHtml}
        </div>`;
    }).join('');

    const activitiesTabContent = `
        <div class="grid lg:grid-cols-2 gap-8 items-start">
            <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <h3 class="text-lg font-semibold mb-3">${t('activities_management_title')}</h3>
                <div class="flex gap-2 mb-2">
                    <input type="text" id="new-activity-name" placeholder="${t('activity_name_placeholder')}" class="flex-grow p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"/>
                    <button data-action="add-activity" class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center gap-2"><i data-lucide="plus-circle" class="w-5 h-5"></i>${t('add')}</button>
                </div>
                <div class="flex flex-wrap gap-4 mb-4 text-sm">
                    <label class="flex items-center gap-2"><input type="radio" name="activityType" value="class" checked class="form-radio text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>${t('activity_type_class')}</label>
                    <label class="flex items-center gap-2"><input type="radio" name="activityType" value="template" class="form-radio text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>${t('activity_type_template')}</label>
                    <label class="flex items-center gap-2"><input type="radio" name="activityType" value="general" class="form-radio text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>${t('activity_type_general')}</label>
                </div>
                <div class="space-y-3 max-h-96 overflow-y-auto pr-2">${activitiesHtml}</div>
            </div>
            <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <h3 class="text-lg font-semibold mb-3 flex items-center gap-2"><i data-lucide="clipboard-paste" class="w-5 h-5"></i> ${t('quick_import_title')}</h3>
                <div class="space-y-4">
                    <div><label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t('step1_select_class')}</label><select id="import-target-class" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"><option value="">${t('choose_a_class')}</option>${state.activities.filter(a => a.type === 'class' && !a.isTemplate).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
                    <div><label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t('step2_paste_list')}</label><textarea id="student-list-text" placeholder="Juan Pérez\nMaría García\n..." class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md h-32"></textarea></div>
                    <button data-action="import-students" class="w-full bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 flex items-center justify-center gap-2"><i data-lucide="upload" class="w-5 h-5"></i> ${t('import_students')}</button>
                </div>
            </div>
        </div>
    `;

    // --- Competencies Tab Content ---
    const classesWithStudents = state.activities.filter(a => a.type === 'class').sort((a, b) => a.name.localeCompare(b.name));

    const competencySelectOptions = classesWithStudents.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    const competencyCardsHtml = classesWithStudents.map(c => {
        const competencies = c.competencies || [];
        const competencyCount = competencies.length;
        const isTemplate = Boolean(c.isTemplate);
        const parentTemplate = !isTemplate ? templateMap.get(c.templateId) : null;
        const badgeHtml = isTemplate
            ? `<span class="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 px-2 py-1 rounded-full">${t('template_group_badge')}</span>`
            : '';
        const templateInfo = isTemplate
            ? `<p class="text-xs text-blue-600 dark:text-blue-300 mt-1">${t('template_group_template_notice')}</p>`
            : parentTemplate
                ? `<p class="text-xs text-gray-600 dark:text-gray-400 mt-1">${t('template_group_label')}: <span class="font-semibold">${parentTemplate.name}</span> · ${t('template_group_inherited_notice')}</p>`
                : `<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${t('template_group_label')}: <span class="font-semibold">${t('template_group_none')}</span></p>`;

        const competenciesHtml = competencies.map(comp => `
            <button
                data-action="select-competency"
                data-activity-id="${c.id}"
                data-competency-id="${comp.id}"
                class="w-full text-left p-3 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
                <div class="flex items-center justify-between gap-2">
                    <span class="font-semibold">${comp.code || t('competency_without_code')}</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <i data-lucide="list-checks" class="w-4 h-4"></i>
                        ${(comp.criteria?.length || 0)} ${t('criteria_label')}
                    </span>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-300 mt-1">${comp.description || t('competency_without_description')}</p>
            </button>
        `).join('');

        const isExpanded = Array.isArray(state.expandedCompetencyClassIds)
            ? state.expandedCompetencyClassIds.includes(c.id)
            : false;
        const toggleIcon = isExpanded ? 'chevron-up' : 'chevron-down';
        const toggleLabel = isExpanded ? t('hide_competency_list') : t('show_competency_list');
        const listContainerClasses = isExpanded
            ? 'p-4 flex flex-col gap-4 flex-grow'
            : 'p-4 flex flex-col gap-4 flex-grow hidden';

        return `
            <div id="competency-card-${c.id}" class="bg-white dark:bg-gray-800 rounded-lg shadow-md flex flex-col">
                <div class="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-t-lg flex flex-col gap-3">
                    <div class="flex items-center gap-2">
                        <h3 class="text-xl font-bold flex-grow" style="color: ${darkenColor(c.color, 40)}">${c.name}</h3>
                        ${badgeHtml}
                    </div>
                    ${templateInfo}
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div class="flex items-end gap-3 flex-wrap">
                            <button data-action="add-competency" data-activity-id="${c.id}" class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-800">
                                <i data-lucide="plus" class="w-5 h-5"></i>
                                <span class="sr-only">${t('add_competency')}</span>
                            </button>
                            <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                <i data-lucide="target" class="w-4 h-4"></i>
                                <span>${competencyCount} ${t('competencies_short_label')}</span>
                            </div>
                        </div>
                        <button
                            data-action="toggle-competency-list"
                            data-class-id="${c.id}"
                            aria-expanded="${isExpanded}"
                            aria-controls="competency-list-${c.id}"
                            class="inline-flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-300 hover:underline focus:outline-none"
                        >
                            <span>${toggleLabel}</span>
                            <i data-lucide="${toggleIcon}" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
                <div id="competency-list-${c.id}" class="${listContainerClasses}">
                    <div class="space-y-2 max-h-48 overflow-y-auto">
                        ${competenciesHtml || `<p class=\"text-sm text-gray-500 dark:text-gray-400\">${t('no_competencies_in_class')}</p>`}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const competenciesTabContent = classesWithStudents.length === 0
        ? `<div class="p-6 text-gray-500 dark:text-gray-400">${t('no_classes_created')}</div>`
        : `
            <div class="space-y-6">
                <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <h3 class="text-xl font-semibold text-gray-800 dark:text-gray-200">${t('competencies_tab_title')}</h3>
                    <div class="flex-shrink-0 w-full sm:w-64">
                        <label for="competency-quick-nav" class="sr-only">${t('quick_nav_to_class')}</label>
                        <select id="competency-quick-nav" data-action="go-to-competency-card" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md shadow-sm">
                            <option value="">${t('quick_nav_to_class')}</option>
                            ${competencySelectOptions}
                        </select>
                    </div>
                </div>
                <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    ${competencyCardsHtml}
                </div>
            </div>
        `;

    // --- Evaluation Tab Content ---
    const evaluationClasses = state.activities
        .filter(activity => activity.type === 'class')
        .sort((a, b) => a.name.localeCompare(b.name));

    let evaluationTabContent = '';
    if (evaluationClasses.length === 0) {
        evaluationTabContent = `
            <div class="p-6 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                ${t('evaluation_no_classes')}
            </div>
        `;
    } else {
        const availableIds = new Set(evaluationClasses.map(cls => cls.id));
        if (!state.settingsEvaluationSelectedClassId || !availableIds.has(state.settingsEvaluationSelectedClassId)) {
            state.settingsEvaluationSelectedClassId = evaluationClasses[0].id;
        }

        const selectedClassId = state.settingsEvaluationSelectedClassId;
        const evaluationClassOptions = evaluationClasses.map(cls => {
            const suffix = cls.isTemplate ? ` (${t('template_group_badge')})` : '';
            return `<option value="${cls.id}" ${cls.id === selectedClassId ? 'selected' : ''}>${escapeHtml(cls.name + suffix)}</option>`;
        }).join('');

        const draft = ensureEvaluationDraft(selectedClassId);
        const normalizedDraft = normalizeEvaluationConfig(draft || {});
        const fallbackNumericConfig = normalizeEvaluationConfig({}).numeric;
        const modality = draft?.modality || EVALUATION_MODALITIES.COMPETENCY;
        const validation = modality === EVALUATION_MODALITIES.NUMERIC
            ? validateNumericEvaluationConfig(draft || {})
            : validateCompetencyEvaluationConfig(draft || {});
        const feedback = state.evaluationSettingsFeedback?.[selectedClassId] || null;
        const saveDisabled = !validation.isValid;

        const levelLabelMap = {
            NP: t('evaluation_level_label_NP'),
            NA: t('evaluation_level_label_NA'),
            AS: t('evaluation_level_label_AS'),
            AN: t('evaluation_level_label_AN'),
            AE: t('evaluation_level_label_AE'),
        };

        const errorTranslationKey = {
            missing: 'evaluation_error_missing',
            negative: 'evaluation_error_negative',
            order: 'evaluation_error_order',
            min_scale: 'evaluation_error_min_scale',
            out_of_order: 'evaluation_error_out_of_order',
            invalid: 'evaluation_error_invalid',
        };

        const numericErrorTranslationKey = {
            ...errorTranslationKey,
            total_mismatch: 'evaluation_error_total_mismatch',
        };

        const validationSummaryItems = [];
        if (modality === EVALUATION_MODALITIES.COMPETENCY && draft && draft.competency) {
            COMPETENCY_LEVEL_IDS.forEach(levelId => {
                const code = validation.errors.levels[levelId];
                if (code) {
                    validationSummaryItems.push(`${levelLabelMap[levelId]} — ${t(errorTranslationKey[code])}`);
                }
            });
            ['AS', 'AN', 'AE'].forEach(minId => {
                const code = validation.errors.minimums[minId];
                if (code) {
                    validationSummaryItems.push(`${t(`evaluation_minimum_label_${minId}`)} — ${t(errorTranslationKey[code])}`);
                }
            });
            ['term', 'course'].forEach(scope => {
                const code = validation.errors.maxNotAchieved[scope];
                if (code) {
                    const label = scope === 'term'
                        ? t('evaluation_max_not_achieved_term')
                        : t('evaluation_max_not_achieved_course');
                    validationSummaryItems.push(`${label} — ${t(errorTranslationKey[code])}`);
                }
            });
            if (validation.errors.calculation.noEvidenceLevelId) {
                validationSummaryItems.push(`${t('evaluation_no_evidence_level_label')} — ${t(errorTranslationKey[validation.errors.calculation.noEvidenceLevelId])}`);
            }
        } else if (modality === EVALUATION_MODALITIES.NUMERIC && draft && draft.numeric) {
            const rawNumeric = draft.numeric || {};
            const rawCategories = Array.isArray(rawNumeric.categories) ? rawNumeric.categories : [];
            const categoryErrors = validation?.errors?.categories || {};
            const weightBasisError = validation?.errors?.weightBasis;

            normalizedDraft.numeric.categories.forEach((category, index) => {
                const rawCategory = rawCategories.find(item => item?.id === category.id) || category;
                const displayName = (typeof rawCategory.name === 'string' && rawCategory.name.trim())
                    ? rawCategory.name.trim()
                    : t('evaluation_numeric_category_fallback', { index: index + 1 });
                const errors = categoryErrors[category.id] || {};
                if (errors.name) {
                    validationSummaryItems.push(`${escapeHtml(displayName)} — ${t(errorTranslationKey[errors.name])}`);
                }
                if (errors.weight) {
                    validationSummaryItems.push(`${escapeHtml(displayName)} — ${t(errorTranslationKey[errors.weight])}`);
                }
            });

            if (weightBasisError) {
                validationSummaryItems.push(`${t('evaluation_numeric_weight_basis_label')} — ${t(errorTranslationKey[weightBasisError])}`);
            }

            (validation?.errors?.general || []).forEach(code => {
                const translationKey = numericErrorTranslationKey[code];
                if (translationKey) {
                    validationSummaryItems.push(t(translationKey));
                }
            });
        }

        const validationSummaryHtml = validationSummaryItems.length > 0
            ? `
                <div class="rounded-md border border-red-200 bg-red-50 dark:border-red-700 dark:bg-red-900/30 p-4">
                    <h4 class="text-sm font-semibold text-red-700 dark:text-red-200">${t('evaluation_validation_summary')}</h4>
                    <ul class="mt-2 space-y-1 list-disc list-inside text-sm text-red-600 dark:text-red-200">
                        ${validationSummaryItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                    </ul>
                </div>
            `
            : '';

        const feedbackClass = {
            success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-200',
            error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200',
            info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-200',
        };

        const feedbackHtml = feedback
            ? `
                <div class="rounded-md border px-4 py-3 text-sm ${feedbackClass[feedback.type] || feedbackClass.info}">
                    ${escapeHtml(feedback.message)}
                </div>
            `
            : '';

        const levelRowsHtml = normalizedDraft.competency.levels.map(level => {
            const rawLevel = draft?.competency?.levels?.find(l => l.id === level.id) || level;
            const inputValue = rawLevel.numericValue === '' || typeof rawLevel.numericValue === 'undefined'
                ? ''
                : rawLevel.numericValue;
            const errorCode = validation.errors.levels[level.id];
            const hasError = Boolean(errorCode);
            const errorMessage = hasError ? `${t(errorTranslationKey[errorCode])}` : '';
            const inputClasses = `mt-1 w-32 p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 ${hasError ? 'border-red-400 focus:ring-red-300 dark:border-red-600 dark:focus:ring-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}`;
            return `
                <tr>
                    <th scope="row" class="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200">${escapeHtml(levelLabelMap[level.id] || level.id)}</th>
                    <td class="px-4 py-3">
                        <input
                            type="number"
                            inputmode="decimal"
                            min="0"
                            step="0.1"
                            value="${inputValue === '' ? '' : escapeAttribute(inputValue)}"
                            data-action="update-competency-level-value"
                            data-class-id="${selectedClassId}"
                            data-level-id="${level.id}"
                            class="${inputClasses}"
                            aria-invalid="${hasError}"
                            aria-describedby="level-error-${level.id}"
                        />
                        ${hasError ? `<p id="level-error-${level.id}" class="mt-1 text-xs text-red-600 dark:text-red-300">${escapeHtml(errorMessage)}</p>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        const minimumFields = [
            { id: 'AS', label: t('evaluation_minimum_label_AS') },
            { id: 'AN', label: t('evaluation_minimum_label_AN') },
            { id: 'AE', label: t('evaluation_minimum_label_AE') },
        ];

        const minimumInputsHtml = minimumFields.map(field => {
            const rawValue = draft?.competency?.minimums?.[field.id];
            const inputValue = rawValue === '' || typeof rawValue === 'undefined' ? '' : rawValue;
            const errorCode = validation.errors.minimums[field.id];
            const hasError = Boolean(errorCode);
            const inputClasses = `mt-1 w-full p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 ${hasError ? 'border-red-400 focus:ring-red-300 dark:border-red-600 dark:focus:ring-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}`;
            return `
                <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300" for="minimum-${field.id}">${escapeHtml(field.label)}</label>
                    <input
                        id="minimum-${field.id}"
                        type="number"
                        inputmode="decimal"
                        min="0"
                        step="0.1"
                        value="${inputValue === '' ? '' : escapeAttribute(inputValue)}"
                        data-action="update-competency-minimum"
                        data-class-id="${selectedClassId}"
                        data-minimum-id="${field.id}"
                        class="${inputClasses}"
                        aria-invalid="${hasError}"
                    />
                    ${hasError ? `<p class="mt-1 text-xs text-red-600 dark:text-red-300">${escapeHtml(t(errorTranslationKey[errorCode]))}</p>` : ''}
                </div>
            `;
        }).join('');

        const maxFields = [
            { id: 'term', label: t('evaluation_max_not_achieved_term') },
            { id: 'course', label: t('evaluation_max_not_achieved_course') },
        ];

        const maxInputsHtml = maxFields.map(field => {
            const rawValue = draft?.competency?.maxNotAchieved?.[field.id];
            const inputValue = rawValue === '' || typeof rawValue === 'undefined' ? '' : rawValue;
            const errorCode = validation.errors.maxNotAchieved[field.id];
            const hasError = Boolean(errorCode);
            const inputClasses = `mt-1 w-full p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 ${hasError ? 'border-red-400 focus:ring-red-300 dark:border-red-600 dark:focus:ring-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}`;
            return `
                <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300" for="max-${field.id}">${escapeHtml(field.label)}</label>
                    <input
                        id="max-${field.id}"
                        type="number"
                        inputmode="numeric"
                        min="0"
                        step="1"
                        value="${inputValue === '' ? '' : escapeAttribute(inputValue)}"
                        data-action="update-competency-max-not-achieved"
                        data-class-id="${selectedClassId}"
                        data-scope="${field.id}"
                        class="${inputClasses}"
                        aria-invalid="${hasError}"
                    />
                    ${hasError ? `<p class="mt-1 text-xs text-red-600 dark:text-red-300">${escapeHtml(t(errorTranslationKey[errorCode]))}</p>` : ''}
                </div>
            `;
        }).join('');

        const aggregationOptions = [
            { value: COMPETENCY_AGGREGATIONS.WEIGHTED_AVERAGE, label: t('evaluation_aggregation_weighted') },
            { value: COMPETENCY_AGGREGATIONS.MAJORITY, label: t('evaluation_aggregation_majority') },
        ];

        const aggregationHtml = aggregationOptions.map(option => {
            const isChecked = normalizedDraft.competency.aggregation === option.value;
            return `
                <label class="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <input
                        type="radio"
                        name="evaluation-aggregation-${selectedClassId}"
                        value="${option.value}"
                        data-action="update-competency-aggregation"
                        data-class-id="${selectedClassId}"
                        ${isChecked ? 'checked' : ''}
                        class="mt-1 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <span>${escapeHtml(option.label)}</span>
                </label>
            `;
        }).join('');

        const noEvidenceBehavior = normalizedDraft.competency.calculation.noEvidenceBehavior;
        const noEvidenceSelectHtml = `
            <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300" for="no-evidence-behavior">${t('evaluation_no_evidence_behavior_label')}</label>
                <select
                    id="no-evidence-behavior"
                    data-action="set-evaluation-no-evidence-behavior"
                    data-class-id="${selectedClassId}"
                    class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm"
                >
                    <option value="${NO_EVIDENCE_BEHAVIOR.LOWEST_LEVEL}" ${noEvidenceBehavior === NO_EVIDENCE_BEHAVIOR.LOWEST_LEVEL ? 'selected' : ''}>${t('evaluation_no_evidence_lowest')}</option>
                    <option value="${NO_EVIDENCE_BEHAVIOR.SPECIFIC_LEVEL}" ${noEvidenceBehavior === NO_EVIDENCE_BEHAVIOR.SPECIFIC_LEVEL ? 'selected' : ''}>${t('evaluation_no_evidence_specific')}</option>
                </select>
            </div>
        `;

        const noEvidenceLevelSelect = noEvidenceBehavior === NO_EVIDENCE_BEHAVIOR.SPECIFIC_LEVEL
            ? `
                <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300" for="no-evidence-level">${t('evaluation_no_evidence_level_label')}</label>
                    <select
                        id="no-evidence-level"
                        data-action="set-evaluation-no-evidence-level"
                        data-class-id="${selectedClassId}"
                        class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm"
                    >
                        ${COMPETENCY_LEVEL_IDS.map(levelId => `
                            <option value="${levelId}" ${normalizedDraft.competency.calculation.noEvidenceLevelId === levelId ? 'selected' : ''}>${escapeHtml(levelLabelMap[levelId] || levelId)}</option>
                        `).join('')}
                    </select>
                    ${validation.errors.calculation.noEvidenceLevelId ? `<p class="mt-1 text-xs text-red-600 dark:text-red-300">${escapeHtml(t(errorTranslationKey[validation.errors.calculation.noEvidenceLevelId]))}</p>` : ''}
                </div>
            `
            : '';

        const npTreatmentOptions = [
            { value: NP_TREATMENTS.INCLUDE_AS_ZERO, label: t('evaluation_np_treatment_include') },
            { value: NP_TREATMENTS.EXCLUDE_FROM_AVERAGE, label: t('evaluation_np_treatment_exclude') },
        ];

        const npTreatmentSelectHtml = `
            <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300" for="np-treatment">${t('evaluation_np_treatment_label')}</label>
                <select
                    id="np-treatment"
                    data-action="set-evaluation-np-treatment"
                    data-class-id="${selectedClassId}"
                    class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm"
                >
                    ${npTreatmentOptions.map(option => `
                        <option value="${option.value}" ${normalizedDraft.competency.calculation.npTreatment === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>
                    `).join('')}
                </select>
            </div>
        `;

        const aeLevel = normalizedDraft.competency.levels.find(level => level.id === 'AE');
        const aeValue = aeLevel?.numericValue ?? 1;
        const weightedExample = calculateWeightedCompetencyResult([
            { levelId: 'AS', activityWeight: 0.6, criterionWeight: 1 },
            { levelId: 'AE', activityWeight: 0.4, criterionWeight: 1 },
        ], normalizedDraft);
        const weightedNumeric = Number.isFinite(weightedExample.numericScore) ? weightedExample.numericScore.toFixed(2) : '0.00';
        const weightedText = `${t('evaluation_help_example_weighted_prefix')} 60% ${levelLabelMap.AS} + 40% ${levelLabelMap.AE} → ${weightedNumeric} / ${aeValue} (${levelLabelMap[weightedExample.levelId] || weightedExample.levelId})`;

        const majorityExample = calculateMajorityCompetencyResult([
            { levelId: 'AS' },
            { levelId: 'AS' },
            { levelId: 'AE' },
        ], normalizedDraft);
        const majorityText = `${t('evaluation_help_example_majority_prefix')} ${levelLabelMap.AS}, ${levelLabelMap.AS}, ${levelLabelMap.AE} → ${levelLabelMap[majorityExample.levelId] || majorityExample.levelId}`;

        const rawNumeric = draft?.numeric && typeof draft.numeric === 'object' ? draft.numeric : {};
        const rawNumericCategories = Array.isArray(rawNumeric.categories) ? rawNumeric.categories : [];
        const numericCategoryErrors = validation?.errors?.categories || {};
        const weightBasisError = validation?.errors?.weightBasis;
        const normalizedNumeric = normalizedDraft?.numeric && Array.isArray(normalizedDraft.numeric.categories)
            ? normalizedDraft.numeric
            : fallbackNumericConfig;
        const numericCategories = Array.isArray(normalizedNumeric.categories) && normalizedNumeric.categories.length > 0
            ? normalizedNumeric.categories
            : fallbackNumericConfig.categories;
        const basisRaw = typeof rawNumeric.weightBasis !== 'undefined'
            ? rawNumeric.weightBasis
            : normalizedNumeric.weightBasis;
        const basisValue = basisRaw === '' || typeof basisRaw === 'undefined' ? '' : basisRaw;
        const numericBasis = Number(basisValue);
        const hasBasis = basisValue !== '' && !Number.isNaN(numericBasis);
        const totalWeight = numericCategories.reduce((sum, category) => {
            const rawCategory = rawNumericCategories.find(item => item?.id === category.id) || category;
            const weightValue = typeof rawCategory.weight !== 'undefined' ? rawCategory.weight : category.weight;
            const numericWeight = Number(weightValue);
            return sum + (Number.isFinite(numericWeight) ? numericWeight : 0);
        }, 0);
        const weightTotalDisplay = Number.isFinite(totalWeight) ? totalWeight.toFixed(2) : '0.00';
        const basisDisplay = hasBasis && Number.isFinite(numericBasis) ? numericBasis.toFixed(2) : '—';
        const weightsMatch = hasBasis && Number.isFinite(numericBasis)
            ? Math.abs(totalWeight - numericBasis) <= 1e-2
            : false;
        const totalStatusClass = weightsMatch
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-amber-700 dark:text-amber-300';

        const numericCategoriesHtml = numericCategories.map((category, index) => {
            const rawCategory = rawNumericCategories.find(item => item?.id === category.id) || category;
            const nameValue = typeof rawCategory.name === 'string' ? rawCategory.name : category.name;
            const weightValue = typeof rawCategory.weight !== 'undefined' ? rawCategory.weight : category.weight;
            const errors = numericCategoryErrors[category.id] || {};
            const hasNameError = Boolean(errors.name);
            const hasWeightError = Boolean(errors.weight);
            const nameClasses = `mt-1 w-full p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 ${hasNameError ? 'border-red-400 focus:ring-red-300 dark:border-red-600 dark:focus:ring-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}`;
            const weightClasses = `mt-1 w-full p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 ${hasWeightError ? 'border-red-400 focus:ring-red-300 dark:border-red-600 dark:focus:ring-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}`;
            const removeDisabled = numericCategories.length <= 1;
            const removeButtonClasses = removeDisabled
                ? 'text-sm text-gray-400 cursor-not-allowed'
                : 'text-sm text-gray-500 hover:text-red-600 dark:hover:text-red-400';
            const removeButtonAttrs = removeDisabled ? 'disabled aria-disabled="true"' : '';
            return `
                <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1 space-y-1">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300" for="numeric-name-${category.id}">${t('evaluation_numeric_category_name_label')}</label>
                            <input
                                id="numeric-name-${category.id}"
                                type="text"
                                value="${typeof nameValue === 'undefined' ? '' : escapeAttribute(nameValue)}"
                                data-action="update-numeric-category-name"
                                data-class-id="${selectedClassId}"
                                data-category-id="${category.id}"
                                class="${nameClasses}"
                            />
                            ${hasNameError ? `<p class="text-xs text-red-600 dark:text-red-300">${escapeHtml(t(errorTranslationKey[errors.name]))}</p>` : ''}
                        </div>
                        <div class="w-36 space-y-1">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300" for="numeric-weight-${category.id}">${t('evaluation_numeric_category_weight_label')}</label>
                            <input
                                id="numeric-weight-${category.id}"
                                type="number"
                                inputmode="decimal"
                                min="0"
                                step="0.01"
                                value="${typeof weightValue === 'undefined' || weightValue === '' ? '' : escapeAttribute(weightValue)}"
                                data-action="update-numeric-category-weight"
                                data-class-id="${selectedClassId}"
                                data-category-id="${category.id}"
                                class="${weightClasses}"
                            />
                            ${hasWeightError ? `<p class="text-xs text-red-600 dark:text-red-300">${escapeHtml(t(errorTranslationKey[errors.weight]))}</p>` : ''}
                        </div>
                        <div>
                            <button type="button" class="${removeButtonClasses}" data-action="remove-numeric-category" data-class-id="${selectedClassId}" data-category-id="${category.id}" ${removeButtonAttrs}>
                                <i data-lucide="trash" class="w-5 h-5"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const numericContentHtml = `
            <div class="mt-6 space-y-4">
                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-end">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300" for="numeric-weight-basis">${t('evaluation_numeric_weight_basis_label')}</label>
                        <input
                            id="numeric-weight-basis"
                            type="number"
                            inputmode="decimal"
                            min="0"
                            step="0.01"
                            value="${basisValue === '' ? '' : escapeAttribute(basisValue)}"
                            data-action="update-numeric-weight-basis"
                            data-class-id="${selectedClassId}"
                            class="mt-1 w-full p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 ${weightBasisError ? 'border-red-400 focus:ring-red-300 dark:border-red-600 dark:focus:ring-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}"
                        />
                        ${weightBasisError
                            ? `<p class="mt-1 text-xs text-red-600 dark:text-red-300">${escapeHtml(t(errorTranslationKey[weightBasisError]))}</p>`
                            : `<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${t('evaluation_numeric_weight_basis_help')}</p>`
                        }
                    </div>
                    <div class="sm:col-span-2">
                        <p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_numeric_description')}</p>
                    </div>
                </div>
                <div class="space-y-3">
                    ${numericCategoriesHtml}
                    <div class="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
                        <div class="${totalStatusClass}">
                            <p class="text-sm font-medium">${t('evaluation_numeric_total_label')}</p>
                            <p class="text-xs">${weightTotalDisplay}${hasBasis ? ` / ${basisDisplay}` : ''}</p>
                        </div>
                        <button type="button" data-action="add-numeric-category" data-class-id="${selectedClassId}" class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700">
                            <i data-lucide="plus" class="w-4 h-4"></i>
                            ${t('evaluation_numeric_add_category')}
                        </button>
                    </div>
                </div>
            </div>
        `;

        const competencyContentHtml = modality === EVALUATION_MODALITIES.COMPETENCY
            ? `
                <div class="mt-6 space-y-6">
                    <div>
                        <h4 class="text-base font-semibold text-gray-800 dark:text-gray-200">${t('evaluation_levels_table_label')}</h4>
                        <div class="mt-3 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                            <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                                <thead class="bg-gray-50 dark:bg-gray-900/40">
                                    <tr>
                                        <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">${t('evaluation_levels_column_label')}</th>
                                        <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">${t('evaluation_levels_column_numeric_value')}</th>
                                    </tr>
                                </thead>
                                <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                    ${levelRowsHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div>
                        <h4 class="text-base font-semibold text-gray-800 dark:text-gray-200">${t('evaluation_minimums_title')}</h4>
                        <div class="mt-3 grid gap-4 sm:grid-cols-3">
                            ${minimumInputsHtml}
                        </div>
                    </div>
                    <div>
                        <h4 class="text-base font-semibold text-gray-800 dark:text-gray-200">${t('evaluation_max_not_achieved_title')}</h4>
                        <div class="mt-3 grid gap-4 sm:grid-cols-2">
                            ${maxInputsHtml}
                        </div>
                    </div>
                    <div>
                        <h4 class="text-base font-semibold text-gray-800 dark:text-gray-200">${t('evaluation_aggregation_label')}</h4>
                        <div class="mt-3 space-y-3">
                            ${aggregationHtml}
                        </div>
                    </div>
                    <div>
                        <h4 class="text-base font-semibold text-gray-800 dark:text-gray-200">${t('evaluation_additional_rules_title')}</h4>
                        <div class="mt-3 grid gap-4 sm:grid-cols-2">
                            ${noEvidenceSelectHtml}
                            ${npTreatmentSelectHtml}
                        </div>
                        ${noEvidenceLevelSelect}
                    </div>
                </div>
            `
            : numericContentHtml;

        const helpHtml = `
            <div class="rounded-lg border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 p-5 space-y-3">
                <h4 class="text-base font-semibold text-blue-700 dark:text-blue-200 flex items-center gap-2"><i data-lucide="info" class="w-4 h-4"></i>${t('evaluation_help_title')}</h4>
                <p class="text-sm text-blue-800 dark:text-blue-100">${t('evaluation_help_weighted_description')}</p>
                <p class="text-sm font-medium text-blue-800 dark:text-blue-100">${t('evaluation_help_weighted_formula')}</p>
                <p class="text-sm text-blue-800 dark:text-blue-100">${escapeHtml(weightedText)}</p>
                <p class="text-sm text-blue-800 dark:text-blue-100">${t('evaluation_help_majority_text')}</p>
                <p class="text-sm text-blue-800 dark:text-blue-100">${escapeHtml(majorityText)}</p>
            </div>
        `;

        evaluationTabContent = `
            <div class="space-y-6">
                <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 space-y-6">
                    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div>
                            <h3 class="text-xl font-semibold text-gray-800 dark:text-gray-100">${t('evaluation_tab_title')}</h3>
                            <p class="text-sm text-gray-500 dark:text-gray-400">${t('evaluation_tab_description')}</p>
                        </div>
                        <div class="w-full lg:w-72">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300" for="evaluation-class-select">${t('evaluation_select_subject_label')}</label>
                            <select
                                id="evaluation-class-select"
                                data-action="select-settings-evaluation-class"
                                class="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm"
                            >
                                ${evaluationClassOptions}
                            </select>
                        </div>
                    </div>
                    <div class="flex flex-col sm:flex-row gap-4">
                        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <input type="radio" name="evaluation-modality-${selectedClassId}" value="${EVALUATION_MODALITIES.COMPETENCY}" data-action="change-evaluation-modality" data-class-id="${selectedClassId}" ${modality === EVALUATION_MODALITIES.COMPETENCY ? 'checked' : ''} class="text-blue-600 border-gray-300 focus:ring-blue-500"/>
                            ${t('evaluation_modality_competency')}
                        </label>
                        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <input type="radio" name="evaluation-modality-${selectedClassId}" value="${EVALUATION_MODALITIES.NUMERIC}" data-action="change-evaluation-modality" data-class-id="${selectedClassId}" ${modality === EVALUATION_MODALITIES.NUMERIC ? 'checked' : ''} class="text-blue-600 border-gray-300 focus:ring-blue-500"/>
                            ${t('evaluation_modality_numeric')}
                        </label>
                    </div>
                    ${feedbackHtml}
                    ${validationSummaryHtml}
                    ${competencyContentHtml}
                    <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <button
                            type="button"
                            data-action="reset-evaluation-config"
                            data-class-id="${selectedClassId}"
                            class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
                            ${t('evaluation_reset_button')}
                        </button>
                        <button
                            type="button"
                            data-action="save-evaluation-config"
                            data-class-id="${selectedClassId}"
                            class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-white ${saveDisabled ? 'bg-blue-400 cursor-not-allowed opacity-70' : 'bg-blue-600 hover:bg-blue-700'}"
                            ${saveDisabled ? 'disabled aria-disabled="true"' : ''}
                        >
                            <i data-lucide="save" class="w-4 h-4"></i>
                            ${t('evaluation_save_button')}
                        </button>
                    </div>
                </div>
                ${helpHtml}
            </div>
        `;
    }

    // --- Data Tab Content ---
    const dataPersistenceStatusKey = `data_file_status_${state.dataPersistenceStatus || 'unconfigured'}`;
    const statusText = t(dataPersistenceStatusKey);
    const statusClassesMap = {
        saved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
        ready: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
        unconfigured: 'bg-gray-200 text-gray-700 dark:bg-gray-800/60 dark:text-gray-200',
        'permission-denied': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
        error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
        unsupported: 'bg-gray-200 text-gray-700 dark:bg-gray-800/60 dark:text-gray-200'
    };
    const statusClass = statusClassesMap[state.dataPersistenceStatus] || statusClassesMap.unconfigured;
    const canUsePersistence = state.dataPersistenceSupported;
    const hasConfiguredFile = Boolean(state.dataFileHandle || state.dataFileName);
    const canClearConfig = hasConfiguredFile || state.dataPersistenceStatus === 'permission-denied';
    const chooseDisabled = canUsePersistence ? '' : 'disabled aria-disabled="true"';
    const chooseClasses = canUsePersistence
        ? 'bg-blue-600 hover:bg-blue-700 text-white'
        : 'bg-blue-400 text-white cursor-not-allowed opacity-70';
    const createDisabled = canUsePersistence ? '' : 'disabled aria-disabled="true"';
    const createClasses = canUsePersistence
        ? 'bg-green-600 hover:bg-green-700 text-white'
        : 'bg-green-400 text-white cursor-not-allowed opacity-70';
    const reloadEnabled = Boolean(state.dataFileHandle) && state.dataPersistenceStatus !== 'permission-denied';
    const reloadDisabled = reloadEnabled ? '' : 'disabled aria-disabled="true"';
    const reloadClasses = reloadEnabled
        ? 'bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200'
        : 'bg-gray-200 text-gray-400 cursor-not-allowed opacity-70 dark:bg-gray-800 dark:text-gray-500';
    const clearDisabled = canClearConfig ? '' : 'disabled aria-disabled="true"';
    const clearClasses = canClearConfig
        ? 'bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200'
        : 'bg-gray-200 text-gray-400 cursor-not-allowed opacity-70 dark:bg-gray-800 dark:text-gray-500';

    const dataFileInfo = hasConfiguredFile
        ? `<p class="text-sm text-gray-600 dark:text-gray-300"><strong>${t('data_file_current_label')}</strong> ${escapeHtml(state.dataFileName)}</p>`
        : `<p class="text-sm text-gray-600 dark:text-gray-300">${t('data_file_not_configured')}</p>`;

    const errorInfo = state.dataPersistenceStatus === 'error' && state.dataPersistenceError
        ? `<div class="mt-3 text-sm text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-md p-3">
                <strong class="block">${t('data_file_error_label')}</strong>
                <span class="break-all">${escapeHtml(state.dataPersistenceError)}</span>
            </div>`
        : '';

    const permissionInfo = state.dataPersistenceStatus === 'permission-denied'
        ? `<div class="mt-3 text-sm text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700 rounded-md p-3">
                ${t('data_file_permission_help')}
            </div>`
        : '';

    const supportInfo = !canUsePersistence
        ? `<div class="mt-3 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-md p-3">
                ${t('data_persistence_not_supported')}
            </div>`
        : '';

    const dataTabContent = `
        <div class="max-w-3xl mx-auto space-y-6">
            <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div>
                        <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                            <i data-lucide="database" class="w-5 h-5"></i>
                            ${t('data_file_section_title')}
                        </h3>
                        <p class="text-sm text-gray-600 dark:text-gray-300 mt-1">${t('data_file_section_description')}</p>
                    </div>
                    <span class="inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full ${statusClass}">
                        ${statusText}
                    </span>
                </div>
                <div class="mt-4 space-y-3">
                    ${dataFileInfo}
                    ${errorInfo}
                    ${permissionInfo}
                    ${supportInfo}
                    <div class="grid sm:grid-cols-2 gap-3">
                        <button data-action="choose-data-file" class="px-4 py-2 rounded-md flex items-center justify-center gap-2 ${chooseClasses}" ${chooseDisabled}>
                            <i data-lucide="folder-open" class="w-5 h-5"></i>
                            <span>${t('data_file_choose_button')}</span>
                        </button>
                        <button data-action="create-data-file" class="px-4 py-2 rounded-md flex items-center justify-center gap-2 ${createClasses}" ${createDisabled}>
                            <i data-lucide="file-plus" class="w-5 h-5"></i>
                            <span>${t('data_file_create_button')}</span>
                        </button>
                        <button data-action="reload-data-file" class="px-4 py-2 rounded-md flex items-center justify-center gap-2 ${reloadClasses}" ${reloadDisabled}>
                            <i data-lucide="rotate-cw" class="w-5 h-5"></i>
                            <span>${t('data_file_reload_button')}</span>
                        </button>
                        <button data-action="clear-data-file-selection" class="px-4 py-2 rounded-md flex items-center justify-center gap-2 ${clearClasses}" ${clearDisabled}>
                            <i data-lucide="unlink" class="w-5 h-5"></i>
                            <span>${t('data_file_clear_button')}</span>
                        </button>
                    </div>
                </div>
            </div>
            <div class="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 p-4 rounded-r-lg">
                <h3 class="text-lg font-semibold text-red-800 dark:text-red-300 flex items-center gap-2"><i data-lucide="alert-triangle" class="w-5 h-5"></i> ${t('danger_zone_title')}</h3>
                <div class="mt-4 space-y-2">
                    <label class="w-full bg-amber-600 text-white px-4 py-2 rounded-md hover:bg-amber-700 flex items-center justify-center gap-2 cursor-pointer">
                        <i data-lucide="file-import" class="w-5 h-5"></i>
                        <span>${t('import_schedule')}</span>
                        <input type="file" id="import-schedule-input" accept=".json" class="hidden"/>
                    </label>
                    <button data-action="delete-all-data" class="w-full bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 flex items-center justify-center gap-2"><i data-lucide="trash-2" class="w-5 h-5"></i> ${t('delete_all_data')}</button>
                </div>
            </div>
        </div>
    `;

    let activeTabContent = '';
    switch (state.settingsActiveTab) {
        case 'calendar': activeTabContent = calendarTabContent; break;
        case 'schedule': activeTabContent = scheduleTabContent; break;
        case 'activities': activeTabContent = activitiesTabContent; break;
        case 'competencies': activeTabContent = competenciesTabContent; break;
        case 'evaluation': activeTabContent = evaluationTabContent; break;
        case 'data': activeTabContent = dataTabContent; break;
        default: activeTabContent = calendarTabContent;
    }

    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full space-y-6">
            <h2 class="hidden sm:block text-2xl font-bold text-gray-800 dark:text-gray-200">${t('settings_view_title')}</h2>
            
            <div class="bg-white dark:bg-gray-800 p-2 rounded-lg shadow-sm flex flex-wrap gap-2">
                ${tabButtonsHtml}
            </div>

            <div id="settings-tab-content">
                ${activeTabContent}
            </div>
        </div>
    `;
}


export function renderLearningActivityRubricView() {
    const activityId = state.activeLearningActivityRubricId;
    renderMobileHeaderActions([
        { action: 'close-learning-activity-rubric', label: t('back_to_activities'), icon: 'arrow-left' }
    ]);

    if (!activityId) {
        return `
            <div class="p-6">
                <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
                    <p class="text-sm text-yellow-800 dark:text-yellow-200">${t('rubric_activity_not_selected')}</p>
                    <button data-action="close-learning-activity-rubric" class="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        <i data-lucide="arrow-left" class="w-4 h-4"></i>
                        ${t('back_to_activities')}
                    </button>
                </div>
            </div>
        `;
    }

    const activity = state.learningActivities.find(act => act.id === activityId);
    if (!activity) {
        return `
            <div class="p-6">
                <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
                    <p class="text-sm text-red-800 dark:text-red-200">${t('rubric_activity_not_found')}</p>
                    <button data-action="close-learning-activity-rubric" class="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        <i data-lucide="arrow-left" class="w-4 h-4"></i>
                        ${t('back_to_activities')}
                    </button>
                </div>
            </div>
        `;
    }

    const targetClass = state.activities.find(a => a.id === activity.classId);
    const locale = document.documentElement.lang || 'ca';
    const normalizedEvaluationConfig = normalizeEvaluationConfig(state.evaluationSettings?.[activity.classId]);
    const rubric = activity.rubric || { items: [], evaluations: {} };
    const rubricItems = Array.isArray(rubric.items) ? rubric.items : [];
    const evaluations = rubric.evaluations && typeof rubric.evaluations === 'object' ? rubric.evaluations : {};

    const competencies = Array.isArray(targetClass?.competencies) ? targetClass.competencies : [];
    const availableCriteria = competencies.flatMap(comp => {
        const criteria = Array.isArray(comp.criteria) ? comp.criteria : [];
        return criteria.map(criterion => ({
            competency: comp,
            criterion
        }));
    });

    const allowedTabs = ['configuration', 'assessment'];
    const activeTab = allowedTabs.includes(state.learningActivityRubricTab) ? state.learningActivityRubricTab : 'configuration';
    state.learningActivityRubricTab = activeTab;

    const statusMeta = {
        [LEARNING_ACTIVITY_STATUS.SCHEDULED]: {
            label: t('learning_activity_status_scheduled'),
            classes: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700/40 dark:text-gray-200 dark:border-gray-600'
        },
        [LEARNING_ACTIVITY_STATUS.OPEN_SUBMISSIONS]: {
            label: t('learning_activity_status_open'),
            classes: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-200 dark:border-green-700'
        },
        [LEARNING_ACTIVITY_STATUS.PENDING_REVIEW]: {
            label: t('learning_activity_status_pending'),
            classes: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700'
        },
        [LEARNING_ACTIVITY_STATUS.CORRECTED]: {
            label: t('learning_activity_status_corrected'),
            classes: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700'
        }
    };
    const status = calculateLearningActivityStatus(activity);
    const statusInfo = statusMeta[status] || statusMeta[LEARNING_ACTIVITY_STATUS.SCHEDULED];

    const tabButtonBaseClass = 'px-4 py-2 text-sm font-semibold rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600';
    const tabButtonInactive = 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700';
    const tabButtonActive = 'bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500';

    const tabButtonsHtml = [
        { key: 'configuration', label: t('rubric_tab_configuration') },
        { key: 'assessment', label: t('rubric_tab_assessment') }
    ].map(tab => {
        const isActive = tab.key === activeTab;
        const classes = `${tabButtonBaseClass} ${isActive ? tabButtonActive : tabButtonInactive}`;
        return `<button data-action="set-learning-activity-rubric-tab" data-tab="${tab.key}" class="${classes}" aria-pressed="${isActive}">${tab.label}</button>`;
    }).join('');

    const editActivityButtonHtml = activity.classId
        ? `<button data-action="open-learning-activity-editor" data-class-id="${activity.classId}" data-learning-activity-id="${activity.id}" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600">
                <i data-lucide="pencil" class="w-4 h-4"></i>
                <span>${t('rubric_edit_activity_button')}</span>
            </button>`
        : '';

    const criteriaOptions = availableCriteria.map(item => {
        const competencyCode = item.competency?.code || t('competency_without_code');
        const criterionCode = item.criterion?.code || t('criterion_without_code');
        const criterionDescription = item.criterion?.description || t('criterion_without_description');
        const competencyId = item.competency?.id || '';
        const criterionId = item.criterion?.id || '';
        return `<option value="${competencyId}|${criterionId}">${escapeHtml(`${competencyCode} · ${criterionCode}`)} — ${escapeHtml(criterionDescription)}</option>`;
    }).join('');

    const addCriterionControls = availableCriteria.length > 0
        ? `
            <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                <div class="flex-1">
                    <label for="rubric-add-select-${activity.id}" class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('rubric_add_criterion_label')}</label>
                    <select id="rubric-add-select-${activity.id}" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md">
                        <option value="">${t('rubric_select_placeholder')}</option>
                        ${criteriaOptions}
                    </select>
                </div>
                <button data-action="add-rubric-item" data-learning-activity-id="${activity.id}" class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                    <i data-lucide="plus" class="w-4 h-4"></i>
                    ${t('rubric_add_button')}
                </button>
            </div>
        `
        : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('rubric_no_criteria_available')}</p>`;

    const configurationItemsHtml = rubricItems.length > 0
        ? rubricItems.map((item, index) => {
            const competency = competencies.find(comp => comp.id === item.competencyId);
            const fallbackCriterion = availableCriteria.find(opt => opt.criterion?.id === item.criterionId)?.criterion || null;
            const criterion = competency?.criteria?.find(cr => cr.id === item.criterionId) || fallbackCriterion;
            const competencyLabel = competency?.code || t('competency_without_code');
            const criterionCode = criterion?.code || t('criterion_without_code');
            const criterionDescription = criterion?.description || t('criterion_without_description');
            const weightValue = typeof item.weight === 'number' && !Number.isNaN(item.weight) ? item.weight : 1;
            const generalCommentValue = escapeHtml(typeof item.generalComment === 'string' ? item.generalComment : '');
            const moveUpDisabled = index === 0 ? 'disabled aria-disabled="true"' : '';
            const moveDownDisabled = index === rubricItems.length - 1 ? 'disabled aria-disabled="true"' : '';
            const scoringMode = item.scoring?.mode === 'numeric' ? 'numeric' : 'competency';
            const maxScoreNumber = Number(item.scoring?.maxScore);
            const maxScoreDisplay = scoringMode === 'numeric' && Number.isFinite(maxScoreNumber)
                ? formatDecimal(maxScoreNumber, locale, { maximumFractionDigits: 2, useGrouping: false })
                : '';

            const levelCommentsHtml = RUBRIC_LEVELS.map(level => {
                const levelLabel = t(`rubric_level_${level}_label`);
                const commentValue = escapeHtml(item.levelComments?.[level] || '');
                return `
                    <div>
                        <label class="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">${levelLabel}</label>
                        <textarea data-action="update-rubric-item-comment" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" data-level="${level}" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md text-sm" placeholder="${t('rubric_level_comment_placeholder')}">${commentValue}</textarea>
                    </div>
                `;
            }).join('');

            return `
                <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4 bg-white dark:bg-gray-900/40">
                    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div class="space-y-1">
                            <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">${escapeHtml(competencyLabel)} · ${escapeHtml(criterionCode)}</p>
                            <p class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(criterionDescription)}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <label class="text-sm font-medium text-gray-700 dark:text-gray-200" for="rubric-weight-${item.id}">${t('rubric_weight_label')}</label>
                            <input id="rubric-weight-${item.id}" type="number" step="0.1" min="0" value="${weightValue}" data-action="update-rubric-item-weight" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" class="w-24 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md text-sm">
                            <div class="flex gap-1">
                                <button ${moveUpDisabled} data-action="move-rubric-item" data-direction="up" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" class="inline-flex items-center justify-center p-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                                    <i data-lucide="arrow-up" class="w-4 h-4"></i>
                                    <span class="sr-only">${t('rubric_move_up_label')}</span>
                                </button>
                                <button ${moveDownDisabled} data-action="move-rubric-item" data-direction="down" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" class="inline-flex items-center justify-center p-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                                    <i data-lucide="arrow-down" class="w-4 h-4"></i>
                                    <span class="sr-only">${t('rubric_move_down_label')}</span>
                                </button>
                                <button data-action="remove-rubric-item" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" class="inline-flex items-center justify-center p-2 border border-red-200 text-red-600 dark:border-red-700 dark:text-red-300 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30">
                                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                                    <span class="sr-only">${t('rubric_remove_button_label')}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-col sm:flex-row sm:items-end gap-3">
                        <div>
                            <label class="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1" for="rubric-scoring-mode-${item.id}">${t('rubric_scoring_mode_label')}</label>
                            <select id="rubric-scoring-mode-${item.id}" data-action="update-rubric-item-scoring-mode" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" class="w-full sm:w-56 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md text-sm">
                                <option value="competency" ${scoringMode === 'competency' ? 'selected' : ''}>${t('rubric_scoring_mode_competency')}</option>
                                <option value="numeric" ${scoringMode === 'numeric' ? 'selected' : ''}>${t('rubric_scoring_mode_numeric')}</option>
                            </select>
                        </div>
                        ${scoringMode === 'numeric'
                            ? `<div class="flex-1">
                                    <label class="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1" for="rubric-max-score-${item.id}">${t('rubric_numeric_max_score_label')}</label>
                                    <input id="rubric-max-score-${item.id}" type="text" inputmode="decimal" pattern="[0-9]*[,.]?[0-9]*" data-event="change" value="${escapeAttribute(maxScoreDisplay)}" data-action="update-rubric-item-max-score" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" placeholder="${escapeAttribute(t('rubric_numeric_max_score_placeholder'))}" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md text-sm">
                                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${t('rubric_numeric_max_score_help')}</p>
                                </div>`
                            : ''}
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1" for="rubric-general-comment-${item.id}">${t('rubric_item_comment_label')}</label>
                        <input id="rubric-general-comment-${item.id}" type="text" value="${generalCommentValue}" data-action="update-rubric-item-general-comment" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md text-sm" placeholder="${t('rubric_item_comment_placeholder')}">
                    </div>
                    <div class="grid gap-3 sm:grid-cols-2">${levelCommentsHtml}</div>
                </div>
            `;
        }).join('')
        : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('rubric_no_items_configuration')}</p>`;

    const configurationContent = `
        <div class="space-y-4">
            ${addCriterionControls}
            <div class="space-y-4">${configurationItemsHtml}</div>
        </div>
    `;

    const studentsInClass = Array.isArray(targetClass?.studentIds)
        ? targetClass.studentIds
            .map(studentId => state.students.find(student => student.id === studentId))
            .filter(Boolean)
            .sort(sortStudentsByName)
        : [];

    const levelStyles = {
        NA: { active: 'bg-red-600 text-white border-red-700', inactive: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-200 dark:border-red-700' },
        AS: { active: 'bg-amber-500 text-white border-amber-600', inactive: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700' },
        AN: { active: 'bg-blue-600 text-white border-blue-700', inactive: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-700' },
        AE: { active: 'bg-emerald-600 text-white border-emerald-700', inactive: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-700' }
    };

    const searchTerm = (state.learningActivityRubricFilter || '').toLowerCase().trim();
    const filteredStudents = searchTerm
        ? studentsInClass.filter(student => (student?.name || '').toLowerCase().includes(searchTerm))
        : studentsInClass;

    const levelHeaderCells = RUBRIC_LEVELS.map(level => {
        const levelLabel = t(`rubric_level_${level}_label`);
        return `<th scope="col" class="px-2 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400">${escapeHtml(level)}<span class="sr-only"> — ${escapeHtml(levelLabel)}</span></th>`;
    }).join('');

    const baseLevelButtonClass = 'w-full px-2 py-2 text-xs font-semibold rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600';
    const flagButtonBaseClass = 'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600';
    const flagButtonVariants = {
        notPresented: {
            active: 'bg-gray-700 text-white border-gray-800 shadow-sm dark:bg-gray-200 dark:text-gray-900 dark:border-gray-300',
            inactive: 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700'
        },
        exempt: {
            active: 'bg-emerald-500 text-white border-emerald-600 shadow-sm',
            inactive: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700 dark:hover:bg-emerald-900/40'
        },
        deliveredLate: {
            active: 'bg-amber-500 text-white border-amber-600 shadow-sm',
            inactive: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700 dark:hover:bg-amber-900/40'
        }
    };

    const assessmentRowsHtml = rubricItems.length === 0 || filteredStudents.length === 0
        ? ''
        : filteredStudents.map(student => {
            const evaluation = evaluations[student.id] || {};
            const scores = evaluation.scores && typeof evaluation.scores === 'object' ? evaluation.scores : {};
            const comment = evaluation.comment || '';
            const flags = evaluation.flags && typeof evaluation.flags === 'object' ? evaluation.flags : {};
            const isNotPresented = Boolean(flags.notPresented);
            const isExempt = Boolean(flags.exempt);
            const isDeliveredLate = Boolean(flags.deliveredLate);
            const evaluationDisabled = isNotPresented || isExempt;

            const numericTotals = computeStudentNumericScoreForActivity(activity, student.id);
            const showNumericTotals = numericTotals && !numericTotals.exempt && Number.isFinite(numericTotals?.weightedMaxScore) && numericTotals.weightedMaxScore > 0;
            const formattedRawScore = showNumericTotals
                ? formatDecimal(numericTotals.score || 0, locale, { maximumFractionDigits: 2, useGrouping: false })
                : '';
            const formattedRawMax = showNumericTotals
                ? formatDecimal(numericTotals.maxScore || 0, locale, { maximumFractionDigits: 2, useGrouping: false })
                : '';
            const formattedWeightedScore = showNumericTotals
                ? formatDecimal(numericTotals.weightedScore || 0, locale, { maximumFractionDigits: 2, useGrouping: false })
                : '';
            const formattedWeightedMax = showNumericTotals
                ? formatDecimal(numericTotals.weightedMaxScore || 0, locale, { maximumFractionDigits: 2, useGrouping: false })
                : '';
            const formattedScoreOutOfTen = showNumericTotals && Number.isFinite(numericTotals.scoreOutOfTen)
                ? formatDecimal(numericTotals.scoreOutOfTen, locale, { maximumFractionDigits: 2, useGrouping: false })
                : '';
            const rawTotalTemplate = t('rubric_numeric_total');
            const weightedTotalTemplate = t('rubric_numeric_weighted_total');
            const normalizedTemplate = t('rubric_numeric_grade_out_of_ten');
            const formulaTemplate = t('rubric_numeric_formula_hint');
            const numericSummaryLines = showNumericTotals
                ? [
                    rawTotalTemplate.startsWith('[')
                        ? `${formattedRawScore} / ${formattedRawMax}`
                        : rawTotalTemplate.replace('{{score}}', formattedRawScore).replace('{{max}}', formattedRawMax),
                    weightedTotalTemplate.startsWith('[')
                        ? `${formattedWeightedScore} / ${formattedWeightedMax}`
                        : weightedTotalTemplate.replace('{{score}}', formattedWeightedScore).replace('{{max}}', formattedWeightedMax),
                    formattedScoreOutOfTen
                        ? (normalizedTemplate.startsWith('[')
                            ? `${formattedScoreOutOfTen}/10`
                            : normalizedTemplate.replace('{{score}}', formattedScoreOutOfTen))
                        : '',
                    formulaTemplate.startsWith('[') ? '' : formulaTemplate
                ].filter(Boolean)
                : [];

            const studentRows = rubricItems.map((item, index) => {
                const competency = competencies.find(comp => comp.id === item.competencyId);
                const fallbackCriterion = availableCriteria.find(opt => opt.criterion?.id === item.criterionId)?.criterion || null;
                const criterion = competency?.criteria?.find(cr => cr.id === item.criterionId) || fallbackCriterion;
                const competencyLabel = competency?.code || t('competency_without_code');
                const criterionCode = criterion?.code || t('criterion_without_code');
                const criterionDescription = criterion?.description || t('criterion_without_description');
                const scoringMode = item.scoring?.mode === 'numeric' ? 'numeric' : 'competency';
                const currentLevel = scores[item.id] || '';

                const scoreCells = scoringMode === 'numeric'
                    ? (() => {
                        const numericValue = getRubricNumericValue(scores[item.id]);
                        const maxScore = Number(item.scoring?.maxScore);
                        const hasNumericValue = Number.isFinite(numericValue);
                        const hasValidMax = Number.isFinite(maxScore) && maxScore > 0;
                        const numericResult = hasNumericValue && hasValidMax
                            ? computeNumericEvidence(numericValue, maxScore, null, { normalizedConfig: normalizedEvaluationConfig })
                            : null;
                        const normalizedScore = numericResult?.scoreOutOfFour;
                        const derivedLevelId = numericResult?.levelId || '';
                        const levelLabel = derivedLevelId ? t(`rubric_level_${derivedLevelId}_label`) : '';
                        const badgeClasses = derivedLevelId
                            ? levelStyles[derivedLevelId]?.active || 'bg-gray-200 text-gray-700 border-gray-300'
                            : 'bg-gray-200 text-gray-600 border-gray-300';
                        const badgeHtml = derivedLevelId
                            ? `<span class="inline-flex items-center px-2 py-1 rounded-md border text-xs font-semibold ${badgeClasses}">${escapeHtml(derivedLevelId)}<span class="sr-only"> — ${escapeHtml(levelLabel)}</span></span>`
                            : '';
                        const formattedInputValue = hasNumericValue
                            ? formatDecimal(numericValue, locale, { maximumFractionDigits: 2, useGrouping: false })
                            : '';
                        const formattedValue = hasNumericValue
                            ? formatDecimal(numericValue, locale, { maximumFractionDigits: 2, useGrouping: false })
                            : '';
                        const formattedMax = hasValidMax
                            ? formatDecimal(maxScore, locale, { maximumFractionDigits: 2, useGrouping: false })
                            : '';
                        const formattedNormalized = Number.isFinite(normalizedScore)
                            ? formatDecimal(normalizedScore, locale, { maximumFractionDigits: 2, useGrouping: false })
                            : '';
                        const ratioTemplate = t('rubric_numeric_ratio');
                        const maxHintTemplate = t('rubric_numeric_max_hint');
                        const missingMaxTemplate = t('rubric_numeric_missing_max');
                        const equivalenceTemplate = t('rubric_numeric_equivalence');
                        const enterValueTemplate = t('rubric_numeric_enter_value');

                        const ratioText = hasNumericValue && hasValidMax
                            ? (ratioTemplate.startsWith('[')
                                ? `${formattedValue} / ${formattedMax}`
                                : ratioTemplate.replace('{{value}}', formattedValue).replace('{{max}}', formattedMax))
                            : hasValidMax
                                ? (maxHintTemplate.startsWith('[')
                                    ? `${formattedMax}`
                                    : maxHintTemplate.replace('{{max}}', formattedMax))
                                : (missingMaxTemplate.startsWith('[')
                                    ? ''
                                    : missingMaxTemplate);

                        const weight = Number(item.weight);
                        const hasWeight = Number.isFinite(weight) && weight > 0;
                        const formattedWeight = hasWeight
                            ? formatDecimal(weight, locale, { maximumFractionDigits: 2, useGrouping: false })
                            : '';
                        const weightTemplate = t('rubric_numeric_weight_hint');
                        const weightText = hasWeight
                            ? (weightTemplate.startsWith('[')
                                ? formattedWeight
                                : weightTemplate.replace('{{weight}}', formattedWeight))
                            : '';

                        const equivalenceText = Number.isFinite(normalizedScore) && derivedLevelId
                            ? (equivalenceTemplate.startsWith('[')
                                ? `${derivedLevelId} (${formattedNormalized}/4)`
                                : equivalenceTemplate
                                    .replace('{{level}}', derivedLevelId)
                                    .replace('{{level_label}}', levelLabel.startsWith('[') ? derivedLevelId : levelLabel)
                                    .replace('{{score}}', formattedNormalized))
                            : '';

                        const helperText = !hasNumericValue && hasValidMax
                            ? ''
                            : (!hasNumericValue
                                ? (enterValueTemplate.startsWith('[') ? '' : enterValueTemplate)
                                : '');

                        const summaryParts = [];
                        if (ratioText) {
                            summaryParts.push(ratioText);
                        }
                        if (weightText) {
                            summaryParts.push(weightText);
                        }
                        if (equivalenceText) {
                            summaryParts.push(equivalenceText);
                        }
                        if (helperText) {
                            summaryParts.push(helperText);
                        }

                        const summaryHtml = summaryParts.length > 0
                            ? `<div class="text-xs text-gray-500 dark:text-gray-400 leading-snug">${summaryParts.map(line => `<div>${escapeHtml(line)}</div>`).join('')}</div>`
                            : '';

                        const numericDisabledAttr = evaluationDisabled ? ' disabled aria-disabled="true"' : '';
                        const numericDisabledClass = evaluationDisabled ? ' opacity-60 cursor-not-allowed' : '';
                        const placeholder = t('rubric_numeric_input_placeholder');

                        return `<td colspan="${RUBRIC_LEVELS.length}" class="px-2 py-2 align-top">
                            <div class="flex flex-col gap-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <input type="text" inputmode="decimal" pattern="[0-9]*[,.]?[0-9]*" data-event="change" data-action="set-rubric-numeric-score" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" data-student-id="${student.id}" value="${escapeAttribute(formattedInputValue)}" placeholder="${escapeAttribute(placeholder)}" class="w-28 p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-sm${numericDisabledClass}"${numericDisabledAttr}>
                                    ${badgeHtml}
                                </div>
                                ${summaryHtml}
                            </div>
                        </td>`;
                    })()
                    : RUBRIC_LEVELS.map(level => {
                        const levelLabel = t(`rubric_level_${level}_label`);
                        const commentTemplate = item.levelComments?.[level]?.trim() || '';
                        const tooltipParts = [`${criterionCode} · ${levelLabel}`];
                        if (commentTemplate) {
                            tooltipParts.push(commentTemplate);
                        }
                        const tooltip = tooltipParts.join('\n');
                        const ariaLabelParts = [levelLabel];
                        if (commentTemplate) {
                            ariaLabelParts.push(commentTemplate);
                        }
                        const ariaLabel = ariaLabelParts.join('. ');
                        const isActive = currentLevel === level;
                        const disabledAttr = evaluationDisabled ? ' disabled' : '';
                        const disabledClasses = evaluationDisabled ? ' opacity-60 cursor-not-allowed' : '';
                        const buttonClasses = `${baseLevelButtonClass} ${isActive ? levelStyles[level].active : levelStyles[level].inactive}${disabledClasses}`;
                        return `<td class="px-2 py-2 text-center align-top">
                            <button type="button" data-action="set-rubric-score" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" data-student-id="${student.id}" data-level="${level}" class="${buttonClasses}" aria-pressed="${isActive}" aria-label="${escapeHtml(ariaLabel)}" title="${escapeHtml(tooltip)}" data-tooltip-comment="${escapeHtml(commentTemplate)}"${disabledAttr} aria-disabled="${evaluationDisabled}">
                                <span class="block text-[11px] font-bold leading-none">${level}</span>
                                <span class="sr-only">${escapeHtml(levelLabel)}</span>
                            </button>
                        </td>`;
                    }).join('');

                const notPresentedButtonClasses = `${flagButtonBaseClass} ${(isNotPresented ? flagButtonVariants.notPresented.active : flagButtonVariants.notPresented.inactive)}`;
                const exemptButtonClasses = `${flagButtonBaseClass} ${(isExempt ? flagButtonVariants.exempt.active : flagButtonVariants.exempt.inactive)}`;
                const deliveredLateDisabled = isNotPresented || isExempt;
                const deliveredLateButtonClasses = `${flagButtonBaseClass} ${(isDeliveredLate ? flagButtonVariants.deliveredLate.active : flagButtonVariants.deliveredLate.inactive)}${deliveredLateDisabled ? ' opacity-60 cursor-not-allowed' : ''}`;
                const deliveredLateDisabledAttr = deliveredLateDisabled ? ' disabled aria-disabled="true"' : '';
                const flagButtonsHtml = `
                    <div class="mt-2 flex flex-col gap-1">
                        <button type="button" class="${notPresentedButtonClasses}" data-action="toggle-rubric-not-presented" data-learning-activity-id="${activity.id}" data-student-id="${student.id}" aria-pressed="${isNotPresented}" title="${escapeHtml(t('rubric_flag_not_presented_hint'))}">
                            <i data-lucide="shredder" class="w-3.5 h-3.5"></i>
                            <span>${escapeHtml(t('rubric_flag_not_presented'))}</span>
                            <span class="font-bold">(${escapeHtml(t('rubric_flag_not_presented_short'))})</span>
                        </button>
                        <button type="button" class="${exemptButtonClasses}" data-action="toggle-rubric-exempt" data-learning-activity-id="${activity.id}" data-student-id="${student.id}" aria-pressed="${isExempt}" title="${escapeHtml(t('rubric_flag_exempt_hint'))}">
                            <i data-lucide="book-dashed" class="w-3.5 h-3.5"></i>
                            <span>${escapeHtml(t('rubric_flag_exempt'))}</span>
                            <span class="font-bold">(${escapeHtml(t('rubric_flag_exempt_short'))})</span>
                        </button>
                        <button type="button" class="${deliveredLateButtonClasses}" data-action="toggle-rubric-delivered-late" data-learning-activity-id="${activity.id}" data-student-id="${student.id}" aria-pressed="${isDeliveredLate}" title="${escapeHtml(t('rubric_flag_delivered_late_hint'))}"${deliveredLateDisabledAttr}>
                            <i data-lucide="file-clock" class="w-3.5 h-3.5"></i>
                            <span>${escapeHtml(t('rubric_flag_delivered_late'))}</span>
                        </button>
                    </div>
                `;

                const numericSummaryHtml = numericSummaryLines.length > 0
                    ? `<div class="mt-3 p-2 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[11px] leading-snug text-gray-700 dark:text-gray-200">
                            ${numericSummaryLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
                        </div>`
                    : '';

                const nameCell = index === 0
                    ? `<th scope="row" rowspan="${rubricItems.length}" class="px-3 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 align-top min-w-[10rem]">
                            <div>
                                <div>${escapeHtml(student.name)}</div>
                                ${flagButtonsHtml}
                                ${numericSummaryHtml}
                            </div>
                        </th>`
                    : '';

                const commentCell = index === 0
                    ? `<td rowspan="${rubricItems.length}" class="px-3 py-3 align-top min-w-[16rem]">
                            <textarea data-action="update-rubric-general-comment" data-learning-activity-id="${activity.id}" data-student-id="${student.id}" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md text-sm min-h-[6rem]" placeholder="${t('rubric_general_comment_placeholder')}">${escapeHtml(comment)}</textarea>
                        </td>`
                    : '';

                return `
                    <tr>
                        ${nameCell}
                        <td class="px-3 py-3 align-top min-w-[14rem]">
                            <div class="text-sm font-semibold text-gray-800 dark:text-gray-100">${escapeHtml(criterionCode)}</div>
                            <div class="text-xs text-gray-600 dark:text-gray-300">${escapeHtml(competencyLabel)}</div>
                            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">${escapeHtml(criterionDescription)}</div>
                        </td>
                        ${scoreCells}
                        ${commentCell}
                    </tr>
                `;
            }).join('');

            return studentRows;
        }).join('');

    const studentSearchHtml = rubricItems.length === 0 || studentsInClass.length === 0
        ? ''
        : `
            <div class="mb-4">
                <label for="rubric-student-search" class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('rubric_student_search_label')}</label>
                <div class="relative">
                    <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                    <input id="rubric-student-search" type="text" value="${escapeHtml(state.learningActivityRubricFilter || '')}" data-action="filter-learning-activity-rubric-students" class="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600" placeholder="${t('rubric_student_search_placeholder')}">
                </div>
            </div>
        `;

    const noStudentsMessage = searchTerm && studentsInClass.length > 0
        ? `<p class="text-sm text-gray-500 dark:text-gray-400">${t('rubric_no_students_search')}</p>`
        : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('rubric_no_students_assessment')}</p>`;

    const assessmentTableHtml = assessmentRowsHtml
        ? `
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 rubric-assessment-table">
                    <thead class="bg-white dark:bg-gray-800">
                        <tr>
                            <th scope="col" class="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 min-w-[10rem]">${t('rubric_students_column')}</th>
                            <th scope="col" class="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 min-w-[14rem]">${t('rubric_criterion_column')}</th>
                            ${levelHeaderCells}
                            <th scope="col" class="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 min-w-[16rem]">${t('rubric_general_comment_column')}</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
                        ${assessmentRowsHtml}
                    </tbody>
                </table>
            </div>
        `
        : noStudentsMessage;

    const assessmentContent = rubricItems.length === 0
        ? `<p class="text-sm text-gray-500 dark:text-gray-400">${t('rubric_no_items_assessment')}</p>`
        : studentsInClass.length === 0
            ? `<p class="text-sm text-gray-500 dark:text-gray-400">${t('rubric_no_students_assessment')}</p>`
            : `${studentSearchHtml}${assessmentTableHtml}`;
    const descriptionHtml = activity.description?.trim()
        ? `<p class="mt-2 text-sm text-gray-600 dark:text-gray-300">${escapeHtml(activity.description.trim())}</p>`
        : '';

    const classInfoHtml = targetClass
        ? `<p class="text-sm text-gray-500 dark:text-gray-400">${t('activities_editor_class_prefix')} <span class="font-semibold text-gray-800 dark:text-gray-100">${escapeHtml(targetClass.name)}</span></p>`
        : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('rubric_no_class_message')}</p>`;

    const mainContent = activeTab === 'configuration' ? configurationContent : assessmentContent;

    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full">
            <div class="max-w-6xl mx-auto space-y-6">
                <div>
                    ${classInfoHtml}
                    <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">${escapeHtml(activity.title?.trim() || t('activities_untitled_label'))}</h2>
                    ${descriptionHtml}
                    <div class="mt-3 flex flex-wrap items-center gap-2">
                        <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${statusInfo.classes}">
                            ${statusInfo.label}
                        </span>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-3">${tabButtonsHtml}${editActivityButtonHtml}</div>
                <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-6">
                    ${mainContent}
                </div>
            </div>
        </div>
    `;
}

export function renderActivityDetailView() {
    renderMobileHeaderActions([
        { action: 'back-to-schedule', label: t('back_to_schedule'), icon: 'arrow-left' }
    ]);

    const { name, day, time, date, id: activityId } = state.selectedActivity;
    const entryId = `${activityId}_${date}`;
    const entry = state.classEntries[entryId] || { planned: '', completed: '', annotations: {} };
    const studentsInClass = state.students
        .filter(s => state.selectedActivity.studentIds?.includes(s.id))
        .sort(sortStudentsByName);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    const activeLearningActivities = state.learningActivities
        .filter(act => act.classId === activityId)
        .map(act => {
            const startDate = act.startDate ? new Date(act.startDate + 'T00:00:00') : null;
            const endDate = act.endDate ? new Date(act.endDate + 'T23:59:59') : null;
            return {
                activity: act,
                startDate,
                endDate,
            };
        })
        .filter(item => {
            if (item.startDate && todayStart < item.startDate) {
                return false;
            }
            if (item.endDate && todayStart > item.endDate) {
                return false;
            }
            return true;
        })
        .map(item => ({
            ...item,
            daysRemaining: item.endDate ? Math.max(0, Math.ceil((item.endDate.getTime() - todayStart.getTime()) / MS_PER_DAY)) : null,
        }))
        .sort((a, b) => {
            if (a.endDate && b.endDate) {
                return a.endDate - b.endDate;
            }
            if (a.endDate) return -1;
            if (b.endDate) return 1;
            return (a.activity.title || '').localeCompare(b.activity.title || '');
        });

    const formatDueLabel = (item) => {
        if (!item.endDate) {
            return t('due_in_days_open');
        }
        const days = item.daysRemaining ?? 0;
        if (days <= 0) {
            return t('due_in_days_today');
        }
        if (days === 1) {
            return t('due_in_days_one');
        }
        return t('due_in_days_other').replace('%COUNT%', days);
    };

    const activeLearningActivitiesListHtml = activeLearningActivities.length > 0
        ? `<ul class="space-y-2">${activeLearningActivities.map(item => {
            const title = item.activity.title?.trim() || t('activities_untitled_label');
            const dueLabel = formatDueLabel(item);
            return `
                <li class="flex items-center justify-between gap-3 p-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
                    <span class="text-sm font-medium text-blue-900 dark:text-blue-100">${title}</span>
                    <span class="text-xs font-semibold text-blue-700 dark:text-blue-200">${dueLabel}</span>
                </li>
            `;
        }).join('')}</ul>`
        : `<p class="text-sm text-gray-500 dark:text-gray-400">${t('no_active_learning_activities')}</p>`;

    const attendanceOptions = [
        {
            status: STUDENT_ATTENDANCE_STATUS.LATE_SHORT,
            icon: 'clock-2',
            label: t('attendance_late_short'),
            shortLabel: t('attendance_late_short_short'),
            activeClasses: 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-200 dark:border-yellow-700'
        },
        {
            status: STUDENT_ATTENDANCE_STATUS.LATE_LONG,
            icon: 'clock-alert',
            label: t('attendance_late_long'),
            shortLabel: t('attendance_late_long_short'),
            activeClasses: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-700'
        },
        {
            status: STUDENT_ATTENDANCE_STATUS.ABSENCE,
            icon: 'circle-x',
            label: t('attendance_absence'),
            shortLabel: t('attendance_absence_short'),
            activeClasses: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700'
        }
    ];

    const basePillClass = 'px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-700';
    const inactivePillClass = 'bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600';

    const entryAnnotations = entry.annotations || {};
    const locale = document.documentElement.lang || 'es';

    const studentAnnotationsCardsHtml = studentsInClass.length > 0 ? studentsInClass.map(student => {
        const annotationData = normalizeStudentAnnotation(entryAnnotations[student.id], entryId);
        const attendanceButtons = attendanceOptions.map(option => {
            const isActive = annotationData.attendance === option.status;
            const buttonClasses = `${basePillClass} ${isActive ? option.activeClasses : inactivePillClass}`;
            return `
                <button type="button" data-action="toggle-attendance-status" data-student-id="${student.id}" data-status="${option.status}" class="${buttonClasses}" aria-pressed="${isActive}" title="${option.label}" aria-label="${option.label}">
                    <i data-lucide="${option.icon}" class="w-4 h-4"></i>
                    <span class="sr-only">${option.label}</span>
                </button>
            `;
        }).join('');

        const positivesCount = Array.isArray(annotationData.positives) ? annotationData.positives.length : 0;
        const commentsCount = Array.isArray(annotationData.comments) ? annotationData.comments.length : 0;
        const incidentsCount = Array.isArray(annotationData.incidents) ? annotationData.incidents.length : 0;
        const positiveButtonClasses = `${basePillClass} ${positivesCount > 0 ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-200 dark:border-green-700' : inactivePillClass}`;
        const commentButtonClasses = `${basePillClass} ${commentsCount > 0 ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700' : inactivePillClass}`;
        const incidentButtonClasses = `${basePillClass} ${incidentsCount > 0 ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700' : inactivePillClass}`;

        const formatRecordTimestamp = (record) => {
            if (!record?.createdAt) return '';
            const recordDate = new Date(record.createdAt);
            if (Number.isNaN(recordDate.getTime())) return '';
            return recordDate.toLocaleString(locale, { hour: '2-digit', minute: '2-digit' });
        };

        const positivesInfo = positivesCount > 0 ? `
            <div class="space-y-1">
                <p class="text-xs font-semibold text-green-700 dark:text-green-300 flex items-center gap-1">
                    <i data-lucide="shield-plus" class="w-3 h-3"></i>
                    ${t('positive_record_label')}
                </p>
                <ul class="space-y-1">
                    ${(Array.isArray(annotationData.positives) ? annotationData.positives : []).map(record => `
                        <li>
                            <button type="button" data-action="edit-positive-record" data-entry-id="${entryId}" data-student-id="${student.id}" data-record-id="${record.id}" class="w-full text-left bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/40 rounded-md p-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-green-100 dark:hover:bg-green-900/30 focus:outline-none focus:ring-2 focus:ring-green-400/60">
                                <p>${record.content}</p>
                                ${formatRecordTimestamp(record) ? `<p class="text-[10px] text-green-600 dark:text-green-300 mt-1">${formatRecordTimestamp(record)}</p>` : ''}
                            </button>
                        </li>
                    `).join('')}
                </ul>
            </div>
        ` : '';

        const commentsInfo = commentsCount > 0 ? `
            <div class="space-y-1">
                <p class="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1">
                    <i data-lucide="message-square-more" class="w-3 h-3"></i>
                    ${t('comment_record_label')}
                </p>
                <ul class="space-y-1">
                    ${(Array.isArray(annotationData.comments) ? annotationData.comments : []).map(record => `
                        <li>
                            <button type="button" data-action="edit-comment-record" data-entry-id="${entryId}" data-student-id="${student.id}" data-record-id="${record.id}" class="w-full text-left bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-md p-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-900/30 focus:outline-none focus:ring-2 focus:ring-blue-400/60">
                                <p>${record.content}</p>
                                ${formatRecordTimestamp(record) ? `<p class="text-[10px] text-blue-600 dark:text-blue-300 mt-1">${formatRecordTimestamp(record)}</p>` : ''}
                            </button>
                        </li>
                    `).join('')}
                </ul>
            </div>
        ` : '';

        const incidentsInfo = incidentsCount > 0 ? `
            <div class="space-y-1">
                <p class="text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-1">
                    <i data-lucide="shield-alert" class="w-3 h-3"></i>
                    ${t('incident_record_label')}
                </p>
                <ul class="space-y-1">
                    ${(Array.isArray(annotationData.incidents) ? annotationData.incidents : []).map(record => `
                        <li>
                            <button type="button" data-action="edit-incident-record" data-entry-id="${entryId}" data-student-id="${student.id}" data-record-id="${record.id}" class="w-full text-left bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 rounded-md p-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-red-100 dark:hover:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-400/60">
                                <p>${record.content}</p>
                                ${formatRecordTimestamp(record) ? `<p class="text-[10px] text-red-600 dark:text-red-300 mt-1">${formatRecordTimestamp(record)}</p>` : ''}
                            </button>
                        </li>
                    `).join('')}
                </ul>
            </div>
        ` : '';

        const extraInfo = [positivesInfo, commentsInfo, incidentsInfo].filter(Boolean).join('');

        return `
            <div id="student-annotation-${student.id}" data-student-name="${escapeAttribute(student.name)}" class="p-3 border border-gray-200 dark:border-gray-700 rounded-md space-y-3 bg-gray-50/60 dark:bg-gray-900/40">
                <div class="flex flex-wrap items-center gap-3">
                    <button data-action="select-student" data-student-id="${student.id}" class="text-left font-medium text-blue-600 dark:text-blue-400 hover:underline">
                        ${student.name}
                    </button>
                    <div class="flex flex-wrap items-center gap-2 ml-auto justify-end sm:flex-nowrap">
                        ${attendanceButtons}
                        <button type="button" data-action="add-positive-record" data-student-id="${student.id}" class="${positiveButtonClasses}" title="${t('add_positive_record')}" aria-label="${t('add_positive_record')}">
                            <i data-lucide="shield-plus" class="w-4 h-4"></i>
                            <span class="sr-only">${t('positive_record_label')}</span>
                            ${positivesCount > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-green-900/60 text-xs font-semibold">${positivesCount}</span>` : ''}
                        </button>
                        <button type="button" data-action="add-comment-record" data-student-id="${student.id}" class="${commentButtonClasses}" title="${t('add_comment_record')}" aria-label="${t('add_comment_record')}">
                            <i data-lucide="message-square-more" class="w-4 h-4"></i>
                            <span class="sr-only">${t('comment_record_label')}</span>
                            ${commentsCount > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-blue-900/60 text-xs font-semibold">${commentsCount}</span>` : ''}
                        </button>
                        <button type="button" data-action="add-incident-record" data-student-id="${student.id}" class="${incidentButtonClasses}" title="${t('add_incident_record')}" aria-label="${t('add_incident_record')}">
                            <i data-lucide="shield-alert" class="w-4 h-4"></i>
                            <span class="sr-only">${t('incident_record_label')}</span>
                            ${incidentsCount > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-red-900/60 text-xs font-semibold">${incidentsCount}</span>` : ''}
                        </button>
                    </div>
                </div>
                ${extraInfo ? `<div class="space-y-2">${extraInfo}</div>` : ''}
            </div>
        `;
    }).join('') : '';

    const studentAnnotationsSection = studentsInClass.length > 0
        ? `
            <div class="mb-4">
                <label for="student-quick-filter" class="sr-only">${t('student_filter_label')}</label>
                <div class="relative">
                    <i data-lucide="search" class="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"></i>
                    <input type="text"
                           id="student-quick-filter"
                           data-action="filter-student-annotations"
                           placeholder="${t('student_filter_placeholder')}"
                           class="w-full p-2 pl-9 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md" />
                </div>
            </div>
            <div data-student-annotations-list class="space-y-4 flex-1 overflow-y-auto pr-2">
                ${studentAnnotationsCardsHtml}
                <p data-student-filter-empty class="text-sm text-gray-500 dark:text-gray-400 hidden">${t('student_filter_no_results')}</p>
            </div>
        `
        : `<p class="text-gray-500 dark:text-gray-400">${t('no_students_assigned')}</p>`;
    
    const prevSession = findPreviousSession(activityId, new Date(date));
    const nextSession = findNextSession(activityId, new Date(date));

    const prevButton = prevSession ? `<button data-action="navigate-to-session" data-activity-id="${activityId}" data-day="${prevSession.day}" data-time="${prevSession.time}" data-date="${prevSession.date}" class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center gap-2"><i data-lucide="arrow-left"></i> ${t('previous_session')}</button>` : `<button class="bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 px-4 py-2 rounded-md cursor-not-allowed flex items-center gap-2" disabled><i data-lucide="arrow-left"></i> ${t('previous_session')}</button>`;
    const nextButton = nextSession ? `<button data-action="navigate-to-session" data-activity-id="${activityId}" data-day="${nextSession.day}" data-time="${nextSession.time}" data-date="${nextSession.date}" class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center gap-2">${t('next_session')} <i data-lucide="arrow-right"></i></button>` : `<button class="bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 px-4 py-2 rounded-md cursor-not-allowed flex items-center gap-2" disabled>${t('next_session')} <i data-lucide="arrow-right"></i></button>`;


    return `
        <div class="p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/50 min-h-full">
            <div class="hidden sm:flex justify-between items-center mb-2">
                <div>
                    <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200">${name}</h2>
                    <p class="text-gray-500 dark:text-gray-400">${t(day.toLowerCase())}, ${new Date(date + 'T00:00:00').toLocaleDateString(document.documentElement.lang, {day: 'numeric', month: 'long', year: 'numeric'})} (${time})</p>
                </div>
                <button data-action="back-to-schedule" class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600">${t('back_to_schedule')}</button>
            </div>
             <p class="sm:hidden text-gray-500 dark:text-gray-400 mb-4">${t(day.toLowerCase())}, ${new Date(date + 'T00:00:00').toLocaleDateString(document.documentElement.lang, {day: 'numeric', month: 'long', year: 'numeric'})} (${time})</p>
            <div class="flex justify-between items-center mb-6">
                ${prevButton}
                ${nextButton}
            </div>
            <div class="grid md:grid-cols-2 gap-6">
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-6">
                    <div>
                        <h3 class="text-xs font-semibold tracking-wide text-blue-700 dark:text-blue-200 uppercase">${t('active_learning_activities_title')}</h3>
                        <div class="mt-3">${activeLearningActivitiesListHtml}</div>
                    </div>
                    <div><label class="block text-lg font-semibold mb-2 text-gray-700 dark:text-gray-300">${t('planning_for_today')}</label><textarea data-action="planned-change" placeholder="${t('planning_placeholder')}" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md h-32">${entry.planned || ''}</textarea></div>
                    <div><label class="block text-lg font-semibold mb-2 text-gray-700 dark:text-gray-300">${t('summary_of_session')}</label><textarea data-action="completed-change" placeholder="${t('summary_placeholder')}" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md h-32">${entry.completed || ''}</textarea></div>
                </div>
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md flex flex-col md:h-[calc(100vh-260px)]">
                    <h3 class="text-lg font-semibold mb-3">${t('student_annotations_title')}</h3>
                    ${studentAnnotationsSection}
                </div>
            </div>
        </div>
    `;
}
