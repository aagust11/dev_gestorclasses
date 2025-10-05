// main.js: Punt d'entrada de l'aplicació.

import { state, loadState } from './state.js';
import { renderActiveView } from './views.js';
import { actionHandlers } from './actions.js';

const mainContent = document.getElementById('main-content');
const navButtons = document.querySelectorAll('.nav-button');
const sidebar = document.getElementById('sidebar');
const openSidebarBtn = document.getElementById('open-sidebar-btn');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const mobileHeaderTitle = document.getElementById('mobile-header-title');
const themeSwitcherBtns = document.querySelectorAll('.theme-switcher');

function updateMobileHeader() {
    const titles = {
        subjects: 'Assignatures',
        students: 'Alumnes',
        evaluation: 'Avaluació',
        attendance: 'Assistència',
        settings: 'Configuració'
    };
    if (mobileHeaderTitle) {
        mobileHeaderTitle.textContent = titles[state.activeView] || 'Gestor de classes';
    }
}

function updateNavButtons() {
    navButtons.forEach(btn => {
        const view = btn.dataset.view;
        const isActive = view === state.activeView;
        btn.classList.toggle('bg-blue-600', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('text-gray-600', !isActive);
        btn.classList.toggle('dark:text-gray-300', !isActive);
    });
}

function render() {
    if (!mainContent) return;
    mainContent.innerHTML = `<div class="animate-fade-in">${renderActiveView()}</div>`;
    updateMobileHeader();
    updateNavButtons();
    attachEventListeners();
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function toggleSidebar(show) {
    if (!sidebar || !sidebarOverlay) return;
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
        const buttonTheme = btn.dataset.theme;
        const isActive = buttonTheme === theme;
        btn.classList.toggle('bg-blue-600', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('text-gray-600', !isActive);
    });
}

function handleAction(action, element, event) {
    const handler = actionHandlers[action];
    if (!handler) return;
    const result = handler(element, event);
    if (result !== false) {
        render();
    }
}

function attachEventListeners() {
    const elements = document.querySelectorAll('[data-action]');
    elements.forEach(el => {
        if (el.dataset.listenerAttached === 'true') return;
        const action = el.dataset.action;
        const eventType = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? 'input' : 'click';

        el.addEventListener(eventType, (event) => {
            if (el.closest('.nav-button')) {
                toggleSidebar(false);
            }
            handleAction(action, el, event);
        });

        el.dataset.listenerAttached = 'true';
    });
}

function initNavigation() {
    navButtons.forEach(btn => {
        if (btn.dataset.listenerAttached === 'true') return;
        btn.addEventListener('click', (event) => {
            const view = btn.dataset.view;
            if (view) {
                state.activeView = view;
                render();
            }
            toggleSidebar(false);
        });
        btn.dataset.listenerAttached = 'true';
    });
}

function initTheme() {
    const stored = localStorage.getItem('theme') || 'system';
    setTheme(stored);
    themeSwitcherBtns.forEach(btn => {
        if (btn.dataset.listenerAttached === 'true') return;
        btn.addEventListener('click', () => setTheme(btn.dataset.theme));
        btn.dataset.listenerAttached = 'true';
    });
}

function initSidebarControls() {
    openSidebarBtn?.addEventListener('click', () => toggleSidebar(true));
    closeSidebarBtn?.addEventListener('click', () => toggleSidebar(false));
    sidebarOverlay?.addEventListener('click', () => toggleSidebar(false));
}

function bootstrap() {
    loadState();
    initTheme();
    initNavigation();
    initSidebarControls();
    render();
}

bootstrap();
