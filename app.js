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
    const plurals = { days: 'dagen', weeks: 'weken', months: 'maanden' };
    const label = labels[unit] || unit;
    const plural = plurals[unit] || (label + 'en');
    return `Elke ${interval} ${interval === 1 ? label : plural}`;
}

const categoryLabels = {
    keuken: '🍳 Keuken',
    badkamer: '🚿 Badkamer',
    woonkamer: '🛋️ Woonkamer',
    slaapkamer: '🛏️ Slaapkamer',
    tuin: '🌿 Tuin',
    overig: '📦 Overig'
};

// --- App State ---
let tasks = [];
let currentFilter = 'all';

// --- VAPID Public Key ---
const VAPID_PUBLIC_KEY = 'BLBKquXeNOKW6Xb4-y1aKEAmIPrP2uFS3n_qdAM7WOWdzwNB9_nhyFT4dG1gOMGyct7Ls25Zt4eb3tRi-GxyHm4';

// --- Push Notifications ---
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function subscribeToPush(registration) {
    try {
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        const subJson = subscription.toJSON();
        // Save to Supabase
        const { error } = await sb
            .from('push_subscriptions')
            .upsert({
                endpoint: subJson.endpoint,
                p256dh: subJson.keys.p256dh,
                auth: subJson.keys.auth
            }, { onConflict: 'endpoint' });

        if (error) {
            console.error('Fout bij opslaan push subscription:', error);
            return false;
        }
        return true;
    } catch (err) {
        console.error('Push subscription mislukt:', err);
        return false;
    }
}

async function unsubscribeFromPush() {
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            const endpoint = subscription.endpoint;
            await subscription.unsubscribe();
            // Remove from Supabase
            await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
        }
    } catch (err) {
        console.error('Uitschrijven mislukt:', err);
    }
}

async function checkPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return 'unsupported';
    }
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        return subscription ? 'subscribed' : 'unsubscribed';
    } catch {
        return 'unsupported';
    }
}

function updateNotificationButton(status) {
    const btn = document.getElementById('notifBtn');
    if (!btn) return;

    if (status === 'unsupported') {
        btn.style.display = 'none';
        return;
    }

    btn.style.display = 'flex';
    if (status === 'subscribed') {
        btn.textContent = '🔔';
        btn.title = 'Meldingen uitschakelen';
        btn.classList.add('active');
    } else {
        btn.textContent = '🔕';
        btn.title = 'Meldingen inschakelen';
        btn.classList.remove('active');
    }
}

async function toggleNotifications() {
    const status = await checkPushSubscription();

    if (status === 'subscribed') {
        await unsubscribeFromPush();
        updateNotificationButton('unsubscribed');
        return;
    }

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        alert('Je hebt meldingen geblokkeerd. Schakel ze in via je browserinstellingen.');
        return;
    }

    const registration = await navigator.serviceWorker.ready;
    const success = await subscribeToPush(registration);
    updateNotificationButton(success ? 'subscribed' : 'unsubscribed');

    if (success) {
        // Send a test notification immediately
        registration.showNotification('🏠 Meldingen ingeschakeld!', {
            body: 'Je ontvangt nu meldingen als taken bijna moeten worden uitgevoerd.',
            icon: '/icons/icon-192.svg'
        });
    }
}

// --- Check tasks due soon & send local notification ---
async function checkAndNotifyDueTasks() {
    if (Notification.permission !== 'granted') return;
    if (!tasks.length) return;

    const todayKey = today().toISOString().split('T')[0];
    const notifiedKey = 'notified_' + todayKey;
    const alreadyNotified = JSON.parse(localStorage.getItem(notifiedKey) || '[]');

    const dueSoon = tasks.filter(task => {
        const nextDue = calcNextDue(task.last_done, task.interval, task.unit);
        const days = daysUntil(nextDue);
        return days >= 0 && days <= 2 && !alreadyNotified.includes(task.id);
    });

    if (dueSoon.length === 0) return;

    const registration = await navigator.serviceWorker.ready;
    for (const task of dueSoon) {
        const nextDue = calcNextDue(task.last_done, task.interval, task.unit);
        const days = daysUntil(nextDue);
        let body;
        if (days === 0) {
            body = `"${task.name}" moet vandaag worden uitgevoerd!`;
        } else if (days === 1) {
            body = `"${task.name}" moet morgen worden uitgevoerd!`;
        } else {
            body = `"${task.name}" moet over ${days} dagen worden uitgevoerd (${formatDate(nextDue)}).`;
        }

        registration.showNotification('🏠 Taak binnenkort!', {
            body: body,
            icon: '/icons/icon-192.svg',
            badge: '/icons/icon-192.svg',
            tag: 'task-' + task.id,
            data: { url: '/' }
        });

        alreadyNotified.push(task.id);
    }
    localStorage.setItem(notifiedKey, JSON.stringify(alreadyNotified));

    // Clean up old notification keys
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('notified_') && key !== notifiedKey) {
            localStorage.removeItem(key);
        }
    }
}

// --- Test Notification ---
async function sendTestNotification() {
    if (!('serviceWorker' in navigator)) {
        alert('Service Worker niet beschikbaar.');
        return;
    }

    if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            alert('Je hebt meldingen geblokkeerd.');
            return;
        }
    }

    const registration = await navigator.serviceWorker.ready;
    registration.showNotification('🧪 Test melding', {
        body: 'Push notificaties werken! Je ontvangt meldingen als taken bijna moeten.',
        icon: '/icons/icon-192.svg',
        badge: '/icons/icon-192.svg'
    });
}

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

    // Setup swipe-to-delete
    initSwipe();

    // Initialize push notification UI
    const pushStatus = await checkPushSubscription();
    updateNotificationButton(pushStatus);

    // Check for tasks due soon and notify
    if (pushStatus === 'subscribed') {
        checkAndNotifyDueTasks();
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

    document.getElementById('addModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeAddModal();
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
    closeAddModal();
}

// --- Add Modal ---
function openAddModal() {
    document.getElementById('taskStartDate').valueAsDate = new Date();
    document.getElementById('addModal').classList.add('active');
    document.getElementById('taskName').focus();
}

function closeAddModal() {
    document.getElementById('addModal').classList.remove('active');
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
                <div class="icon">✨</div>
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

        // Last done info
        const lastDoneDate = formatDate(task.last_done);
        const daysSinceDone = Math.abs(daysUntil(task.last_done));
        const weeksSinceDone = Math.floor(daysSinceDone / 7);
        const remainingDays = daysSinceDone % 7;
        const monthsSinceDone = Math.floor(daysSinceDone / 30);
        const remainingWeeksAfterMonths = Math.floor((daysSinceDone % 30) / 7);
        let sinceText;
        if (daysSinceDone === 0) {
            sinceText = 'vandaag';
        } else if (weeksSinceDone === 0) {
            sinceText = `${daysSinceDone} dag${daysSinceDone !== 1 ? 'en' : ''} geleden`;
        } else if (monthsSinceDone >= 1) {
            sinceText = `${monthsSinceDone} ${monthsSinceDone === 1 ? 'maand' : 'maanden'}`;
            if (remainingWeeksAfterMonths > 0) {
                sinceText += ` en ${remainingWeeksAfterMonths} ${remainingWeeksAfterMonths === 1 ? 'week' : 'weken'}`;
            }
            sinceText += ' geleden';
        } else if (remainingDays === 0) {
            sinceText = `${weeksSinceDone} ${weeksSinceDone === 1 ? 'week' : 'weken'} geleden`;
        } else {
            sinceText = `${weeksSinceDone} ${weeksSinceDone === 1 ? 'week' : 'weken'} en ${remainingDays} dag${remainingDays !== 1 ? 'en' : ''} geleden`;
        }

        return `
            <div class="task-card ${status}" data-id="${safeId}">
                <div class="task-card-inner">
                    <button class="task-done-btn" onclick="markDone('${safeId}')" title="Markeer als gedaan">✓</button>
                    <div class="task-info">
                        <div class="task-name">
                            ${safeName}
                            <span class="task-category-badge">${categoryLabels[task.category] || task.category}</span>
                        </div>
                        <div class="task-last-done">
                            Laatst gedaan: ${lastDoneDate} <span class="since-text">(${sinceText})</span>
                        </div>
                        <div class="task-details">
                            ${dueText} · ${formatInterval(task.interval, task.unit)}
                        </div>
                    </div>
                    <button class="edit-btn" onclick="openEditModal('${safeId}')" title="Bewerken">✏️</button>
                </div>
                <div class="task-delete-bg">🗑</div>
            </div>
        `;
    }).join('');
    initSwipe();
}

// --- Swipe to Delete ---
function initSwipe() {
    const cards = document.querySelectorAll('.task-card');
    cards.forEach(card => {
        if (card.dataset.swipeInit) return;
        card.dataset.swipeInit = 'true';
        const inner = card.querySelector('.task-card-inner');
        let startX = 0, currentX = 0, swiping = false;

        const deleteBg = card.querySelector('.task-delete-bg');

        inner.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            currentX = startX;
            swiping = true;
            inner.style.transition = 'none';
        }, { passive: true });

        inner.addEventListener('touchmove', (e) => {
            if (!swiping) return;
            currentX = e.touches[0].clientX;
            const diff = currentX - startX;
            if (diff < 0) {
                if (deleteBg) deleteBg.style.opacity = '1';
                inner.style.transform = `translateX(${Math.max(diff, -120)}px)`;
            }
        }, { passive: true });

        inner.addEventListener('touchend', () => {
            swiping = false;
            inner.style.transition = 'transform 0.25s ease';
            if (deleteBg) deleteBg.style.opacity = '0';
            const diff = currentX - startX;
            if (diff < -80) {
                inner.style.transform = 'translateX(0)';
                const id = card.dataset.id;
                deleteTask(id);
            } else {
                inner.style.transform = 'translateX(0)';
            }
        });

        // Reset on click elsewhere
        document.addEventListener('touchstart', (e) => {
            if (!card.contains(e.target)) {
                inner.style.transition = 'transform 0.25s ease';
                inner.style.transform = 'translateX(0)';
            }
        }, { passive: true });
    });
}
