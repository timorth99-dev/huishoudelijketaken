// --- Supabase Client ---
const SUPABASE_URL = 'https://efiwerbxsxinijnrrazo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmaXdlcmJ4c3hpbmlqbnJyYXpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDQ1MjEsImV4cCI6MjA5MjYyMDUyMX0.0-JlYp_irUpYyr1VGu6uQ2YgUjtUK00s6wEgHRkpRWs';

let sb;
try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    document.addEventListener('DOMContentLoaded', () => {
        document.body.innerHTML = '<div style="padding:2rem;text-align:center;color:red;"><h2>Fout bij laden</h2><p>' + e.message + '</p></div>';
    });
    throw e;
}

// --- Date Helpers ---
function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function calcNextDue(lastDone, interval, unit) {
    const d = new Date(lastDone);
    switch (unit) {
        case 'days':   d.setDate(d.getDate() + interval); break;
        case 'weeks':  d.setDate(d.getDate() + interval * 7); break;
        case 'months': d.setMonth(d.getMonth() + interval); break;
    }
    return d;
}

function daysUntil(date) {
    const now = today();
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'long', year: 'numeric'
    });
}

function formatInterval(interval, unit) {
    const labels = { days: 'dag', weeks: 'week', months: 'maand' };
    const label = labels[unit] || unit;
    const plural = interval === 1 ? label : (label === 'maand' ? 'maanden' : label + 'en');
    return `Elke ${interval} ${plural}`;
}

const categoryLabels = {
    keuken: 'ðŸ³ Keuken',
    badkamer: 'ðŸš¿ Badkamer',
    woonkamer: 'ðŸ›‹ï¸ Woonkamer',
    slaapkamer: 'ðŸ›ï¸ Slaapkamer',
    tuin: 'ðŸŒ¿ Tuin',
    overig: 'ðŸ“¦ Overig'
};

// --- App State ---
let tasks = [];
let currentFilter = 'all';

// --- Data Layer (Supabase) ---
async function loadTasks() {
    const { data, error } = await sb
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Fout bij laden taken:', error);
        return [];
    }
    return data;
}

async function insertTask(task) {
    const { data, error } = await sb
        .from('tasks')
        .insert(task)
        .select()
        .single();

    if (error) {
        console.error('Fout bij toevoegen taak:', error.message, error.details, error.hint);
        alert('Fout bij toevoegen: ' + error.message);
        return null;
    }
    return data;
}

async function updateTask(id, updates) {
    const { error } = await sb
        .from('tasks')
        .update(updates)
        .eq('id', id);

    if (error) {
        console.error('Fout bij bijwerken taak:', error);
        return false;
    }
    return true;
}

async function removeTask(id) {
    const { error } = await sb
        .from('tasks')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Fout bij verwijderen taak:', error);
        return false;
    }
    return true;
}

// --- Realtime ---
function subscribeToChanges() {
    sb.channel('tasks-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async (payload) => {
            // Reload all tasks on any change
            tasks = await loadTasks();
            renderTasks();
        })
        .subscribe();
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    // Set default start date to today
    document.getElementById('taskStartDate').valueAsDate = new Date();

    // Load tasks from Supabase
    tasks = await loadTasks();
    renderTasks();
    setupEventListeners();

    // Subscribe to real-time changes
    subscribeToChanges();

    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
});

// --- Event Listeners ---
function setupEventListeners() {
    document.getElementById('taskForm').addEventListener('submit', handleAddTask);
    document.getElementById('editForm').addEventListener('submit', handleEditTask);
    document.getElementById('doneForm').addEventListener('submit', handleDoneSubmit);

    // Close done modal on overlay click
    document.getElementById('doneModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDoneModal();
    });

    // Update next due hint when edit fields change
    ['editLastDone', 'editInterval', 'editUnit'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateNextDueHint);
        document.getElementById(id).addEventListener('input', updateNextDueHint);
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderTasks();
        });
    });

    // Close modal on overlay click
    document.getElementById('editModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEditModal();
    });
}

// --- Add Task ---
async function handleAddTask(e) {
    e.preventDefault();
    const name = document.getElementById('taskName').value.trim();
    const interval = parseInt(document.getElementById('taskInterval').value);
    const unit = document.getElementById('taskUnit').value;
    const category = document.getElementById('taskCategory').value;
    const startDate = document.getElementById('taskStartDate').value;

    if (!name || !interval) return;

    const newTask = await insertTask({
        name,
        interval,
        unit,
        category,
        last_done: new Date(startDate).toISOString()
    });

    if (newTask) {
        tasks.push(newTask);
        renderTasks();
    }

    // Reset form
    document.getElementById('taskName').value = '';
    document.getElementById('taskInterval').value = 7;
    document.getElementById('taskName').focus();
}

// --- Mark Done ---
function markDone(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('doneTaskId').value = id;
    document.getElementById('doneTaskName').textContent = task.name;
    document.getElementById('doneDateInput').valueAsDate = new Date();
    document.getElementById('doneModal').classList.add('active');
}

function closeDoneModal() {
    document.getElementById('doneModal').classList.remove('active');
}

async function handleDoneSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('doneTaskId').value;
    const dateValue = document.getElementById('doneDateInput').value;
    const task = tasks.find(t => t.id === id);
    if (!task || !dateValue) return;

    closeDoneModal();

    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) {
        card.classList.add('completing');
        setTimeout(async () => {
            const success = await updateTask(id, { last_done: new Date(dateValue).toISOString() });
            if (success) {
                task.last_done = new Date(dateValue).toISOString();
                renderTasks();
            }
        }, 600);
    } else {
        const success = await updateTask(id, { last_done: new Date(dateValue).toISOString() });
        if (success) {
            task.last_done = new Date(dateValue).toISOString();
            renderTasks();
        }
    }
}

// --- Delete Task ---
async function deleteTask(id) {
    if (!confirm('Weet je zeker dat je deze taak wilt verwijderen?')) return;
    const success = await removeTask(id);
    if (success) {
        tasks = tasks.filter(t => t.id !== id);
        renderTasks();
    }
}

// --- Edit Task ---
function openEditModal(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('editTaskId').value = id;
    document.getElementById('editName').value = task.name;
    document.getElementById('editInterval').value = task.interval;
    document.getElementById('editUnit').value = task.unit;
    document.getElementById('editCategory').value = task.category;
    document.getElementById('editLastDone').value = new Date(task.last_done).toISOString().split('T')[0];
    updateNextDueHint();

    document.getElementById('editModal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
}

async function handleEditTask(e) {
    e.preventDefault();
    const id = document.getElementById('editTaskId').value;
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const updates = {
        name: document.getElementById('editName').value.trim(),
        interval: parseInt(document.getElementById('editInterval').value),
        unit: document.getElementById('editUnit').value,
        category: document.getElementById('editCategory').value
    };

    const lastDoneInput = document.getElementById('editLastDone').value;
    if (lastDoneInput) {
        updates.last_done = new Date(lastDoneInput).toISOString();
    }

    const success = await updateTask(id, updates);
    if (success) {
        Object.assign(task, updates);
        closeEditModal();
        renderTasks();
    }
}

// --- Next Due Hint ---
function updateNextDueHint() {
    const lastDoneInput = document.getElementById('editLastDone').value;
    const interval = parseInt(document.getElementById('editInterval').value);
    const unit = document.getElementById('editUnit').value;
    const hint = document.getElementById('editNextDueHint');

    if (lastDoneInput && interval > 0) {
        const nextDue = calcNextDue(lastDoneInput, interval, unit);
        hint.textContent = `Volgende keer: ${formatDate(nextDue)}`;
    } else {
        hint.textContent = '';
    }
}

// --- Render ---
function getTaskStatus(task) {
    const nextDue = calcNextDue(task.last_done, task.interval, task.unit);
    const days = daysUntil(nextDue);

    if (days < 0) return 'overdue';
    if (days === 0) return 'today';
    if (days <= 3) return 'upcoming';
    return 'future';
}

function renderTasks() {
    const container = document.getElementById('taskList');

    // Sort: overdue first, then by next due date
    const sorted = [...tasks].sort((a, b) => {
        const dueA = calcNextDue(a.last_done, a.interval, a.unit);
        const dueB = calcNextDue(b.last_done, b.interval, b.unit);
        return dueA - dueB;
    });

    const filtered = sorted.filter(task => {
        if (currentFilter === 'all') return true;
        return getTaskStatus(task) === currentFilter;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">âœ¨</div>
                <p>${currentFilter === 'all' ? 'Nog geen taken. Voeg je eerste taak toe!' : 'Geen taken in deze categorie.'}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(task => {
        const nextDue = calcNextDue(task.last_done, task.interval, task.unit);
        const days = daysUntil(nextDue);
        const status = getTaskStatus(task);

        let dueText;
        if (days < 0) {
            dueText = `<span class="overdue-text">${Math.abs(days)} dag${Math.abs(days) !== 1 ? 'en' : ''} te laat!</span>`;
        } else if (days === 0) {
            dueText = `<span class="today-text">Vandaag!</span>`;
        } else {
            dueText = `Over ${days} dag${days !== 1 ? 'en' : ''} (${formatDate(nextDue)})`;
        }

        // Sanitize task name to prevent XSS
        const safeName = task.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        // Sanitize UUID id for use in HTML attributes
        const safeId = task.id.replace(/[^a-f0-9-]/g, '');

        return `
            <div class="task-card ${status}" data-id="${safeId}">
                <button class="task-done-btn" onclick="markDone('${safeId}')" title="Markeer als gedaan">âœ“</button>
                <div class="task-info">
                    <div class="task-name">
                        ${safeName}
                        <span class="task-category-badge">${categoryLabels[task.category] || task.category}</span>
                    </div>
                    <div class="task-details">
                        ${dueText} Â· ${formatInterval(task.interval, task.unit)}
                    </div>
                </div>
                <div class="task-actions">
                    <button class="edit-btn" onclick="openEditModal('${safeId}')" title="Bewerken">âœï¸</button>
                    <button class="delete-btn" onclick="deleteTask('${safeId}')" title="Verwijderen">ðŸ—‘ï¸</button>
                </div>
            </div>
        `;
    }).join('');
}
