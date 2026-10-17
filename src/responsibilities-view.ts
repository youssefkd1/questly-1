import { supabase } from './lib/supabase';

type Responsibility = {
  assignmentId: string;
  childName: string;
  title: string;
  category: string;
  dueAt: string | null;
  recurrence: string;
  status: string;
  reviewNote: string | null;
  assignedAt: string;
};

let observer: MutationObserver | undefined;
let loading = false;
let loadedKey: string | null = null;
let failedKey = '';
let activeFilter = 'all';
let lastRows: Responsibility[] = [];
let currentRole: 'parent' | 'child' = 'child';
let initialHashHandled = false;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const prettyDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
const getKey = () => `${document.querySelector<HTMLSelectElement>('.cloud-top-right select')?.value ?? ''}`;

async function fetchRows() {
  if (!supabase) throw new Error('Connect Supabase to load responsibilities.');
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const user = session.session?.user;
  if (!user) throw new Error('Sign in to view responsibilities.');
  const { data: memberships, error: membershipError } = await supabase.from('family_memberships').select('family_id,role').eq('user_id', user.id);
  if (membershipError) throw membershipError;
  const selectedId = getKey();
  const membership = (memberships ?? []).find(item => item.family_id === selectedId) ?? (memberships ?? [])[0];
  if (!membership) return { role: 'child' as const, rows: [] as Responsibility[] };
  currentRole = membership.role;
  const { data: children, error: childrenError } = await supabase.from('child_profiles').select('id,display_name').eq('family_id', membership.family_id);
  if (childrenError) throw childrenError;
  const childRows = (children ?? []) as Array<{ id: string; display_name: string }>;
  if (!childRows.length) return { role: currentRole, rows: [] as Responsibility[] };
  const { data: assignments, error: assignmentsError } = await supabase.from('task_assignments').select('id,child_id,task_id,assigned_at').eq('family_id', membership.family_id).in('child_id', childRows.map(child => child.id));
  if (assignmentsError) throw assignmentsError;
  const assignmentRows = (assignments ?? []) as Array<{ id: string; child_id: string; task_id: string; assigned_at: string }>;
  if (!assignmentRows.length) return { role: currentRole, rows: [] as Responsibility[] };
  const ids = [...new Set(assignmentRows.map(row => row.task_id))];
  const [{ data: tasks, error: tasksError }, { data: completions, error: completionsError }] = await Promise.all([
    supabase.from('tasks').select('id,title,category,due_at,recurrence').in('id', ids),
    supabase.from('task_completions').select('id,assignment_id,status,review_note,updated_at').in('assignment_id', assignmentRows.map(row => row.id)).order('updated_at', { ascending: false }),
  ]);
  if (tasksError) throw tasksError;
  if (completionsError) throw completionsError;
  const taskMap = new Map((tasks ?? []).map(task => [task.id, task]));
  const childMap = new Map(childRows.map(child => [child.id, child.display_name]));
  const completionMap = new Map<string, { status: string; review_note: string | null }>();
  for (const completion of (completions ?? []) as Array<{ assignment_id: string; status: string; review_note: string | null }>) {
    if (!completionMap.has(completion.assignment_id)) completionMap.set(completion.assignment_id, completion);
  }
  const rows = assignmentRows.flatMap(assignment => {
    const task = taskMap.get(assignment.task_id);
    if (!task) return [];
    const completion = completionMap.get(assignment.id);
    return [{
      assignmentId: assignment.id,
      childName: childMap.get(assignment.child_id) ?? 'Child',
      title: task.title,
      category: task.category ?? 'Family',
      dueAt: task.due_at,
      recurrence: task.recurrence ?? 'once',
      status: completion?.status ?? 'assigned',
      reviewNote: completion?.review_note ?? null,
      assignedAt: assignment.assigned_at,
    } satisfies Responsibility];
  });
  return { role: currentRole, rows };
}

function stateOf(row: Responsibility) {
  if (row.status === 'approved') return 'done';
  if (row.status === 'pending_approval') return 'waiting';
  if (row.status === 'missed') return 'overdue';
  if (row.dueAt && new Date(row.dueAt).getTime() < Date.now()) return 'overdue';
  if (row.status === 'needs_revision') return 'retry';
  return 'todo';
}

function dueLabel(row: Responsibility) {
  const state = stateOf(row);
  if (state === 'done') return 'Finished';
  if (state === 'waiting') return 'Waiting for parent review';
  if (state === 'overdue') return `Overdue · ${row.dueAt ? prettyDate(row.dueAt) : 'needs attention'}`;
  if (state === 'retry') return 'Try again';
  if (!row.dueAt) return 'No due date';
  return `Due ${prettyDate(row.dueAt)}`;
}

function render() {
  const panel = document.querySelector<HTMLElement>('#responsibilities');
  if (!panel) return;
  const now = Date.now();
  const counts = {
    all: lastRows.length,
    todo: lastRows.filter(row => stateOf(row) === 'todo' || stateOf(row) === 'retry').length,
    overdue: lastRows.filter(row => stateOf(row) === 'overdue').length,
    waiting: lastRows.filter(row => stateOf(row) === 'waiting').length,
    done: lastRows.filter(row => stateOf(row) === 'done').length,
  };
  const filtered = lastRows.filter(row => activeFilter === 'all' || (activeFilter === 'todo' ? ['todo', 'retry'].includes(stateOf(row)) : stateOf(row) === activeFilter));
  const sorted = [...filtered].sort((a, b) => {
    const priority = (row: Responsibility) => ({ overdue: 0, retry: 1, todo: 2, waiting: 3, done: 4 }[stateOf(row)] ?? 5);
    return priority(a) - priority(b) || (a.dueAt ? new Date(a.dueAt).getTime() : now + 1e12) - (b.dueAt ? new Date(b.dueAt).getTime() : now + 1e12);
  });
  const title = currentRole === 'parent' ? 'Family responsibilities' : 'My responsibilities';
  const copy = currentRole === 'parent' ? 'Help each child keep promises, follow through, and ask for help when they need it.' : 'Your promises, all in one place. Choose a task, finish it, then tell your parent.';
  const cards = sorted.length ? sorted.map(row => {
    const state = stateOf(row);
    const showAction = currentRole === 'child' && ['todo', 'retry'].includes(state);
    return `<article class="responsibility-card state-${state}"><div class="responsibility-card-top"><span class="responsibility-category">${esc(row.category)}</span><span class="responsibility-status">${esc(dueLabel(row))}</span></div><h3>${esc(row.title)}</h3>${currentRole === 'parent' ? `<p class="responsibility-owner">🧒 ${esc(row.childName)}</p>` : ''}${row.recurrence && row.recurrence !== 'once' ? `<p class="responsibility-repeat">🔁 ${esc(row.recurrence.replaceAll('_', ' '))}</p>` : ''}${row.reviewNote ? `<p class="responsibility-note">Parent note: ${esc(row.reviewNote)}</p>` : ''}<div class="responsibility-card-bottom"><span>Assigned ${prettyDate(row.assignedAt)}</span>${showAction ? `<button class="cloud-primary responsibility-submit" data-assignment="${esc(row.assignmentId)}">${state === 'retry' ? '🔁 Try again' : '✅ I finished this'}</button>` : ''}</div></article>`;
  }).join('') : '<div class="responsibility-empty">🌱 Nothing in this list yet. Every new task is a chance to show what you can do.</div>';
  panel.innerHTML = `<section class="responsibility-panel"><header class="responsibility-heading"><div><span>🧭 BUILDING GOOD HABITS</span><h2>${title}</h2><p>${copy}</p></div>${currentRole === 'child' ? '<a class="cloud-primary responsibility-task-link" href="#tasks">📝 See my tasks</a>' : '<a class="cloud-secondary responsibility-task-link" href="#family">👨‍👩‍👧 Family overview</a>'}</header><div class="responsibility-summary"><article><span>📋</span><small>All tasks</small><b>${counts.all}</b></article><article><span>⏳</span><small>To do</small><b>${counts.todo}</b></article><article class="${counts.overdue ? 'needs-attention' : ''}"><span>🕒</span><small>Overdue</small><b>${counts.overdue}</b></article><article><span>⭐</span><small>Finished</small><b>${counts.done}</b></article></div><div class="responsibility-filters">${(['all', 'todo', 'overdue', 'waiting', 'done'] as const).map(filter => `<button data-filter="${filter}" class="${activeFilter === filter ? 'active' : ''}">${({ all:'All', todo:'To do', overdue:'Overdue', waiting:'For review', done:'Finished' })[filter]} <span>${counts[filter]}</span></button>`).join('')}</div><div class="responsibility-list">${cards}</div><p class="responsibility-footer">💚 Progress is about practice. If something feels hard, ask for help and make a plan together.</p></section>`;
}

async function refresh() {
  const panel = document.querySelector<HTMLElement>('#responsibilities');
  if (!panel || loading) return;
  loading = true;
  panel.innerHTML = '<section class="responsibility-panel"><p>Loading family responsibilities…</p></section>';
  let timeout: number | undefined;
  try {
    const result = await Promise.race([
      fetchRows(),
      new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('The family data request timed out. Check your connection and try again.')), 15000); }),
    ]);
    currentRole = result.role;
    lastRows = result.rows;
    loadedKey = getKey();
    failedKey = '';
    render();
  } catch (error) {
    failedKey = getKey();
    panel.innerHTML = `<section class="responsibility-panel"><p class="responsibility-error">Could not load responsibilities: ${esc((error as Error)?.message ?? error)}</p><button class="cloud-secondary responsibility-retry" data-responsibility-retry>↻ Try loading again</button></section>`;
  } finally { if (timeout) window.clearTimeout(timeout); loading = false; }
}

function mount() {
  const nav = document.querySelector<HTMLElement>('.cloud-side-nav');
  const content = document.querySelector<HTMLElement>('.cloud-content');
  if (!nav || !content) return;
  if (!nav.querySelector('a[href="#responsibilities"]')) {
    const link = document.createElement('a');
    link.href = '#responsibilities';
    link.innerHTML = '<span class="quest-nav-emoji" aria-hidden="true">🧭</span><span class="quest-nav-label">Responsibilities</span>';
    link.setAttribute('aria-label', 'Responsibilities');
    link.title = 'Responsibilities';
    link.dataset.tooltip = 'Open Responsibilities';
    nav.append(link);
  }
  let panel = content.querySelector<HTMLElement>('#responsibilities');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'responsibilities';
    panel.className = 'responsibility-host';
    panel.innerHTML = '<section class="responsibility-panel"><p>Loading family responsibilities…</p></section>';
    const foot = content.querySelector('.cloud-foot');
    content.insertBefore(panel, foot ?? null);
  }
  if (!initialHashHandled && window.location.hash === '#responsibilities' && !document.querySelector(':target')) {
    initialHashHandled = true;
    nav.querySelector<HTMLAnchorElement>('a[href="#responsibilities"]')?.click();
  }
  if (loadedKey !== getKey() && failedKey !== getKey() && !loading) void refresh();
}

async function submitResponsibility(assignmentId: string, button: HTMLButtonElement) {
  if (!supabase || button.disabled) return;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const { error } = await supabase.rpc('submit_completion', { p_assignment_id: assignmentId });
    if (error) throw error;
    await refresh();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Try again';
    const note = document.createElement('p');
    note.className = 'responsibility-error';
    note.textContent = (error as Error)?.message ?? 'Could not update this task.';
    button.closest('.responsibility-card')?.append(note);
  }
}

export function installResponsibilitiesView() {
  const root = document.getElementById('root');
  if (!root) return;
  root.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-responsibility-retry]')) { loadedKey = null; failedKey = ''; void refresh(); return; }
    if (target.closest('a[href="#responsibilities"]')) { loadedKey = null; failedKey = ''; window.setTimeout(() => void refresh(), 0); }
    const filter = target.closest<HTMLButtonElement>('#responsibilities [data-filter]');
    if (filter) { activeFilter = filter.dataset.filter ?? 'all'; render(); return; }
    const submit = target.closest<HTMLButtonElement>('#responsibilities [data-assignment]');
    if (submit?.dataset.assignment) void submitResponsibility(submit.dataset.assignment, submit);
  });
  root.addEventListener('change', event => {
    if ((event.target as HTMLElement).matches('.cloud-top-right select')) { loadedKey = null; failedKey = ''; void refresh(); }
  });
  observer?.disconnect();
  observer = new MutationObserver(() => mount());
  observer.observe(root, { childList: true, subtree: true });
  mount();
}
