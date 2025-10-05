// state.js: Estat global i persistència de l'aplicació.

const STORAGE_KEY = 'gestorClassesData';

const today = new Date();
const formattedToday = today.toISOString().slice(0, 10);

export const state = {
    activeView: 'subjects',
    subjects: [],
    students: [],
    sharedConfigs: [],
    selectedSubjectId: null,
    selectedEvaluationSubjectId: null,
    selectedEvaluationActivityId: null,
    evaluationViewMode: 'single',
    selectedAttendanceSubjectId: null,
    selectedAttendanceDate: formattedToday,
    settings: {
        evaluationMode: 'numeric',
        qualitativeScale: ['NS', 'S', 'B', 'E'],
        competencyCodeText: '',
        criterionCodeText: ''
    }
};

let saveTimeout;

export function saveState() {
    const dataToSave = {
        subjects: state.subjects,
        students: state.students,
        sharedConfigs: state.sharedConfigs,
        settings: state.settings
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));

    const indicator = document.getElementById('save-indicator');
    if (indicator) {
        indicator.classList.add('show');
        if (window.lucide) {
            window.lucide.createIcons({
                nodes: [indicator.querySelector('i')]
            });
        }
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            indicator.classList.remove('show');
        }, 1500);
    }
}

export function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
        return;
    }

    try {
        const parsed = JSON.parse(saved);
        state.subjects = parsed.subjects || [];
        state.students = parsed.students || [];
        state.sharedConfigs = parsed.sharedConfigs || [];
        state.settings = {
            evaluationMode: 'numeric',
            qualitativeScale: ['NS', 'S', 'B', 'E'],
            competencyCodeText: '',
            criterionCodeText: '',
            ...parsed.settings
        };
    } catch (error) {
        console.error('Error carregant les dades desades', error);
    }
}
