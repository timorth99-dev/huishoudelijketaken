const STORAGE_KEY = 'huishoudelijke-taken';

let tasks = loadTasks();
let currentFilter = 'all';

const taskInput = document.getElementById('taskInput');
const categorySelect = document.getElementById('categorySelect');
const addBtn = document.getElementById('addBtn');
const taskList = document.getElementById('taskList');
const summaryEl = document.getElementById('summary');
const filterBtns = document.querySelectorAll('.filter-btn');

// ── Persistence ────────────────────────────────────────────────
function loadTasks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// ── Render ─────────────────────────────────────────────────────
function render() {
  const filtered = tasks.filter((t) => {
    if (currentFilter === 'open') return !t.done;
    if (currentFilter === 'done') return t.done;
    return true;
  });

  taskList.innerHTML = '';

  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'Geen taken gevonden.';
    taskList.appendChild(li);
  } else {
    filtered.forEach((task) => {
      taskList.appendChild(createTaskElement(task));
    });
  }

  updateSummary();
}

function createTaskElement(task) {
  const li = document.createElement('li');
  li.className = 'task-item' + (task.done ? ' done' : '');
  li.dataset.id = task.id;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  checkbox.addEventListener('change', () => toggleTask(task.id));

  const span = document.createElement('span');
  span.className = 'task-text';
  span.textContent = task.text;

  const badge = document.createElement('span');
  badge.className = 'task-category';
  badge.textContent = task.category;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.title = 'Verwijder taak';
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', () => deleteTask(task.id));

  li.append(checkbox, span, badge, deleteBtn);
  return li;
}

function updateSummary() {
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  summaryEl.textContent =
    total === 0
      ? ''
      : `${done} van ${total} taken afgerond`;
}

// ── Actions ─────────────────────────────────────────────────────
function addTask() {
  const text = taskInput.value.trim();
  if (!text) return;

  const task = {
    id: Date.now() + Math.random(),
    text,
    category: categorySelect.value,
    done: false,
  };

  tasks.push(task);
  saveTasks();
  render();

  taskInput.value = '';
  taskInput.focus();
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.done = !task.done;
    saveTasks();
    render();
  }
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  saveTasks();
  render();
}

// ── Event listeners ─────────────────────────────────────────────
addBtn.addEventListener('click', addTask);

taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});

filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

// ── Init ─────────────────────────────────────────────────────────
render();
