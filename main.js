// main.js: El punto de entrada principal que une todo.

import { state, loadState, refreshDataFromFile } from './state.js';
import * as views from './views.js';
import { actionHandlers } from './actions.js';
import { initI18n, t } from './i18n.js';

const mainContent = document.getElementById('main-content');
const navButtons = document.querySelectorAll('.nav-button');
const sidebar = document.getElementById('sidebar');
const openSidebarBtn = document.getElementById('open-sidebar-btn');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const mobileHeaderTitle = document.getElementById('mobile-header-title');
const themeSwitcherBtns = document.querySelectorAll('.theme-switcher');

const studentAnnotationActions = new Set([
    'add-positive-record',
    'add-comment-record',
    'add-incident-record',
    'edit-positive-record',
    'edit-comment-record',
    'edit-incident-record'
]);

function captureStudentListState(triggerElement) {
    const list = document.querySelector('[data-student-annotations-list]');
    if (!list) return null;

    const scrollTop = list.scrollTop;
    let studentId = triggerElement?.dataset?.studentId || null;

    if (!studentId && triggerElement) {
        const card = triggerElement.closest('[id^="student-annotation-"]');
        if (card?.id?.startsWith('student-annotation-')) {
            studentId = card.id.replace('student-annotation-', '');
        }
    }

    let relativeOffset = null;
    if (studentId) {
        const cardElement = document.getElementById(`student-annotation-${studentId}`);
        if (cardElement && list.contains(cardElement)) {
            relativeOffset = cardElement.offsetTop - scrollTop;
        }
    }

    return { scrollTop, studentId, relativeOffset };
}

function restoreStudentListState(state) {
    if (!state) return;

    const list = document.querySelector('[data-student-annotations-list]');
    if (!list) return;

    const clampScroll = (value) => {
        const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
        if (Number.isNaN(value)) return list.scrollTop;
        return Math.min(Math.max(value, 0), maxScroll);
    };

    if (state.studentId) {
        const cardElement = document.getElementById(`student-annotation-${state.studentId}`);
        if (cardElement && list.contains(cardElement)) {
            const desiredScroll = typeof state.relativeOffset === 'number'
                ? cardElement.offsetTop - state.relativeOffset
                : cardElement.offsetTop;
            list.scrollTop = clampScroll(desiredScroll);
            return;
        }
    }

    if (typeof state.scrollTop === 'number') {
        list.scrollTop = clampScroll(state.scrollTop);
    }
}

let lastRenderedView = null;

async function render() {
    let shouldRefreshData = state.activeView !== lastRenderedView;
    if (!shouldRefreshData && state.activeView === 'activities' && state.pendingActivitiesRefresh) {
        shouldRefreshData = true;
    }

    if (shouldRefreshData) {
        await refreshDataFromFile();
        if (state.activeView === 'activities') {
            state.pendingActivitiesRefresh = false;
        }
    }

    mainContent.innerHTML = '';
    let viewContent = '';

    switch (state.activeView) {
        case 'schedule': viewContent = views.renderScheduleView(); break;
        case 'classes': viewContent = views.renderClassesView(); break;
        case 'activities': viewContent = views.renderActivitiesView(); break;
        case 'evaluation': viewContent = views.renderEvaluationView(); break;
        case 'learningActivityEditor': viewContent = views.renderLearningActivityEditorView(); break;
        case 'learningActivityRubric': viewContent = views.renderLearningActivityRubricView(); break;
        case 'settings': viewContent = views.renderSettingsView(); break;
        case 'competencyDetail': viewContent = views.renderCompetencyDetailView(); break;
        case 'activityDetail': viewContent = views.renderActivityDetailView(); break;
        case 'studentDetail': viewContent = views.renderStudentDetailView(); break;
        case 'analytics': viewContent = views.renderAnalyticsView(); break;
        case 'seatingChart': viewContent = views.renderSeatingChartView(); break;
        case 'search': viewContent = views.renderSearchView(); break;
        default: viewContent = views.renderScheduleView();
    }
    mainContent.innerHTML = `<div class="animate-fade-in">${viewContent}</div>`;

    updateMobileHeader();
    lucide.createIcons();
    attachEventListeners();

    if (state.activeView === 'analytics') {
        renderAnalyticsCharts();
    }

    if (state.activeView === 'seatingChart') {
        initSeatingChartDragAndDrop();
    }

    if (state.activeView === 'evaluation' && state.pendingEvaluationHighlightActivityId) {
        const activityId = state.pendingEvaluationHighlightActivityId;
        requestAnimationFrame(() => {
            const target = document.querySelector(`[data-evaluation-activity-id="${activityId}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('ring-4', 'ring-blue-400/60');
                setTimeout(() => {
                    target.classList.remove('ring-4', 'ring-blue-400/60');
                }, 1500);
            }
            state.pendingEvaluationHighlightActivityId = null;
        });
    }

    if (state.activeView === 'settings' && state.pendingCompetencyHighlightId) {
        const targetId = state.pendingCompetencyHighlightId;
        requestAnimationFrame(() => {
            const card = document.getElementById(`competency-card-${targetId}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.transition = 'outline 0.1s ease-in-out';
                card.style.outline = '3px solid #3b82f6';
                setTimeout(() => {
                    card.style.outline = 'none';
                }, 1500);
            }
            state.pendingCompetencyHighlightId = null;
        });
    }
    lastRenderedView = state.activeView;
}

function updateMobileHeader() {
    const keyMap = {
        schedule: 'schedule_view_title',
        classes: 'classes_view_title',
        activities: 'activities_view_title',
        evaluation: 'evaluation_view_title',
        settings: 'settings_view_title',
        activityDetail: 'activity_detail_view_title',
        studentDetail: 'student_detail_view_title',
        competencyDetail: 'competency_detail_view_title',
        learningActivityEditor: 'activities_editor_header',
        learningActivityRubric: 'learning_activity_rubric_view_title',
        analytics: 'analytics_view_title',
        seatingChart: 'seating_chart_view_title',
        search: 'search_view_title'
    };
    mobileHeaderTitle.textContent = t(keyMap[state.activeView] || 'app_title');
}

function updateNavButtons() {
    const effectiveView = state.activeView === 'learningActivityEditor' ? 'activities' : state.activeView;
    navButtons.forEach(btn => {
        const view = btn.dataset.view;
        const isActive = view === effectiveView;
        btn.classList.toggle('bg-blue-600', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('text-gray-600', !isActive);
        btn.classList.toggle('dark:text-gray-300', !isActive);
        btn.classList.toggle('hover:bg-gray-200', !isActive);
        btn.classList.toggle('dark:hover:bg-gray-700', !isActive);
    });
}

function handleDeferredExampleLoad() {
    const shouldLoadExample = localStorage.getItem('loadExampleOnNextOpen');
    if (shouldLoadExample === 'true') {
        localStorage.removeItem('loadExampleOnNextOpen');
        actionHandlers['load-example']();
    }
}


function handleAction(action, element, event) {
    const id = element.dataset.id;
    const reRenderActions = [
        'add-activity', 'delete-activity', 'add-student-to-class', 'remove-student-from-class',
        'add-timeslot', 'delete-timeslot', 'reorder-timeslot', 'import-students',
        'select-activity', 'back-to-schedule', 'generate-schedule-slots', 'edit-timeslot',
        'save-timeslot', 'cancel-edit-timeslot', 'edit-activity', 'save-activity',
        'cancel-edit-activity', 'prev-week', 'next-week', 'today', 'select-student', 'back-to-classes',
        'add-selected-student-to-class', 'navigate-to-session', 'add-schedule-override', 'delete-schedule-override',
        'go-to-class-session', 'add-term', 'delete-term', 'select-term', 'go-to-week',
        'add-holiday', 'delete-holiday', 'select-settings-tab',
        'add-competency', 'delete-competency', 'add-criterion', 'delete-criterion',
        'select-competency', 'back-to-competencies', 'toggle-attendance-status',
        'add-positive-record', 'add-comment-record', 'add-incident-record', 'set-student-timeline-filter',
        'edit-positive-record', 'edit-comment-record', 'edit-incident-record',
        'open-learning-activity-editor', 'open-learning-activity-quick', 'back-to-activities',
        'save-learning-activity-draft', 'toggle-learning-activity-list', 'toggle-competency-guide',
        'toggle-competency-list',
        'toggle-learning-activity-criterion', 'open-learning-activity-criteria',
        'close-learning-activity-criteria', 'go-to-competency-settings',
        'open-learning-activity-rubric', 'close-learning-activity-rubric', 'set-learning-activity-rubric-tab',
        'add-rubric-item', 'remove-rubric-item', 'move-rubric-item', 'set-rubric-score',
        'update-rubric-item-scoring-mode', 'update-rubric-item-max-score', 'set-rubric-numeric-score',
        'filter-learning-activity-rubric-students', 'set-evaluation-tab', 'select-evaluation-class',
        'go-to-evaluation-for-learning-activity', 'select-settings-evaluation-class',
        'change-evaluation-modality', 'update-competency-level-value', 'update-competency-minimum',
        'update-competency-weight',
        'update-competency-max-not-achieved', 'update-competency-aggregation',
        'set-evaluation-no-evidence-behavior', 'set-evaluation-no-evidence-level',
        'set-evaluation-np-treatment', 'save-evaluation-config', 'reset-evaluation-config', 'update-class-template',
        'set-term-grade-calculation-mode', 'calculate-term-grades', 'recalculate-term-final-grades', 'clear-term-grades', 'update-term-grade-numeric', 'update-term-grade-level',
        'update-learning-activity-term',
        'choose-data-file', 'create-data-file', 'reload-data-file', 'clear-data-file-selection',
        'analytics-change-tab', 'analytics-change-class', 'analytics-change-student',
        'seating-chart-change-class', 'seating-chart-toggle-edit', 'seating-chart-reset',
        'search-input', 'go-to-search-result', 'add-resource', 'delete-resource',
        'add-session-resource', 'delete-session-resource'
    ];
    const forceRenderActions = ['toggle-rubric-not-presented', 'toggle-rubric-delivered-late'];
    const shouldForceRender = forceRenderActions.includes(action);

    if (actionHandlers[action]) {
        const result = actionHandlers[action](id, element, event);

        if (shouldForceRender || reRenderActions.includes(action)) {
            const previousSelection = (() => {
                if (action === 'filter-learning-activity-rubric-students' && element instanceof HTMLInputElement) {
                    return {
                        start: element.selectionStart,
                        end: element.selectionEnd
                    };
                }
                return null;
            })();

            const rerender = async () => {
                const studentListState = studentAnnotationActions.has(action)
                    ? captureStudentListState(element)
                    : null;
                await render();
                if (studentListState) {
                    restoreStudentListState(studentListState);
                }
                if (action === 'edit-activity') {
                    const targetElement = document.getElementById(`edit-activity-form-${id}`);
                    if (targetElement) {
                        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
                if (action === 'filter-learning-activity-rubric-students') {
                    requestAnimationFrame(() => {
                        const searchInput = document.getElementById('rubric-student-search');
                        if (searchInput instanceof HTMLInputElement) {
                            searchInput.focus({ preventScroll: true });
                            const { start, end } = previousSelection || {};
                            const caretPosition = typeof start === 'number' ? start : searchInput.value.length;
                            const selectionEnd = typeof end === 'number' ? end : caretPosition;
                            try {
                                searchInput.setSelectionRange(caretPosition, selectionEnd);
                            } catch (err) {
                                // Some input types do not support setSelectionRange; ignore in that case.
                            }
                        }
                    });
                }
            };

            if (!shouldForceRender && result && typeof result.then === 'function') {
                result.then(() => rerender()).catch(console.error);
            } else {
                rerender().catch(console.error);
            }
        }
    }
}

function attachEventListeners() {
    const elements = document.querySelectorAll('[data-action]');
    elements.forEach(el => {
        const action = el.dataset.action;
        const customEvent = el.dataset.event;
        const defaultEvent = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? 'input' : 'click';
        const eventType = customEvent || defaultEvent;

        if (el.dataset.listenerAttached === 'true') return;
        
        if (action === 'import-data-mobile') return;

        const listener = (e) => {
             if (el.closest('.nav-button')) {
                toggleSidebar(false);
            }
            handleAction(action, el, e)
        };

        el.addEventListener(eventType, listener);
        el.dataset.listenerAttached = 'true';
    });
    
    const importInput = document.getElementById('import-file-input');
    if (importInput && importInput.dataset.listenerAttached !== 'true') {
        importInput.addEventListener('change', (e) => handleAction('import-data', importInput, e));
        importInput.dataset.listenerAttached = 'true';
    }
    
    const mobileImportInput = document.getElementById('import-file-input-mobile');
    if (mobileImportInput && mobileImportInput.dataset.listenerAttached !== 'true') {
        mobileImportInput.addEventListener('change', (e) => handleAction('import-data', mobileImportInput, e));
        mobileImportInput.dataset.listenerAttached = 'true';
    }

    const importScheduleInput = document.getElementById('import-schedule-input');
    if (importScheduleInput && importScheduleInput.dataset.listenerAttached !== 'true') {
        importScheduleInput.addEventListener('change', (e) => handleAction('import-schedule', importScheduleInput, e));
        importScheduleInput.dataset.listenerAttached = 'true';
    }
}


function toggleSidebar(show) {
    if (show) {
        sidebar.classList.remove('-translate-x-full');
        sidebarOverlay.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        sidebarOverlay.classList.add('hidden');
    }
}

function setTheme(theme) {
    if (theme === 'system') {
        localStorage.removeItem('theme');
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    } else {
        localStorage.setItem('theme', theme);
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }
    updateThemeSwitcherUI(theme);
}

function updateThemeSwitcherUI(theme) {
     themeSwitcherBtns.forEach(btn => {
        const btnTheme = btn.dataset.theme;
        const isActive = btnTheme === theme;
        btn.classList.toggle('bg-blue-600', isActive);
        btn.classList.toggle('text-white', isActive);
         btn.classList.toggle('text-gray-500', !isActive);
        btn.classList.toggle('dark:text-gray-400', !isActive);
    });
}


async function init() {
    const savedTheme = localStorage.getItem('theme') || 'system';
    setTheme(savedTheme);

    await initI18n(async () => {
        await render();
        updateNavButtons();
    });

    await loadState();
    await render();
    updateNavButtons();
    handleDeferredExampleLoad();

    navButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            state.activeView = btn.dataset.view;
            state.selectedActivity = null;
            state.selectedStudentId = null;
            state.learningActivityDraft = null;
            state.learningActivityGuideVisible = false;
            updateNavButtons();
            await render();
            if (window.innerWidth < 640) {
                toggleSidebar(false);
            }
        });
    });
    
    openSidebarBtn.addEventListener('click', () => toggleSidebar(true));
    closeSidebarBtn.addEventListener('click', () => toggleSidebar(false));
    sidebarOverlay.addEventListener('click', () => toggleSidebar(false));
    
    themeSwitcherBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            setTheme(btn.dataset.theme);
        });
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (localStorage.getItem('theme') === 'system') {
            setTheme('system');
        }
    });

    document.addEventListener('render', () => { render().catch(console.error); });
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 640) {
            sidebar.classList.remove('-translate-x-full');
            sidebarOverlay.classList.add('hidden');
        }
    });
}

function renderAnalyticsCharts() {
    const mainChartContainer = document.getElementById('analytics-chart-main');
    const secondaryChartContainer = document.getElementById('analytics-chart-secondary');
    const evolutionChartContainer = document.getElementById('analytics-chart-evolution');

    if (!mainChartContainer || !secondaryChartContainer || !evolutionChartContainer) return;

    // Mock data for now, in a real app we would compute this from state
    const data = [
        { label: 'AE', value: 30 },
        { label: 'AN', value: 45 },
        { label: 'AS', value: 20 },
        { label: 'NA', value: 5 }
    ];

    // Simple D3 Bar Chart for Main
    const width = mainChartContainer.clientWidth;
    const height = 300;
    const margin = { top: 20, right: 20, bottom: 40, left: 40 };

    d3.select(mainChartContainer).selectAll('*').remove();
    const svg = d3.select(mainChartContainer)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const x = d3.scaleBand()
        .domain(data.map(d => d.label))
        .range([margin.left, width - margin.right])
        .padding(0.1);

    const y = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value)])
        .nice()
        .range([height - margin.bottom, margin.top]);

    svg.append('g')
        .attr('fill', 'steelblue')
        .selectAll('rect')
        .data(data)
        .join('rect')
        .attr('x', d => x(d.label))
        .attr('y', d => y(d.value))
        .attr('height', d => y(0) - y(d.value))
        .attr('width', x.bandwidth());

    svg.append('g')
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x));

    svg.append('g')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y));

    // Secondary Chart (Pie)
    d3.select(secondaryChartContainer).selectAll('*').remove();
    const radius = Math.min(width, height) / 2 - margin.top;
    const g = d3.select(secondaryChartContainer)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${width / 2},${height / 2})`);

    const color = d3.scaleOrdinal()
        .domain(data.map(d => d.label))
        .range(d3.schemeCategory10);

    const pie = d3.pie().value(d => d.value);
    const arc = d3.arc().innerRadius(0).outerRadius(radius);

    const arcs = g.selectAll('.arc')
        .data(pie(data))
        .enter().append('g')
        .attr('class', 'arc');

    arcs.append('path')
        .attr('d', arc)
        .attr('fill', d => color(d.data.label));

    // Evolution Chart (Line)
    d3.select(evolutionChartContainer).selectAll('*').remove();
    const evolutionData = [
        { date: new Date(2023, 8, 1), value: 5 },
        { date: new Date(2023, 9, 1), value: 6 },
        { date: new Date(2023, 10, 1), value: 7 },
        { date: new Date(2023, 11, 1), value: 6.5 },
        { date: new Date(2024, 0, 1), value: 8 }
    ];

    const xEv = d3.scaleTime()
        .domain(d3.extent(evolutionData, d => d.date))
        .range([margin.left, width - margin.right]);

    const yEv = d3.scaleLinear()
        .domain([0, 10])
        .range([height - margin.bottom, margin.top]);

    const line = d3.line()
        .x(d => xEv(d.date))
        .y(d => yEv(d.value));

    const svgEv = d3.select(evolutionChartContainer)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    svgEv.append('path')
        .datum(evolutionData)
        .attr('fill', 'none')
        .attr('stroke', 'steelblue')
        .attr('stroke-width', 2)
        .attr('d', line);

    svgEv.append('g')
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(xEv));

    svgEv.append('g')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(yEv));
}

function initSeatingChartDragAndDrop() {
    const grid = document.getElementById('seating-grid');
    if (!grid || !state.seatingChartEditMode) return;

    const students = document.querySelectorAll('[data-student-id]');
    const slots = document.querySelectorAll('[data-slot]');

    students.forEach(student => {
        student.setAttribute('draggable', 'true');
        student.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', student.dataset.studentId);
            student.classList.add('opacity-50');
        });
        student.addEventListener('dragend', () => {
            student.classList.remove('opacity-50');
        });
    });

    slots.forEach(slot => {
        slot.addEventListener('dragover', (e) => {
            e.preventDefault();
            slot.classList.add('bg-blue-50', 'dark:bg-blue-900/20');
        });
        slot.addEventListener('dragleave', () => {
            slot.classList.remove('bg-blue-50', 'dark:bg-blue-900/20');
        });
        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            slot.classList.remove('bg-blue-50', 'dark:bg-blue-900/20');
            const studentId = e.dataTransfer.getData('text/plain');
            const slotIndex = parseInt(slot.dataset.slot);
            
            actionHandlers['seating-chart-move-student'](studentId, slotIndex);
            render();
        });
    });
}

init();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}
