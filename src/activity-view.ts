import { supabase } from './lib/supabase';

type Activity = { id: string; title: string; awardedAt: string; xp: number; points: number };
type ActivityChild = { id: string; display_name: string; auth_user_id: string | null };
let historyCacheKey = '';
let historyLoadingKey = '';
let activities: Activity[] = [];
let activityChildren: ActivityChild[] = [];
let selectedChildId = '';
let selectedChildLabel = '';
let displayMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDay = dateKey(new Date());
let selectedRange: 'day' | 'week' | 'month' | 'year' = 'day';
let rootObserver: MutationObserver | undefined;
let rootElement: HTMLElement | null = null;

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
function mondayIndex(date: Date) { return (date.getDay() + 6) % 7; }
function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function shiftDays(date: Date, days: number) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
function friendlyDate(date: Date, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, options).format(date);
}
function chosenChildName() {
  const selected = document.querySelector<HTMLElement>('.cloud-children button.on');
  const visibleName = selected?.querySelector('span:nth-child(2) b')?.textContent?.trim();
  if (visibleName) return visibleName;
  const heading = document.querySelector('#tasks h2')?.textContent?.trim() ?? '';
  return heading.replace(/[’']s tasks$/i, '').trim();
}
function activeFamilyId(memberships: Array<{ family_id: string }>) {
  const chosen = document.querySelector<HTMLSelectElement>('.cloud-top-right select')?.value;
  return memberships.find(member => member.family_id === chosen)?.family_id ?? memberships[0]?.family_id;
}

async function loadActivityHistory() {
  if (!supabase) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return;
  const membershipResult = await supabase.from('family_memberships').select('family_id,role').eq('user_id', user.id);
  if (membershipResult.error) throw membershipResult.error;
  const memberships = (membershipResult.data ?? []) as Array<{ family_id: string; role: 'parent' | 'child' }>;
  const familyId = activeFamilyId(memberships);
  if (!familyId) { activities = []; return; }
  const family = memberships.find(member => member.family_id === familyId);
  const { data: children, error: childError } = await supabase.from('child_profiles').select('id,display_name,auth_user_id').eq('family_id', familyId);
  if (childError) throw childError;
  let childRows = (children ?? []) as ActivityChild[];
  if (family?.role === 'child') childRows = childRows.filter(row => row.auth_user_id === user.id);
  activityChildren = childRows;
  const dashboardChoice = childRows.find(row => row.display_name === chosenChildName());
  const child = childRows.find(row => row.id === selectedChildId) ?? dashboardChoice ?? childRows[0];
  if (!child) { activities = []; return; }
  selectedChildId = child.id;
  selectedChildLabel = child.display_name;
  const { data: assignments, error: assignmentError } = await supabase.from('task_assignments').select('id,task_id').eq('family_id', familyId).eq('child_id', child.id);
  if (assignmentError) throw assignmentError;
  const assignmentRows = (assignments ?? []) as Array<{ id: string; task_id: string }>;
  const assignmentIds = assignmentRows.map(row => row.id);
  if (!assignmentIds.length) { activities = []; return; }
  const [{ data: completions, error: completionError }, { data: taskRows, error: taskError }] = await Promise.all([
    supabase.from('task_completions').select('id,assignment_id,awarded_at').in('assignment_id', assignmentIds).eq('status', 'approved').not('awarded_at', 'is', null).order('awarded_at', { ascending: false }),
    supabase.from('tasks').select('id,title,xp_reward,point_reward').in('id', assignmentRows.map(row => row.task_id))
  ]);
  if (completionError) throw completionError;
  if (taskError) throw taskError;
  const byAssignment = new Map(assignmentRows.map(row => [row.id, row.task_id]));
  const byTask = new Map((taskRows ?? []).map((row: any) => [row.id, row]));
  activities = ((completions ?? []) as any[]).flatMap(completion => {
    const task = byTask.get(byAssignment.get(completion.assignment_id) ?? '') as any;
    if (!task || !completion.awarded_at) return [];
    return [{ id: completion.id, title: task.title, awardedAt: completion.awarded_at, xp: task.xp_reward ?? 0, points: task.point_reward ?? 0 }];
  });
}

function summaryBounds(range: typeof selectedRange, now: Date) {
  const today = startOfDay(now);
  if (range === 'week') return [shiftDays(today, -6), shiftDays(today, 1)] as const;
  if (range === 'month') return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)] as const;
  if (range === 'year') return [new Date(now.getFullYear() - 1, 0, 1), new Date(now.getFullYear(), 0, 1)] as const;
  return [new Date(selectedDay + 'T00:00:00'), shiftDays(new Date(selectedDay + 'T00:00:00'), 1)] as const;
}
function buildActivityMarkup() {
  const now = new Date();
  const todayKey = dateKey(now);
  const counts = new Map<string, number>();
  for (const activity of activities) {
    const key = dateKey(new Date(activity.awardedAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let streak = 0;
  let streakDate = startOfDay(now);
  if (!counts.has(dateKey(streakDate))) streakDate = shiftDays(streakDate, -1);
  while (counts.has(dateKey(streakDate))) { streak++; streakDate = shiftDays(streakDate, -1); }
  const bounds = summaryBounds(selectedRange, now);
  const selectedActivities = activities.filter(activity => {
    const date = new Date(activity.awardedAt);
    return date >= bounds[0] && date < bounds[1];
  });
  const selectedTitle = selectedRange === 'day' ? friendlyDate(new Date(selectedDay + 'T00:00:00'))
    : selectedRange === 'week' ? 'The last 7 days'
    : selectedRange === 'month' ? friendlyDate(new Date(now.getFullYear(), now.getMonth() - 1, 1), { month: 'long', year: 'numeric' })
    : String(now.getFullYear() - 1);
  const firstDay = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1);
  const daysInMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 0).getDate();
  const calendarCells = [] as string[];
  for (let i = 0; i < mondayIndex(firstDay); i++) calendarCells.push('<span class="activity-day blank" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day);
    const key = dateKey(date), count = counts.get(key) ?? 0;
    calendarCells.push(`<button class="activity-day${key === selectedDay ? ' selected' : ''}${key === todayKey ? ' today' : ''}${count ? ' has-activity' : ''}" data-day="${key}" aria-label="${escapeHtml(friendlyDate(date))}${count ? `, ${count} tasks completed` : ''}"><span>${day}</span>${count ? `<i>${count}</i>` : ''}</button>`);
  }
  const list = selectedActivities.length ? selectedActivities.map(activity => `<li><span class="activity-check">✓</span><span class="activity-copy"><b>${escapeHtml(activity.title)}</b><small>${escapeHtml(friendlyDate(new Date(activity.awardedAt), { hour: 'numeric', minute: '2-digit' }))}</small></span><strong>⭐ +${activity.xp} XP<br>🪙 +${activity.points}</strong></li>`).join('') : '<li class="activity-empty">🌱 No completed tasks in this time period yet. Every little step counts!</li>';
  const weekStart = shiftDays(startOfDay(now), -6), monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1), yearStart = new Date(now.getFullYear() - 1, 0, 1);
  const countRange = (start: Date, end: Date) => activities.filter(activity => { const date = new Date(activity.awardedAt); return date >= start && date < end; }).length;
  return `<section class="cloud-activity-panel"><div class="activity-head"><div><span>📅 CHILD PROGRESS</span><h2>Activity & streaks</h2><p>Celebrate the tasks finished, one day at a time.</p></div><button class="activity-today" data-range="day" data-today="true">Go to today</button></div><div class="activity-stat-grid"><article><span>🔥</span><small>Current streak</small><b>${streak} ${streak === 1 ? 'day' : 'days'}</b><p>${streak ? 'Keep your good habit going!' : 'Finish a task today to start one.'}</p></article><article><span>✅</span><small>Today</small><b>${counts.get(todayKey) ?? 0}</b><p>tasks completed</p></article><article><span>📆</span><small>Last 7 days</small><b>${countRange(weekStart, shiftDays(startOfDay(now), 1))}</b><p>tasks completed</p></article><article><span>🗓️</span><small>Last month</small><b>${countRange(monthStart, new Date(now.getFullYear(), now.getMonth(), 1))}</b><p>tasks completed</p></article><article><span>🎉</span><small>Last year</small><b>${countRange(yearStart, new Date(now.getFullYear(), 0, 1))}</b><p>tasks completed</p></article></div><div class="activity-layout"><section class="activity-calendar"><div class="activity-calendar-head"><button data-month="-1" aria-label="Previous month">‹</button><h3>${escapeHtml(friendlyDate(displayMonth, { month: 'long', year: 'numeric' }))}</h3><button data-month="1" aria-label="Next month">›</button></div><div class="activity-weekdays"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="activity-calendar-grid">${calendarCells.join('')}</div><p class="activity-legend"><i></i> A dot shows a day with completed tasks. Select any day to see what was finished.</p></section><section class="activity-history"><div class="activity-range-tabs"><button data-range="day" class="${selectedRange === 'day' ? 'active' : ''}">📍 Day</button><button data-range="week" class="${selectedRange === 'week' ? 'active' : ''}">7 days</button><button data-range="month" class="${selectedRange === 'month' ? 'active' : ''}">Last month</button><button data-range="year" class="${selectedRange === 'year' ? 'active' : ''}">Last year</button></div><h3>${escapeHtml(selectedTitle)}</h3><p>${selectedActivities.length} ${selectedActivities.length === 1 ? 'task' : 'tasks'} completed</p><ul>${list}</ul></section></div></section>`;
}

function renderActivity() {
  const panel = document.querySelector<HTMLElement>('#activity');
  if (panel) { panel.innerHTML = buildActivityMarkup(); addChildPicker(panel); }
}

function addChildPicker(panel: HTMLElement) {
  const head = panel.querySelector<HTMLElement>('.activity-head');
  const today = head?.querySelector<HTMLButtonElement>('.activity-today');
  if (!head || !today || !activityChildren.length) return;
  const actions = document.createElement('div');
  actions.className = 'activity-head-actions';
  const label = document.createElement('label');
  label.className = 'activity-child-picker';
  label.innerHTML = '<span>Child</span>';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Choose a child');
  select.dataset.activityChild = 'true';
  for (const child of activityChildren) {
    const option = document.createElement('option');
    option.value = child.id;
    option.textContent = child.display_name;
    option.selected = child.id === selectedChildId;
    select.append(option);
  }
  label.append(select);
  actions.append(label, today);
  head.append(actions);
  const caption = document.createElement('p');
  caption.className = 'activity-child-caption';
  caption.append('Showing progress for ');
  const name = document.createElement('b');
  name.textContent = selectedChildLabel;
  caption.append(name, ' only');
  head.insertAdjacentElement('afterend', caption);
}

async function refreshActivity() {
  const panel = document.querySelector<HTMLElement>('#activity');
  if (!panel || !supabase) return;
  const key = `${(document.querySelector('.cloud-top-right select') as HTMLSelectElement | null)?.value ?? ''}|${selectedChildId || chosenChildName()}`;
  if (historyLoadingKey === key) return;
  historyLoadingKey = key;
  panel.dataset.loading = 'true';
  try {
    await loadActivityHistory();
    historyCacheKey = key;
    panel.innerHTML = buildActivityMarkup();
    addChildPicker(panel);
  } catch (error) {
    panel.innerHTML = `<section class="cloud-activity-panel" id="activity"><div class="activity-error">Could not load activity history. ${escapeHtml((error as Error)?.message ?? '')}</div></section>`;
  } finally {
    panel.dataset.loading = 'false';
    historyLoadingKey = '';
  }
}

function mountActivity() {
  const nav = document.querySelector<HTMLElement>('.cloud-side-nav');
  const content = document.querySelector<HTMLElement>('.cloud-content');
  if (!nav || !content) return;
  if (!nav.querySelector('[href="#activity"]')) {
    const link = document.createElement('a');
    link.href = '#activity';
    link.innerHTML = '<span aria-hidden="true">📅</span> Activity';
    link.setAttribute('aria-label', '📅 Activity');
    nav.append(link);
    if (window.location.hash === '#activity' && !document.querySelector(':target')) link.click();
  }
  let panel = content.querySelector<HTMLElement>('#activity');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'activity';
    panel.className = 'cloud-activity-host';
    panel.innerHTML = '<div class="cloud-activity-panel"><p>Loading your child’s activity…</p></div>';
    const foot = content.querySelector('.cloud-foot');
    content.insertBefore(panel, foot ?? null);
  }
  if (historyCacheKey !== `${(document.querySelector('.cloud-top-right select') as HTMLSelectElement | null)?.value ?? ''}|${selectedChildId || chosenChildName()}`) void refreshActivity();
}

function handleActivityClick(event: Event) {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>('#activity button');
  if (!button) return;
  if (button.dataset.month) {
    displayMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + Number(button.dataset.month), 1);
  } else if (button.dataset.day) {
    selectedDay = button.dataset.day;
    selectedRange = 'day';
  } else if (button.dataset.today) {
    const today = new Date(); selectedDay = dateKey(today); displayMonth = new Date(today.getFullYear(), today.getMonth(), 1); selectedRange = 'day';
  } else if (button.dataset.range) {
    selectedRange = button.dataset.range as typeof selectedRange;
    if (selectedRange === 'day') { const today = new Date(); selectedDay = dateKey(today); displayMonth = new Date(today.getFullYear(), today.getMonth(), 1); }
  }
  renderActivity();
}

export function installActivityView() {
  rootElement = document.getElementById('root');
  if (!rootElement) return;
  rootElement.addEventListener('click', event => {
    handleActivityClick(event);
    if ((event.target as HTMLElement).closest('.cloud-children button')) {
      window.setTimeout(() => { historyCacheKey = ''; void refreshActivity(); }, 80);
    }
  });
  rootElement.addEventListener('change', event => {
    if ((event.target as HTMLElement).matches('[data-activity-child]')) {
      selectedChildId = (event.target as HTMLSelectElement).value;
      historyCacheKey = '';
      void refreshActivity();
    } else if ((event.target as HTMLElement).matches('.cloud-top-right select')) {
      historyCacheKey = ''; void refreshActivity();
    }
  });
  rootObserver?.disconnect();
  rootObserver = new MutationObserver(() => mountActivity());
  rootObserver.observe(rootElement, { childList: true, subtree: true });
  mountActivity();
}
