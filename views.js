// views.js: Contiene todas las funciones que generan el HTML de las vistas.

import { state, LEARNING_ACTIVITY_STATUS, RUBRIC_LEVELS, calculateLearningActivityStatus } from './state.js';
import { darkenColor, getWeekStartDate, getWeekDateRange, formatDate, isSameDate, findNextSession, findPreviousSession, DAY_KEYS, findNextClassSession, getCurrentTermDateRange, getWeeksForCourse, isHoliday, normalizeStudentAnnotation, STUDENT_ATTENDANCE_STATUS } from './utils.js';
import { t } from './i18n.js';

const sortStudentsByName = (studentA, studentB) => studentA.name.localeCompare(studentB.name);

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttribute = (value = '') => escapeHtml(value).replace(/\n/g, '&#10;');

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
    const classes = state.activities.filter(a => a.type === 'class').sort((a, b) => a.name.localeCompare(b.name));

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

    const selectOptions = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

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
            }
        };

        const activitiesHtml = visibleActivities.map(activity => {
            const assignedCount = Array.isArray(activity.criteriaRefs) ? activity.criteriaRefs.length : 0;
            const assignedLabelContent = assignedCount > 0
                ? `${assignedCount} ${t('activities_assigned_criteria_label')}`
                : `<span class="inline-flex items-center gap-1"><i data-lucide="crosshair" class="w-3 h-3"></i>${t('activities_assigned_criteria_none')}</span>`;
            const createdDate = formatDateForDisplay(activity.createdAt);
            const description = activity.description?.trim();
            const startDateDisplay = formatDateForDisplay(activity.startDate);
            const endDateDisplay = formatDateForDisplay(activity.endDate);
            const dateRangeHtml = (startDateDisplay || endDateDisplay)
                ? `<div class="mt-3 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2"><i data-lucide="calendar-range" class="w-4 h-4"></i><span>${[startDateDisplay, endDateDisplay].filter(Boolean).join(' · ')}</span></div>`
                : '';
            const status = calculateLearningActivityStatus(activity);
            activity.status = status;
            const statusInfo = statusMeta[status] || statusMeta[LEARNING_ACTIVITY_STATUS.SCHEDULED];

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
                        <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">${description || t('activities_no_description')}</p>
                        ${dateRangeHtml}
                        ${createdDate ? `<div class="mt-3 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2"><i data-lucide="calendar" class="w-4 h-4"></i><span>${t('activities_created_on')} ${createdDate}</span></div>` : ''}
                    </div>
                    <div class="mt-3 flex items-center justify-between gap-2">
                        <span class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusInfo.classes}">
                            ${statusInfo.label}
                        </span>
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
                        <div>
                            <h3 class="text-xl font-bold" style="color: ${darkenColor(c.color, 40)}">${c.name}</h3>
                            <p class="text-sm text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-2">
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
        .filter(activity => activity.type === 'class')
        .sort((a, b) => a.name.localeCompare(b.name));

    const tabs = [
        { id: 'activities', label: t('evaluation_tab_activities'), icon: 'clipboard-list' },
        { id: 'grades', label: t('evaluation_tab_grades'), icon: 'graduation-cap' }
    ];
    const allowedTabs = tabs.map(tab => tab.id);
    if (!allowedTabs.includes(state.evaluationActiveTab)) {
        state.evaluationActiveTab = 'activities';
    }

    if (state.evaluationActiveTab === 'grades') {
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
        }
    };

    const classCards = classes.map(cls => {
        const classActivities = state.learningActivities
            .filter(activity => activity.classId === cls.id)
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

function renderEvaluationGradesTab(classes) {
    if (classes.length === 0) {
        return `
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
                <p class="text-sm text-gray-600 dark:text-gray-300">${t('evaluation_no_classes')}</p>
            </div>
        `;
    }

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

    if (!selectedClass) {
        return `
            <div class="space-y-4">
                <div class="flex flex-wrap gap-2">${classButtonsHtml}</div>
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
        return `
            <div class="space-y-0.5">
                <div>${escapeHtml(primary)}</div>
                ${secondaryHtml}
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
            const title = activity.title?.trim() || t('activities_untitled_label');
            return `<th scope="col" colspan="${colSpan}" class="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">${escapeHtml(title)}</th>`;
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
                const isNotPresented = Boolean(flags.notPresented);
                const isDeliveredLate = Boolean(flags.deliveredLate);
                const statusTooltipParts = [];
                if (isNotPresented) {
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
                    const textClasses = isNotPresented
                        ? 'text-red-600 dark:text-red-300 font-semibold'
                        : isDeliveredLate
                            ? 'text-amber-600 dark:text-amber-300 font-semibold'
                            : 'text-gray-400';
                    const label = isNotPresented
                        ? t('rubric_flag_not_presented_short')
                        : isDeliveredLate
                            ? t('rubric_flag_delivered_late_short')
                            : '—';
                    const statusIcon = isNotPresented
                        ? '<i data-lucide="shredder" class="w-3.5 h-3.5 inline-block align-text-top ml-1"></i>'
                        : isDeliveredLate
                            ? '<i data-lucide="file-clock" class="w-3.5 h-3.5 inline-block align-text-top ml-1"></i>'
                            : '';
                    return `<td class="px-3 py-2 text-sm text-center align-middle"${tooltipAttr}><span class="${textClasses}">${escapeHtml(label)}</span>${statusIcon}</td>`;
                }

                return rubricItems.map(item => {
                    const scoreLevel = scores[item.id] || '';
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
                    const tooltipAttr = tooltipParts.length > 0 ? ` title="${escapeAttribute(tooltipParts.join('\\n'))}"` : '';
                    let label;
                    let textClasses;
                    if (isNotPresented) {
                        label = t('rubric_flag_not_presented_short');
                        textClasses = 'text-red-600 dark:text-red-300 font-semibold';
                    } else if (scoreLevel) {
                        const key = `rubric_level_${scoreLevel}_label`;
                        const translated = t(key);
                        label = translated !== `[${key}]` ? translated : scoreLevel;
                        textClasses = 'text-gray-800 dark:text-gray-100 font-medium';
                    } else {
                        label = isDeliveredLate ? t('rubric_flag_delivered_late_short') : '—';
                        textClasses = isDeliveredLate
                            ? 'text-amber-600 dark:text-amber-300 font-semibold'
                            : 'text-gray-400';
                    }
                    const statusIcon = isNotPresented
                        ? '<i data-lucide="shredder" class="w-3.5 h-3.5 inline-block align-text-top ml-1"></i>'
                        : isDeliveredLate && !scoreLevel
                            ? '<i data-lucide="file-clock" class="w-3.5 h-3.5 inline-block align-text-top ml-1"></i>'
                            : '';
                    return `<td class="px-3 py-2 text-sm text-center align-middle"${tooltipAttr}><span class="${textClasses}">${escapeHtml(label)}</span>${statusIcon}</td>`;
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
            <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6 shadow-sm">
                ${contentHtml}
            </div>
        </div>
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

    renderMobileHeaderActions([
        { action: 'save-learning-activity-draft', label: t('activities_save_button'), icon: 'save' },
        { action: 'back-to-activities', label: t('back_to_activities'), icon: 'arrow-left' }
    ]);

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
                        <button data-action="back-to-activities" class="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2">
                            <i data-lucide="arrow-left" class="w-4 h-4"></i>
                            ${t('activities_cancel_button')}
                        </button>
                        <button data-action="save-learning-activity-draft" class="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2">
                            <i data-lucide="save" class="w-4 h-4"></i>
                            ${t('activities_save_button')}
                        </button>
                    </div>
                </div>

                <div class="space-y-6">
                    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('activities_form_title_label')}</label>
                            <input type="text" value="${draft.title || ''}" data-action="update-learning-activity-title" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md" placeholder="${t('activities_form_title_placeholder')}">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('activities_form_description_label')}</label>
                            <textarea data-action="update-learning-activity-description" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md h-36" placeholder="${t('activities_form_description_placeholder')}">${draft.description || ''}</textarea>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('start_date')}</label>
                                <input type="date" id="learning-activity-start-date" value="${startDateValue}" data-action="update-learning-activity-start-date" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">${t('end_date')}</label>
                                <input type="date" id="learning-activity-end-date" value="${endDateValue}" data-action="update-learning-activity-end-date" class="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md">
                            </div>
                        </div>
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
                                <i data-lucide="clock-alert" class="w-3 h-3"></i>
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
    
    const scheduleTableRows = state.timeSlots.map(time => {
        const cells = DAY_KEYS.map(day => `
            <td class="p-1 border border-gray-200 dark:border-gray-700">
                <select data-action="schedule-change" data-day="${day}" data-time="${time.label}" class="w-full p-1 border-0 rounded-md focus:ring-1 focus:ring-blue-500 text-xs bg-white dark:bg-gray-700">
                    <option value="">${t('free')}</option>
                    ${state.activities.map(act => `<option value="${act.id}" ${state.schedule[`${day}-${time.label}`] === act.id ? 'selected' : ''}>${act.name}</option>`).join('')}
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
                        <div><label class="block text-sm font-medium">${t('replace_with')}</label><select id="override-activity" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">${state.activities.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select></div>
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
    const activitiesHtml = state.activities.map(act => {
        let studentsInClassHtml = '';
        if (act.type === 'class') {
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

        if (state.editingActivityId === act.id) {
            return `
            <div id="edit-activity-form-${act.id}" class="p-4 border rounded-md bg-white dark:bg-gray-700 border-blue-500">
                <div class="flex justify-between items-center">
                    <input type="color" data-action="change-activity-color" data-id="${act.id}" value="${act.color}" class="p-0 border-none rounded-full cursor-pointer w-7 h-7">
                    <input type="text" id="edit-activity-name-${act.id}" value="${act.name}" class="flex-grow p-1 mx-2 border-0 bg-transparent rounded-md focus:ring-0 font-semibold">
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
                ${studentsInClassHtml}
            </div>`;
        }
        return `
        <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-md">
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-2 flex-grow">
                   <input type="color" data-action="change-activity-color" data-id="${act.id}" value="${act.color}" class="p-0 border-none rounded-full cursor-pointer w-7 h-7">
                   <span class="font-semibold cursor-pointer" data-action="edit-activity" data-id="${act.id}">${act.name} <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">(${act.type === 'class' ? t('class') : t('general')})</span></span>
                </div>
                <button data-action="delete-activity" data-id="${act.id}" class="text-red-500 hover:text-red-700 ml-2"><i data-lucide="trash-2" class="w-5 h-5"></i></button>
            </div>
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
                <div class="flex gap-4 mb-4 text-sm">
                    <label class="flex items-center gap-2"><input type="radio" name="activityType" value="class" checked class="form-radio text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>${t('activity_type_class')}</label>
                    <label class="flex items-center gap-2"><input type="radio" name="activityType" value="general" class="form-radio text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>${t('activity_type_general')}</label>
                </div>
                <div class="space-y-3 max-h-96 overflow-y-auto pr-2">${activitiesHtml}</div>
            </div>
            <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <h3 class="text-lg font-semibold mb-3 flex items-center gap-2"><i data-lucide="clipboard-paste" class="w-5 h-5"></i> ${t('quick_import_title')}</h3>
                <div class="space-y-4">
                    <div><label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t('step1_select_class')}</label><select id="import-target-class" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md"><option value="">${t('choose_a_class')}</option>${state.activities.filter(a => a.type === 'class').map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
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

        return `
            <div id="competency-card-${c.id}" class="bg-white dark:bg-gray-800 rounded-lg shadow-md flex flex-col">
                <div class="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-t-lg flex flex-col gap-2">
                    <div>
                        <h3 class="text-xl font-bold" style="color: ${darkenColor(c.color, 40)}">${c.name}</h3>
                        <div class="text-sm text-gray-600 dark:text-gray-400 mt-2 flex items-center gap-2">
                            <i data-lucide="target" class="w-4 h-4"></i>
                            <span>${competencyCount} ${t('competencies_short_label')}</span>
                        </div>
                    </div>
                    <div class="mt-auto">
                        <button data-action="add-competency" data-activity-id="${c.id}" class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-800">
                            <i data-lucide="plus" class="w-5 h-5"></i>
                            <span class="sr-only">${t('add_competency')}</span>
                        </button>
                    </div>
                </div>
                <div class="p-4 flex flex-col gap-4 flex-grow">
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

    // --- Data Tab Content ---
    const dataTabContent = `
        <div class="max-w-xl mx-auto">
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
            const moveUpDisabled = index === 0 ? 'disabled aria-disabled="true"' : '';
            const moveDownDisabled = index === rubricItems.length - 1 ? 'disabled aria-disabled="true"' : '';

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
                        <div>
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
            active: 'bg-gray-700 text-white border-gray-800 shadow-sm',
            inactive: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-200 dark:border-red-700 dark:hover:bg-red-900/40'
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
            const isDeliveredLate = Boolean(flags.deliveredLate);

            const studentRows = rubricItems.map((item, index) => {
                const competency = competencies.find(comp => comp.id === item.competencyId);
                const fallbackCriterion = availableCriteria.find(opt => opt.criterion?.id === item.criterionId)?.criterion || null;
                const criterion = competency?.criteria?.find(cr => cr.id === item.criterionId) || fallbackCriterion;
                const competencyLabel = competency?.code || t('competency_without_code');
                const criterionCode = criterion?.code || t('criterion_without_code');
                const criterionDescription = criterion?.description || t('criterion_without_description');
                const currentLevel = scores[item.id] || '';

                const scoreCells = RUBRIC_LEVELS.map(level => {
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
                    const disabledAttr = isNotPresented ? ' disabled' : '';
                    const disabledClasses = isNotPresented ? ' opacity-60 cursor-not-allowed' : '';
                    const buttonClasses = `${baseLevelButtonClass} ${isActive ? levelStyles[level].active : levelStyles[level].inactive}${disabledClasses}`;
                    return `<td class="px-2 py-2 text-center align-top">
                        <button type="button" data-action="set-rubric-score" data-learning-activity-id="${activity.id}" data-item-id="${item.id}" data-student-id="${student.id}" data-level="${level}" class="${buttonClasses}" aria-pressed="${isActive}" aria-label="${escapeHtml(ariaLabel)}" title="${escapeHtml(tooltip)}" data-tooltip-comment="${escapeHtml(commentTemplate)}"${disabledAttr} aria-disabled="${isNotPresented}">
                            <span class="block text-[11px] font-bold leading-none">${level}</span>
                            <span class="sr-only">${escapeHtml(levelLabel)}</span>
                        </button>
                    </td>`;
                }).join('');

                const statusBadges = [];
                if (isDeliveredLate && !isNotPresented) {
                    statusBadges.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700"><i data-lucide="file-clock" class="w-3 h-3"></i>${escapeHtml(t('rubric_flag_delivered_late_badge'))}</span>`);
                }
                const statusBadgesHtml = statusBadges.length ? `<div class="mt-1 flex flex-wrap gap-1">${statusBadges.join('')}</div>` : '';

                const notPresentedButtonClasses = `${flagButtonBaseClass} ${(isNotPresented ? flagButtonVariants.notPresented.active : flagButtonVariants.notPresented.inactive)}`;
                const deliveredLateDisabled = isNotPresented;
                const deliveredLateButtonClasses = `${flagButtonBaseClass} ${(isDeliveredLate ? flagButtonVariants.deliveredLate.active : flagButtonVariants.deliveredLate.inactive)}${deliveredLateDisabled ? ' opacity-60 cursor-not-allowed' : ''}`;
                const deliveredLateDisabledAttr = deliveredLateDisabled ? ' disabled aria-disabled="true"' : '';
                const flagButtonsHtml = `
                    <div class="mt-2 flex flex-col gap-1">
                        <button type="button" class="${notPresentedButtonClasses}" data-action="toggle-rubric-not-presented" data-learning-activity-id="${activity.id}" data-student-id="${student.id}" aria-pressed="${isNotPresented}" title="${escapeHtml(t('rubric_flag_not_presented_hint'))}">
                            <i data-lucide="shredder" class="w-3.5 h-3.5"></i>
                            <span>${escapeHtml(t('rubric_flag_not_presented'))}</span>
                            <span class="font-bold">(${escapeHtml(t('rubric_flag_not_presented_short'))})</span>
                        </button>
                        <button type="button" class="${deliveredLateButtonClasses}" data-action="toggle-rubric-delivered-late" data-learning-activity-id="${activity.id}" data-student-id="${student.id}" aria-pressed="${isDeliveredLate}" title="${escapeHtml(t('rubric_flag_delivered_late_hint'))}"${deliveredLateDisabledAttr}>
                            <i data-lucide="file-clock" class="w-3.5 h-3.5"></i>
                            <span>${escapeHtml(t('rubric_flag_delivered_late'))}</span>
                        </button>
                    </div>
                `;

                const nameCell = index === 0
                    ? `<th scope="row" rowspan="${rubricItems.length}" class="px-3 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 align-top min-w-[10rem]">
                            <div>
                                <div>${escapeHtml(student.name)}</div>
                                ${statusBadgesHtml}
                                ${flagButtonsHtml}
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
                <div class="flex flex-wrap items-center gap-3">${tabButtonsHtml}</div>
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

    const annotationsHtml = studentsInClass.length > 0 ? studentsInClass.map(student => {
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
                    <i data-lucide="clock-alert" class="w-3 h-3"></i>
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
            <div id="student-annotation-${student.id}" class="p-3 border border-gray-200 dark:border-gray-700 rounded-md space-y-3 bg-gray-50/60 dark:bg-gray-900/40">
                <div class="flex items-center gap-3">
                    <button data-action="select-student" data-student-id="${student.id}" class="text-left font-medium text-blue-600 dark:text-blue-400 hover:underline">
                        ${student.name}
                    </button>
                    <div class="flex items-center gap-2 ml-auto">
                        <div class="flex items-center gap-2">
                            ${attendanceButtons}
                        </div>
                        <div class="flex items-center gap-2 ml-2">
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
                                <i data-lucide="clock-alert" class="w-4 h-4"></i>
                                <span class="sr-only">${t('incident_record_label')}</span>
                                ${incidentsCount > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-red-900/60 text-xs font-semibold">${incidentsCount}</span>` : ''}
                            </button>
                        </div>
                    </div>
                </div>
                ${extraInfo ? `<div class="space-y-2">${extraInfo}</div>` : ''}
            </div>
        `;
    }).join('') : `<p class="text-gray-500 dark:text-gray-400">${t('no_students_assigned')}</p>`;
    
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
                    <div class="mb-4">
                        <label for="student-quick-nav" class="sr-only">${t('select_student')}</label>
                        <select id="student-quick-nav" data-action="go-to-student" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md">
                            <option value="">-- ${t('select_student')} --</option>
                            ${studentsInClass.map(student => `<option value="${student.id}">${student.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-4 flex-1 overflow-y-auto pr-2">${annotationsHtml}</div>
                </div>
            </div>
        </div>
    `;
}
