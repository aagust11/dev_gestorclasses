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
    const shouldRefreshData = state.activeView !== lastRenderedView;
    if (shouldRefreshData) {
        await refreshDataFromFile();
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
        default: viewContent = views.renderScheduleView();
    }
    mainContent.innerHTML = `<div class="animate-fade-in">${viewContent}</div>`;

    updateMobileHeader();
    lucide.createIcons();
    attachEventListeners();

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
        learningActivityRubric: 'learning_activity_rubric_view_title'
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
        'filter-learning-activity-rubric-students', 'set-evaluation-tab', 'select-evaluation-class',
        'go-to-evaluation-for-learning-activity', 'select-settings-evaluation-class',
        'change-evaluation-modality', 'update-competency-level-value', 'update-competency-minimum',
        'update-competency-max-not-achieved', 'update-competency-aggregation',
        'set-evaluation-no-evidence-behavior', 'set-evaluation-no-evidence-level',
        'set-evaluation-np-treatment', 'save-evaluation-config', 'reset-evaluation-config', 'update-class-template',
        'set-term-grade-calculation-mode', 'calculate-term-grades', 'clear-term-grades', 'update-term-grade-numeric', 'update-term-grade-level',
        'choose-data-file', 'create-data-file', 'reload-data-file', 'clear-data-file-selection'
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

init();
