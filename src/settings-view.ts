import { supabase } from './lib/supabase';

type SettingsContext = {
  userId: string;
  email: string;
  role: 'parent' | 'child';
  profileName: string;
  familyName: string;
  familyId: string;
  childId?: string;
};

let observer: MutationObserver | undefined;
let loadedKey: string | null = null;
let failedKey = '';
let loading = false;
let initialHashHandled = false;
const themeKey = 'questly-theme';
const textSizeKey = 'questly-text-size';
const densityKey = 'questly-density';
const contrastKey = 'questly-high-contrast';
const motionKey = 'questly-reduced-motion';
const themes = ['garden', 'ocean', 'berry'] as const;
type Theme = typeof themes[number];
const safe = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const contextKey = () => document.querySelector<HTMLSelectElement>('.cloud-top-right select')?.value ?? 'default';

function showWelcome(name: string) {
  const heading = document.querySelector<HTMLElement>('.cloud-heading');
  if (!heading) return;
  let banner = heading.parentElement?.querySelector<HTMLElement>(':scope > .quest-welcome-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'quest-welcome-banner';
    heading.insertAdjacentElement('afterend', banner);
  }
  const formatted = name.trim().split(/\s+/).map(part => part ? part[0].toLocaleUpperCase() + part.slice(1) : '').join(' ');
  const content = `<span aria-hidden="true">👋</span><div><small>WELCOME BACK</small><b>${safe(formatted || 'Questly member')}</b></div>`;
  if (banner.innerHTML !== content) banner.innerHTML = content;
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.questTheme = theme;
  localStorage.setItem(themeKey, theme);
}

function applyAppearance() {
  const root = document.documentElement;
  root.dataset.questTextSize = localStorage.getItem(textSizeKey) === 'large' ? 'large' : 'standard';
  root.dataset.questDensity = localStorage.getItem(densityKey) === 'compact' ? 'compact' : 'comfortable';
  root.dataset.questContrast = localStorage.getItem(contrastKey) === 'true' ? 'high' : 'standard';
  root.dataset.questMotion = localStorage.getItem(motionKey) === 'true' ? 'reduced' : 'full';
}

function normalizeNavigation(nav: HTMLElement) {
  const items: Array<[string, string, string]> = [
    ['#dashboard', '🏠', 'Overview'], ['#family', '👨‍👩‍👧', 'Family'], ['#tasks', '📝', 'Tasks'],
    ['#rewards', '🎁', 'Rewards'], ['#activity', '📅', 'Activity'], ['#settings', '⚙️', 'Settings'],
  ];
  for (const [href, emoji, label] of items) {
    let link = nav.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
    if (!link) {
      link = document.createElement('a');
      link.href = href;
      nav.append(link);
    }
    link.setAttribute('aria-label', label);
    link.title = label;
    if (link.textContent?.trim() !== `${emoji}${label}` || !link.querySelector('.quest-nav-emoji') || !link.querySelector('.quest-nav-label')) {
      const symbol = document.createElement('span');
      symbol.className = 'quest-nav-emoji';
      symbol.setAttribute('aria-hidden', 'true');
      symbol.textContent = emoji;
      const title = document.createElement('span');
      title.className = 'quest-nav-label';
      title.textContent = label;
      link.replaceChildren(symbol, title);
    }
    link.dataset.tooltip = `Open ${label}`;
    if (!initialHashHandled && window.location.hash === href && !document.querySelector(':target')) {
      initialHashHandled = true;
      link.click();
    }
  }
}

function markup(context: SettingsContext | null, error?: string) {
  if (error || !context) return `<section class="quest-settings-panel"><div class="quest-settings-alert">${safe(error ?? 'Sign in to manage your settings.')}</div><button type="button" class="cloud-secondary" data-settings-retry>↻ Try loading again</button></section>`;
  const theme = (themes as readonly string[]).includes(localStorage.getItem(themeKey) ?? '') ? localStorage.getItem(themeKey)! : 'garden';
  const textSize = localStorage.getItem(textSizeKey) === 'large' ? 'large' : 'standard';
  const density = localStorage.getItem(densityKey) === 'compact' ? 'compact' : 'comfortable';
  const highContrast = localStorage.getItem(contrastKey) === 'true';
  const reducedMotion = localStorage.getItem(motionKey) === 'true';
  const child = context.role === 'child';
  return `<section class="quest-settings-panel">
    <header class="quest-settings-header"><div><span>⚙️ YOUR SPACE</span><h2>Settings</h2><p>Manage your account, family details, and the look of Questly.</p></div><span class="quest-settings-role">${child ? '🧒 Child account' : '🧑‍🧑‍🧒 Parent account'}</span></header>
    <div class="quest-settings-grid">
      <section class="quest-settings-card quest-settings-profile"><div class="quest-settings-card-title"><span>👤</span><div><h3>Profile</h3><p>Keep your account details up to date.</p></div></div>
        <form data-settings-form="profile"><label>Display name<input name="display_name" value="${safe(context.profileName)}" required maxlength="${child ? 50 : 80}" autocomplete="name"></label><label>Email address<input value="${safe(context.email)}" readonly aria-readonly="true"></label><button class="cloud-primary" type="submit">Save profile</button></form>
      </section>
      <section class="quest-settings-card"><div class="quest-settings-card-title"><span>👨‍👩‍👧</span><div><h3>Family</h3><p>${child ? 'Your family space and shared activities.' : 'Update your family space or manage its members.'}</p></div></div>
        <form data-settings-form="family"><label>Family name<input name="family_name" value="${safe(context.familyName)}" ${child ? 'readonly aria-readonly="true"' : 'required maxlength="100"'}></label>${child ? '<p class="quest-settings-note">A parent can change the family name.</p>' : '<button class="cloud-secondary" type="submit">Save family name</button>'}</form>
        <div class="quest-settings-actions"><a href="#family">👨‍👩‍👧 Open family</a><a href="#tasks">📝 Manage tasks</a><a href="#rewards">🎁 Manage rewards</a><a href="#activity">📅 View activity</a></div>
      </section>
      <section class="quest-settings-card quest-settings-appearance"><div class="quest-settings-card-title"><span>🎨</span><div><h3>Appearance</h3><p>Personalize how Questly looks and feels.</p></div></div><label>Color theme<select data-appearance="theme"><option value="garden" ${theme === 'garden' ? 'selected' : ''}>🌿 Garden</option><option value="ocean" ${theme === 'ocean' ? 'selected' : ''}>🌊 Ocean</option><option value="berry" ${theme === 'berry' ? 'selected' : ''}>🍇 Berry</option></select></label><label>Text size<select data-appearance="text-size"><option value="standard" ${textSize === 'standard' ? 'selected' : ''}>Standard</option><option value="large" ${textSize === 'large' ? 'selected' : ''}>Larger</option></select></label><label>Dashboard spacing<select data-appearance="density"><option value="comfortable" ${density === 'comfortable' ? 'selected' : ''}>Comfortable</option><option value="compact" ${density === 'compact' ? 'selected' : ''}>Compact</option></select></label><label class="quest-settings-toggle"><span><b>High contrast</b><small>Strengthen text and control edges</small></span><input type="checkbox" data-appearance="contrast" ${highContrast ? 'checked' : ''}></label><label class="quest-settings-toggle"><span><b>Reduce motion</b><small>Turn off decorative movement</small></span><input type="checkbox" data-appearance="motion" ${reducedMotion ? 'checked' : ''}></label><p class="quest-settings-note">Appearance choices are saved in this browser.</p></section>
      <section class="quest-settings-card"><div class="quest-settings-card-title"><span>🔐</span><div><h3>Security</h3><p>Change the password for your signed-in account.</p></div></div><form data-settings-form="password"><label>New password<input name="password" type="password" minlength="6" autocomplete="new-password" placeholder="At least 6 characters" required></label><label>Confirm new password<input name="confirm_password" type="password" minlength="6" autocomplete="new-password" required></label><button class="cloud-secondary" type="submit">Update password</button></form></section>
      <section class="quest-settings-card quest-settings-account"><div class="quest-settings-card-title"><span>🚪</span><div><h3>Account</h3><p>Sign out of this device when you’re done.</p></div></div><button class="quest-settings-signout" type="button" data-settings-action="signout">Sign out</button></section>
    </div><p class="quest-settings-feedback" aria-live="polite"></p>
  </section>`;
}

async function loadContext(): Promise<SettingsContext | null> {
  if (!supabase) throw new Error('Connect Supabase to manage settings.');
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const user = sessionData.session?.user;
  if (!user) return null;
  const { data: memberships, error: membershipError } = await supabase.from('family_memberships').select('family_id,role').eq('user_id', user.id).order('created_at');
  if (membershipError) throw membershipError;
  const activeId = document.querySelector<HTMLSelectElement>('.cloud-top-right select')?.value;
  const membership = (memberships ?? []).find(row => row.family_id === activeId) ?? (memberships ?? [])[0];
  const { data: profile, error: profileError } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  if (profileError) throw profileError;
  const fallback = String(user.user_metadata?.display_name ?? user.email?.split('@')[0] ?? 'Questly member');
  if (!membership) return { userId: user.id, email: user.email ?? '', role: 'parent', profileName: profile?.display_name ?? fallback, familyName: '', familyId: '' };
  const { data: family, error: familyError } = await supabase.from('families').select('id,name').eq('id', membership.family_id).maybeSingle();
  if (familyError) throw familyError;
  let childId: string | undefined;
  let profileName = profile?.display_name ?? fallback;
  if (membership.role === 'child') {
    const { data: child, error: childError } = await supabase.from('child_profiles').select('id,display_name').eq('auth_user_id', user.id).eq('family_id', membership.family_id).maybeSingle();
    if (childError) throw childError;
    if (child) { childId = child.id; profileName = child.display_name; }
  }
  return { userId: user.id, email: user.email ?? '', role: membership.role, profileName, familyName: family?.name ?? '', familyId: membership.family_id, childId };
}

function setFeedback(message: string, bad = false) {
  const feedback = document.querySelector<HTMLElement>('.quest-settings-feedback');
  if (feedback) { feedback.textContent = message; feedback.dataset.state = bad ? 'error' : 'success'; }
}

async function submitForm(form: HTMLFormElement) {
  if (!supabase) return;
  const data = new FormData(form);
  const type = form.dataset.settingsForm;
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) throw new Error('Your session ended. Sign in again.');
  if (type === 'profile') {
    const displayName = String(data.get('display_name') ?? '').trim();
    if (!displayName) throw new Error('Enter a display name.');
    const { data: membership } = await supabase.from('family_memberships').select('family_id,role').eq('user_id', user.id).limit(1).maybeSingle();
    if (membership?.role === 'child') {
      const { error } = await supabase.from('child_profiles').update({ display_name: displayName }).eq('auth_user_id', user.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('profiles').update({ display_name: displayName }).eq('id', user.id);
      if (error) throw error;
    }
    setFeedback('Profile saved.');
  } else if (type === 'family') {
    const familyName = String(data.get('family_name') ?? '').trim();
    if (!familyName) throw new Error('Enter a family name.');
    const familyId = document.querySelector<HTMLElement>('#settings')?.dataset.familyId;
    if (!familyId) throw new Error('No family is linked to this account.');
    const { error } = await supabase.from('families').update({ name: familyName }).eq('id', familyId);
    if (error) throw error;
    setFeedback('Family name saved.');
  } else if (type === 'password') {
    const password = String(data.get('password') ?? '');
    if (password !== String(data.get('confirm_password') ?? '')) throw new Error('The passwords do not match.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    form.reset();
    setFeedback('Password updated.');
  }
}

async function onSubmit(event: Event) {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-settings-form]');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) button.disabled = true;
  try { await submitForm(form); }
  catch (error) { setFeedback((error as Error)?.message ?? 'Could not save settings.', true); }
  finally { if (button) button.disabled = false; }
}

async function mount() {
  const nav = document.querySelector<HTMLElement>('.cloud-side-nav');
  const content = document.querySelector<HTMLElement>('.cloud-content');
  if (!nav || !content) return;
  normalizeNavigation(nav);
  let page = content.querySelector<HTMLElement>('#settings');
  if (!page) {
    page = document.createElement('div');
    page.id = 'settings';
    page.className = 'quest-settings-host';
    page.innerHTML = '<section class="quest-settings-panel"><p>Loading your settings…</p></section>';
    const foot = content.querySelector('.cloud-foot');
    content.insertBefore(page, foot ?? null);
  }
  const key = contextKey();
  if (loadedKey !== key && failedKey !== key && !loading) {
    loading = true;
    let timeout: number | undefined;
    try {
      const context = await Promise.race([
        loadContext(),
        new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('Settings took too long to load. Check your connection and try again.')), 15000); }),
      ]);
      if (key !== contextKey()) return;
      page.dataset.familyId = context?.familyId ?? '';
      page.innerHTML = markup(context);
      if (context) showWelcome(context.profileName);
      loadedKey = key;
      failedKey = '';
    } catch (error) {
      if (key !== contextKey()) return;
      page.innerHTML = markup(null, `Settings couldn’t load: ${(error as Error)?.message ?? error}`);
      failedKey = key;
    } finally {
      if (timeout) window.clearTimeout(timeout);
      loading = false;
      if (key !== contextKey()) queueMicrotask(() => { void mount(); });
    }
  }
}

export function installSettingsView() {
  const root = document.getElementById('root');
  if (!root) return;
  const savedTheme = localStorage.getItem(themeKey);
  applyTheme((themes as readonly string[]).includes(savedTheme ?? '') ? savedTheme as Theme : 'garden');
  applyAppearance();
  root.addEventListener('submit', event => { void onSubmit(event); });
  root.addEventListener('change', event => {
    const control = (event.target as HTMLElement).closest<HTMLInputElement | HTMLSelectElement>('[data-appearance]');
    if (!control) return;
    const setting = control.dataset.appearance;
    if (setting === 'theme' && (themes as readonly string[]).includes(control.value)) localStorage.setItem(themeKey, control.value);
    if (setting === 'text-size') localStorage.setItem(textSizeKey, control.value === 'large' ? 'large' : 'standard');
    if (setting === 'density') localStorage.setItem(densityKey, control.value === 'compact' ? 'compact' : 'comfortable');
    if (setting === 'contrast' && control instanceof HTMLInputElement) localStorage.setItem(contrastKey, String(control.checked));
    if (setting === 'motion' && control instanceof HTMLInputElement) localStorage.setItem(motionKey, String(control.checked));
    applyTheme((themes as readonly string[]).includes(localStorage.getItem(themeKey) ?? '') ? localStorage.getItem(themeKey) as Theme : 'garden');
    applyAppearance();
  });
  root.addEventListener('click', event => {
    if ((event.target as HTMLElement).closest('[data-settings-retry]')) { failedKey = ''; loadedKey = null; void mount(); return; }
    if ((event.target as HTMLElement).closest('[data-settings-action="signout"]')) void supabase?.auth.signOut();
  });
  root.addEventListener('change', event => {
    if ((event.target as HTMLElement).matches('.cloud-top-right select')) { loadedKey = null; failedKey = ''; void mount(); }
  });
  observer?.disconnect();
  observer = new MutationObserver(() => { void mount(); });
  observer.observe(root, { childList: true, subtree: true });
  void mount();
}
