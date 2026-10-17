import { supabase } from './lib/supabase';

type Child = { id: string; display_name: string; auth_user_id: string | null; points: number };
type PlannerTask = { assignmentId: string; taskId: string; childId: string; childName: string; title: string; dueAt: string | null; recurrence: string; status: string };
type Reward = { id: string; name: string; point_cost: number; description: string };
let observer: MutationObserver | undefined;
let loadedKey = '';
let failedKey = '';
let loading = false;
let weekShift = 0;
let children: Child[] = [];
let tasks: PlannerTask[] = [];
let rewards: Reward[] = [];
let memberRole: 'parent' | 'child' = 'child';
let activeFamilyId = '';
let navPlaceholder: Comment | null = null;
let mobileNavPortal: HTMLElement | null = null;
const reminderKey = 'questly-reminders-enabled';
const noticeKey = 'questly-reminder-last-sent';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const key = () => document.querySelector<HTMLSelectElement>('.cloud-top-right select')?.value ?? '';
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monday = (date: Date) => { const d = new Date(date.getFullYear(),date.getMonth(),date.getDate()); d.setDate(d.getDate()-(d.getDay()+6)%7); return d; };

async function loadData() {
  if (!supabase) throw new Error('Connect your family account to use the planner.');
  const { data: session } = await supabase.auth.getSession();
  const user = session.session?.user;
  if (!user) throw new Error('Sign in to use family features.');
  const { data: memberships, error: membershipError } = await supabase.from('family_memberships').select('family_id,role').eq('user_id',user.id);
  if (membershipError) throw membershipError;
  const members = (memberships ?? []) as Array<{family_id:string;role:'parent'|'child'}>;
  const membership = members.find(m => m.family_id === key()) ?? members[0];
  if (!membership) { children=[]; tasks=[]; rewards=[]; return; }
  memberRole = membership.role;
  activeFamilyId = membership.family_id;
  const [{data: childRows,error: childError},{data: rewardRows,error: rewardError}] = await Promise.all([
    supabase.from('child_profiles').select('id,display_name,auth_user_id,points').eq('family_id',membership.family_id).order('created_at'),
    supabase.from('rewards').select('id,name,point_cost,description').eq('family_id',membership.family_id).eq('available',true),
  ]);
  if (childError) throw childError;
  if (rewardError) throw rewardError;
  children=(childRows??[]) as Child[];
  if (memberRole==='child') children=children.filter(child=>child.auth_user_id===user.id);
  if (!children.length) { tasks=[]; rewards=(rewardRows??[]) as Reward[]; return; }
  const {data: assigned,error: assignError}=await supabase.from('task_assignments').select('id,task_id,child_id,assigned_at').eq('family_id',membership.family_id).in('child_id',children.map(c=>c.id));
  if (assignError) throw assignError;
  const assignments=(assigned??[]) as Array<{id:string;task_id:string;child_id:string;assigned_at:string}>;
  if (!assignments.length) { tasks=[]; rewards=(rewardRows??[]) as Reward[]; return; }
  const [{data: taskRows,error: taskError},{data: completionRows,error: completionError}]=await Promise.all([
    supabase.from('tasks').select('id,title,due_at,recurrence').in('id',[...new Set(assignments.map(a=>a.task_id))]),
    supabase.from('task_completions').select('assignment_id,status,submitted_at').in('assignment_id',assignments.map(a=>a.id)).order('submitted_at',{ascending:false}),
  ]);
  if(taskError)throw taskError;
  if(completionError)throw completionError;
  const taskMap=new Map((taskRows??[]).map((task:any)=>[task.id,task]));
  const childMap=new Map(children.map(c=>[c.id,c.display_name]));
  const statusMap=new Map<string,string>();
  for(const c of (completionRows??[]) as Array<{assignment_id:string;status:string}>) if(!statusMap.has(c.assignment_id)) statusMap.set(c.assignment_id,c.status);
  tasks=assignments.flatMap(a=>{const t=taskMap.get(a.task_id) as any;if(!t)return[];return[{assignmentId:a.id,taskId:a.task_id,childId:a.child_id,childName:childMap.get(a.child_id)??'Child',title:t.title,dueAt:t.due_at,recurrence:t.recurrence??'once',status:statusMap.get(a.id)??'assigned'}];});
  rewards=(rewardRows??[]) as Reward[];
}

function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return `${dayKey(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}
function renderPlanner(panel: HTMLElement) {
  const start=monday(new Date()); start.setDate(start.getDate()+7*weekShift);
  const days=Array.from({length:7},(_,i)=>{const date=new Date(start);date.setDate(date.getDate()+i);return date;});
  const end=new Date(start);end.setDate(end.getDate()+7);
  const visible=tasks;
  const weekTasks=visible.filter(t=>t.dueAt&&new Date(t.dueAt)>=start&&new Date(t.dueAt)<end);
  const unscheduled=visible.filter(t=>!t.dueAt&&t.status!=='approved');
  const open=visible.filter(t=>['assigned','needs_revision','in_progress'].includes(t.status));
  const pending=visible.filter(t=>t.status==='pending_approval');
  const dateOptions=days.map(d=>`<option value="${dayKey(d)}">${d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</option>`).join('');
  const weekMarkup=days.map(date=>{const k=dayKey(date),items=weekTasks.filter(t=>dayKey(new Date(t.dueAt!))===k);return `<article class="quest-week-day${k===dayKey(new Date())?' is-today':''}"><header><b>${date.toLocaleDateString(undefined,{weekday:'short'})}</b><span>${date.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></header>${items.length?items.map(t=>`<div class="quest-week-task"><span>${t.status==='approved'?'✅':t.status==='pending_approval'?'⏳':'📝'}</span><div><b>${esc(t.title)}</b><small>${esc(t.childName)} · ${esc(t.status.replaceAll('_',' '))}</small></div></div>`).join(''):'<p class="quest-week-empty">No tasks planned</p>'}</article>`;}).join('');
  const goalRows=children.map(child=>{const next=[...rewards].filter(r=>r.point_cost>child.points).sort((a,b)=>a.point_cost-b.point_cost)[0];if(!next)return `<article class="quest-goal-card"><span>🏆</span><div><b>${esc(child.display_name)} is reward-ready!</b><p>${child.points} points to spend in the reward shop.</p></div></article>`;const pct=Math.min(100,Math.round(child.points/next.point_cost*100));return `<article class="quest-goal-card"><span>🎁</span><div><b>${esc(child.display_name)}’s next goal: ${esc(next.name)}</b><p>${child.points} of ${next.point_cost} points · ${next.point_cost-child.points} to go</p><div class="quest-goal-track"><i style="width:${pct}%"></i></div></div><strong>${pct}%</strong></article>`;}).join('');
  const approved=tasks.filter(t=>t.status==='approved').length;
  const streakDays=new Set(tasks.filter(t=>t.status==='approved'&&t.dueAt).map(t=>dayKey(new Date(t.dueAt!)))).size;
  const badges=[{icon:'🌟',name:'First steps',desc:'Finish your first task',earned:approved>=1},{icon:'🔥',name:'On a roll',desc:'Finish 3 tasks',earned:approved>=3},{icon:'🏅',name:'High five',desc:'Finish 10 tasks',earned:approved>=10},{icon:'📅',name:'Calendar star',desc:'Finish tasks on 5 different days',earned:streakDays>=5}];
  panel.innerHTML=`<section class="quest-features-panel"><header class="quest-features-heading"><div><span>🗓️ FAMILY ROUTINE</span><h2>Weekly planner & goals</h2><p>Make the week feel manageable, celebrate progress, and keep rewards within reach.</p></div><div class="quest-week-nav"><button data-week="-1" aria-label="Previous week">‹</button><b>${start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${new Date(end.getTime()-86400000).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</b><button data-week="1" aria-label="Next week">›</button></div></header>
  <section class="quest-feature-card"><div class="quest-feature-title"><div><h3>📆 This week</h3><p>Tasks scheduled for each day</p></div>${memberRole==='parent'?'<a href="#tasks" class="cloud-secondary quest-inline-link">＋ Assign tasks</a>':''}</div><div class="quest-week-grid">${weekMarkup}</div>${memberRole==='parent'&&unscheduled.length?`<form class="quest-schedule-form" data-plan-form><b>Put an unplanned task on the calendar</b><select name="assignment" required>${unscheduled.map(t=>`<option value="${esc(t.taskId)}|${esc(t.title)}">${esc(t.childName)} · ${esc(t.title)}</option>`).join('')}</select><select name="day" aria-label="Pick a day">${dateOptions}</select><input name="time" type="time" value="17:00" aria-label="Pick a time"><button class="cloud-primary" type="submit">Add to week</button></form>`:''}${unscheduled.length?`<p class="quest-unplanned-note">${unscheduled.length} task${unscheduled.length===1?'':'s'} still need a day scheduled.</p>`:''}</section>
  <div class="quest-feature-columns"><section class="quest-feature-card"><div class="quest-feature-title"><div><h3>🎁 Reward goals</h3><p>See what each child is saving toward</p></div><a href="#rewards" class="quest-inline-link">Open shop →</a></div>${goalRows||'<p class="quest-feature-empty">Add a child and a reward to set a goal.</p>'}</section>
  <section class="quest-feature-card"><div class="quest-feature-title"><div><h3>✅ Task check-in</h3><p>Work moves through a simple parent review</p></div></div><div class="quest-approval-summary"><span>${memberRole==='parent'?'⏳':'📨'}</span><div><b>${pending.length} ${pending.length===1?'task':'tasks'} ${memberRole==='parent'?'waiting for your review':'waiting for parent review'}</b><small>${open.length} still to do · ${approved} finished</small></div>${memberRole==='parent'&&pending.length?'<a href="#reviews" class="cloud-primary">Review</a>':''}</div></section></div>
  <section class="quest-feature-card"><div class="quest-feature-title"><div><h3>🏆 Little wins</h3><p>Badges are earned as tasks are approved</p></div></div><div class="quest-badge-grid">${badges.map(b=>`<article class="quest-badge${b.earned?' earned':''}"><span>${b.icon}</span><b>${b.name}</b><small>${b.desc}</small><em>${b.earned?'Earned!':'Keep going'}</em></article>`).join('')}</div></section>
  <section class="quest-feature-card quest-reminder-card"><div><h3>🔔 Task reminders</h3><p>${reminderCopy()}</p><small>Reminders are checked on this device while Questly is open. You can turn them off any time.</small></div><button class="cloud-primary" data-reminder-toggle>${reminderEnabled()?'Turn reminders off':'Enable reminders'}</button></section><p class="quest-feature-feedback" aria-live="polite"></p></section>`;
}
function positionMobileNav(nav: HTMLElement) {
  const mobile = window.matchMedia('(max-width:700px)').matches;
  if (mobile) {
    if (!navPlaceholder && nav.parentNode) {
      navPlaceholder = document.createComment('mobile navigation home');
      nav.parentNode.insertBefore(navPlaceholder, nav);
    }
    if (!mobileNavPortal) {
      mobileNavPortal = document.getElementById('quest-mobile-nav-portal') ?? document.createElement('div');
      mobileNavPortal.id = 'quest-mobile-nav-portal';
      if (!mobileNavPortal.isConnected) document.body.append(mobileNavPortal);
    }
    if (nav.parentElement !== mobileNavPortal) mobileNavPortal.append(nav);
  } else if (navPlaceholder?.parentNode && nav.parentNode !== navPlaceholder.parentNode) {
    navPlaceholder.parentNode.insertBefore(nav, navPlaceholder.nextSibling);
    mobileNavPortal?.remove();
    mobileNavPortal = null;
  }
}
function syncActiveNav() {
  const href=window.location.hash||'#dashboard';
  document.querySelectorAll<HTMLAnchorElement>('.cloud-side-nav a').forEach(link=>{
    if(link.getAttribute('href')===href) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
}
function reminderEnabled(){return localStorage.getItem(reminderKey)==='true';}
function reminderCopy(){if(!('Notification'in window))return 'This browser does not support notifications.';if(Notification.permission==='denied')return 'Notifications are blocked in browser settings. Allow them there to turn reminders on.';return reminderEnabled()?'You’ll get one reminder for unfinished tasks due today.':'Allow Questly to remind you about unfinished tasks due today.';}
function mount() {
  const nav=document.querySelector<HTMLElement>('.cloud-side-nav'),content=document.querySelector<HTMLElement>('.cloud-content');
  if(!nav||!content)return;
  positionMobileNav(nav);
  let link=nav.querySelector<HTMLAnchorElement>('a[href="#planner"]');
  if(!link){link=document.createElement('a');link.href='#planner';link.innerHTML='<span class="quest-nav-emoji" aria-hidden="true">🗓️</span><span class="quest-nav-label">Planner</span>';link.setAttribute('aria-label','Weekly planner and goals');link.title='Weekly planner and goals';link.dataset.tooltip='Weekly planner and goals';nav.append(link);}
  syncActiveNav();
  let panel=content.querySelector<HTMLElement>('#planner');
  if(!panel){panel=document.createElement('div');panel.id='planner';panel.className='quest-features-host';panel.innerHTML='<section class="quest-features-panel"><p>Loading your family planner…</p></section>';content.insertBefore(panel,content.querySelector('.cloud-foot')??null);}
  const currentKey=key();
  if(loadedKey!==currentKey&&failedKey!==currentKey&&!loading){loading=true;let timeout:number|undefined;Promise.race([loadData(),new Promise<never>((_,reject)=>{timeout=window.setTimeout(()=>reject(new Error('Family planner timed out. Check your connection and try again.')),15000);})]).then(()=>{loadedKey=currentKey;failedKey='';renderPlanner(panel!);runDueReminders();}).catch(error=>{failedKey=currentKey;panel!.innerHTML=`<section class="quest-features-panel"><p class="quest-feature-error">Planner couldn’t load: ${esc((error as Error).message)}</p><button class="cloud-secondary" data-features-retry>Try again</button></section>`;}).finally(()=>{if(timeout)window.clearTimeout(timeout);loading=false;if(currentKey!==key())queueMicrotask(()=>void mount());});}
  else if(loadedKey===currentKey&&!panel.querySelector('.quest-features-panel h2'))renderPlanner(panel);
  addReminderCardToSettings();
}
function addReminderCardToSettings(){const settings=document.querySelector<HTMLElement>('#settings .quest-settings-grid');if(!settings||settings.querySelector('[data-settings-reminders]'))return;const card=document.createElement('section');card.className='quest-settings-card';card.dataset.settingsReminders='true';card.innerHTML=`<div class="quest-settings-card-title"><span>🔔</span><div><h3>Task reminders</h3><p>${esc(reminderCopy())}</p></div></div><button class="cloud-primary" data-reminder-toggle>${reminderEnabled()?'Turn reminders off':'Enable reminders'}</button><p class="quest-settings-note">Questly will ask permission only when you choose to enable reminders. Reminders work on this device while the app is open.</p>`;settings.append(card);}
async function scheduleTask(form:HTMLFormElement){if(!supabase)return;const data=new FormData(form);const taskId=String(data.get('assignment')??'').split('|')[0];const date=String(data.get('day')??'');const time=String(data.get('time')??'17:00');if(!taskId||!date) return;const dueAt=new Date(`${date}T${time}:00`).toISOString();const{error}=await supabase.from('tasks').update({due_at:dueAt}).eq('id',taskId).eq('family_id',activeFamilyId);if(error)throw error;loadedKey='';await loadData();loadedKey=key();const panel=document.querySelector<HTMLElement>('#planner');if(panel)renderPlanner(panel);}
function runDueReminders(){if(!reminderEnabled()||!('Notification'in window)||Notification.permission!=='granted')return;const today=dayKey(new Date());const due=tasks.filter(t=>t.dueAt&&dayKey(new Date(t.dueAt))===today&&!['approved','pending_approval','cancelled'].includes(t.status));const sent=JSON.parse(localStorage.getItem(noticeKey)||'{}') as Record<string,string>;for(const task of due){if(sent[task.assignmentId]===today)continue;new Notification('Questly task reminder',{body:`${task.title}${memberRole==='parent'?` · ${task.childName}`:''} is due today.`,tag:`questly-${task.assignmentId}-${today}`});sent[task.assignmentId]=today;}localStorage.setItem(noticeKey,JSON.stringify(sent));}
function setReminderFeedback(message:string){document.querySelectorAll<HTMLElement>('.quest-feature-feedback').forEach(el=>el.textContent=message);}
async function toggleReminders(){if(reminderEnabled()){localStorage.setItem(reminderKey,'false');setReminderFeedback('Task reminders are off.');}
  else if(!('Notification'in window)){setReminderFeedback('This browser does not support notifications.');}
  else {const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission==='granted'){localStorage.setItem(reminderKey,'true');setReminderFeedback('Reminders are on. You’ll get one reminder for unfinished tasks due today.');runDueReminders();}else setReminderFeedback('Permission wasn’t granted. You can allow notifications in your browser settings.');}
  const panel=document.querySelector<HTMLElement>('#planner');if(panel)renderPlanner(panel);addReminderCardToSettings();const card=document.querySelector<HTMLElement>('[data-settings-reminders]');if(card){const p=card.querySelector('h3')?.parentElement?.querySelector('p');if(p)p.textContent=reminderCopy();const b=card.querySelector<HTMLButtonElement>('[data-reminder-toggle]');if(b)b.textContent=reminderEnabled()?'Turn reminders off':'Enable reminders';}}
export function installFamilyFeatures(){const root=document.getElementById('root');if(!root)return;root.addEventListener('click',event=>{const target=event.target as HTMLElement;if(target.closest('[data-week]')){weekShift+=Number(target.closest<HTMLElement>('[data-week]')?.dataset.week??0);const panel=document.querySelector<HTMLElement>('#planner');if(panel)renderPlanner(panel);}if(target.closest('[data-reminder-toggle]'))void toggleReminders();if(target.closest('[data-features-retry]')){loadedKey='';failedKey='';void mount();}});root.addEventListener('submit',event=>{const form=(event.target as HTMLElement).closest<HTMLFormElement>('[data-plan-form]');if(!form)return;event.preventDefault();const button=form.querySelector<HTMLButtonElement>('button');if(button)button.disabled=true;scheduleTask(form).catch(error=>setReminderFeedback(`Could not schedule task: ${(error as Error).message}`)).finally(()=>{if(button)button.disabled=false;});});root.addEventListener('change',event=>{if((event.target as HTMLElement).matches('.cloud-top-right select')){loadedKey='';failedKey='';}});window.addEventListener('hashchange',syncActiveNav);window.matchMedia('(max-width:700px)').addEventListener('change',()=>{const nav=document.querySelector<HTMLElement>('.cloud-side-nav');if(nav)positionMobileNav(nav);});observer?.disconnect();observer=new MutationObserver(()=>mount());observer.observe(root,{childList:true,subtree:true});void mount();window.setInterval(runDueReminders,60_000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)runDueReminders();});}
