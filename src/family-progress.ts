import { supabase } from './lib/supabase';

type ChildProgress = {
  id: string;
  name: string;
  xp: number;
  points: number;
  assigned: number;
  completed: number;
  recent: number;
  streak: number;
};

let observer: MutationObserver | undefined;
let loadingKey = '';
let loadedKey = '';
let failedKey = '';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const childNameFromDashboard = () => {
  const active = document.querySelector<HTMLElement>('.cloud-children button.on');
  return active?.querySelector('span:nth-child(2) b')?.textContent?.trim() ?? '';
};

function activeFamily(memberships: Array<{ family_id: string; role: string }>) {
  const selectedId = document.querySelector<HTMLSelectElement>('.cloud-top-right select')?.value;
  return memberships.find(m => m.family_id === selectedId) ?? memberships[0];
}

function streakForDates(dates: Set<string>, today: Date) {
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!dates.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

async function fetchProgress(): Promise<{ role: string; rows: ChildProgress[] }> {
  if (!supabase) throw new Error('Connect Supabase to load family progress.');
  const { data: session } = await supabase.auth.getSession();
  const user = session.session?.user;
  if (!user) throw new Error('Sign in to see progress.');
  const { data: memberships, error: membershipError } = await supabase.from('family_memberships').select('family_id,role').eq('user_id', user.id);
  if (membershipError) throw membershipError;
  const memberRows = (memberships ?? []) as Array<{ family_id: string; role: 'parent' | 'child' }>;
  const family = activeFamily(memberRows);
  if (!family) return { role: 'child', rows: [] };

  const { data: children, error: childrenError } = await supabase.from('child_profiles').select('id,display_name,auth_user_id,xp,points').eq('family_id', family.family_id).order('created_at');
  if (childrenError) throw childrenError;
  let childRows = (children ?? []) as Array<{ id: string; display_name: string; auth_user_id: string | null; xp: number; points: number }>;
  if (family.role === 'child') childRows = childRows.filter(child => child.auth_user_id === user.id);
  if (!childRows.length) return { role: family.role, rows: [] };

  const { data: assignments, error: assignmentError } = await supabase.from('task_assignments').select('id,child_id').eq('family_id', family.family_id).in('child_id', childRows.map(child => child.id));
  if (assignmentError) throw assignmentError;
  const assignedRows = (assignments ?? []) as Array<{ id: string; child_id: string }>;
  const completionMap = new Map<string, Array<{ status: string; awarded_at: string | null }>>();
  if (assignedRows.length) {
    const { data: completions, error: completionError } = await supabase.from('task_completions').select('assignment_id,status,awarded_at').in('assignment_id', assignedRows.map(row => row.id));
    if (completionError) throw completionError;
    for (const completion of (completions ?? []) as Array<{ assignment_id: string; status: string; awarded_at: string | null }>) {
      const list = completionMap.get(completion.assignment_id) ?? [];
      list.push(completion);
      completionMap.set(completion.assignment_id, list);
    }
  }
  const today = new Date();
  const recentStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const rows = childRows.map(child => {
    const childAssignments = assignedRows.filter(assignment => assignment.child_id === child.id);
    const awarded = childAssignments.flatMap(assignment => (completionMap.get(assignment.id) ?? []).filter(completion => completion.status === 'approved' && completion.awarded_at));
    const dates = new Set(awarded.map(completion => dayKey(new Date(completion.awarded_at!))));
    const recent = awarded.filter(completion => new Date(completion.awarded_at!) >= recentStart && new Date(completion.awarded_at!) <= today).length;
    return {
      id: child.id,
      name: child.display_name,
      xp: child.xp ?? 0,
      points: child.points ?? 0,
      assigned: childAssignments.length,
      completed: awarded.length,
      recent,
      streak: streakForDates(dates, today),
    };
  });
  return { role: family.role, rows };
}

function markup(role: string, rows: ChildProgress[]) {
  const isParent = role === 'parent';
  if (!rows.length) return `<section class="family-progress-panel"><header><div><span>🌱 PROGRESS</span><h2>${isParent ? 'Every child, growing' : 'Your progress'}</h2></div></header><p class="family-progress-empty">${isParent ? 'Add a child to your family to see their progress here.' : 'Your child profile is not linked yet. Ask your parent to link your account.'}</p></section>`;
  return `<section class="family-progress-panel"><header><div><span>🌱 FAMILY PROGRESS</span><h2>${isParent ? 'Every child is growing' : 'Your progress, at a glance'}</h2><p>${isParent ? 'A quick look at each child’s effort and achievements.' : 'Every little step adds up. Keep your streak going!'}</p></div><span class="family-progress-count">${rows.length} ${rows.length === 1 ? 'child' : 'children'}</span></header><div class="family-progress-grid">${rows.map(child => {
    const level = Math.floor(child.xp / 100) + 1;
    const intoLevel = child.xp % 100;
    const completionPercent = child.assigned ? Math.min(100, Math.round(child.completed / child.assigned * 100)) : 0;
    return `<article class="family-progress-card"><div class="family-progress-person"><span class="family-progress-avatar">🧒</span><div><h3>${escape(child.name)}</h3><small>Level ${level} · ${child.xp} XP</small></div><span class="family-progress-streak">🔥 ${child.streak} ${child.streak === 1 ? 'day' : 'days'}</span></div><div class="family-progress-xp"><div><span>Level ${level} progress</span><b>${intoLevel}/100 XP</b></div><div class="family-progress-track"><i style="width:${intoLevel}%"></i></div></div><div class="family-progress-metrics"><div><b>✅ ${child.completed}</b><span>tasks done</span></div><div><b>📅 ${child.recent}</b><span>last 7 days</span></div><div><b>🪙 ${child.points}</b><span>reward points</span></div></div><div class="family-progress-completion"><span>${child.completed} of ${child.assigned} assigned tasks finished</span><b>${completionPercent}%</b></div><div class="family-progress-track"><i style="width:${completionPercent}%"></i></div></article>`;
  }).join('')}</div></section>`;
}

async function refresh(panel: HTMLElement) {
  const key = `${document.querySelector<HTMLSelectElement>('.cloud-top-right select')?.value ?? ''}|${childNameFromDashboard()}`;
  if (loadingKey === key || loadedKey === key || failedKey === key) return;
  loadingKey = key;
  panel.innerHTML = '<section class="family-progress-panel"><p>Loading progress…</p></section>';
  try {
    const result = await fetchProgress();
    panel.innerHTML = markup(result.role, result.rows);
    loadedKey = key;
  } catch (error) {
    failedKey = key;
    panel.innerHTML = `<section class="family-progress-panel"><p class="family-progress-error">Progress could not load: ${escape((error as Error)?.message ?? error)}</p></section>`;
  } finally { loadingKey = ''; }
}

function mount() {
  const content = document.querySelector<HTMLElement>('.cloud-content');
  if (!content) return;
  let panel = content.querySelector<HTMLElement>('#family-progress');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'family-progress';
    panel.className = 'family-progress-host';
    panel.innerHTML = '<section class="family-progress-panel"><p>Loading progress…</p></section>';
    const heading = content.querySelector('.cloud-heading');
    heading?.insertAdjacentElement('afterend', panel);
  }
  const key = `${document.querySelector<HTMLSelectElement>('.cloud-top-right select')?.value ?? ''}|${childNameFromDashboard()}`;
  if (loadedKey !== key && failedKey !== key && loadingKey !== key) void refresh(panel);
}

export function installFamilyProgress() {
  const root = document.getElementById('root');
  if (!root) return;
  root.addEventListener('click', event => {
    if ((event.target as HTMLElement).closest('.cloud-children button')) {
      loadedKey = '';
      failedKey = '';
      window.setTimeout(mount, 100);
    }
  });
  root.addEventListener('change', event => {
    if ((event.target as HTMLElement).matches('.cloud-top-right select')) { loadedKey = ''; failedKey = ''; mount(); }
  });
  observer?.disconnect();
  observer = new MutationObserver(() => mount());
  observer.observe(root, { childList: true, subtree: true });
  mount();
}
