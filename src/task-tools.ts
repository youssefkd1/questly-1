let observer: MutationObserver | undefined;
let initialHashHandled = '';

function activateInitialHash() {
  const hash = window.location.hash;
  if (!hash || initialHashHandled === hash || document.querySelector(':target')) return;
  const link = [...document.querySelectorAll<HTMLAnchorElement>('.cloud-side-nav a')].find(item => item.getAttribute('href') === hash);
  if (link) {
    initialHashHandled = hash;
    link.click();
  }
}

function attachTaskTools() {
  activateInitialHash();
  const panel = document.querySelector<HTMLElement>('#tasks');
  const heading = panel?.querySelector('.cloud-panel-head');
  if (!panel || !heading) return;

  let tools = panel.querySelector<HTMLElement>('.cloud-task-tools');
  if (!tools) {
    tools = document.createElement('div');
    tools.className = 'cloud-task-tools';
    tools.innerHTML = `
      <label class="cloud-task-search"><span aria-hidden="true">🔎</span><input type="search" placeholder="Find a task…" aria-label="Find a task"></label>
      <label class="cloud-task-category"><span class="sr-only">Filter by category</span><select aria-label="Filter by category"><option value="">All categories</option><option>Home</option><option>Learning</option><option>Habits</option><option>Growth</option><option>Life skills</option><option>Helping family</option></select></label>
      <span class="cloud-task-result" aria-live="polite"></span>`;
    heading.insertAdjacentElement('afterend', tools);
  }

  const search = tools.querySelector<HTMLInputElement>('input');
  const category = tools.querySelector<HTMLSelectElement>('select');
  const result = tools.querySelector<HTMLElement>('.cloud-task-result');
  let empty = panel.querySelector<HTMLElement>('.cloud-task-no-results');
  if (!empty) {
    empty = document.createElement('div');
    empty.className = 'cloud-task-no-results';
    empty.textContent = 'No tasks match those filters. Try another search. 🔍';
    tools.insertAdjacentElement('afterend', empty);
  }

  const applyFilters = () => {
    const rows = [...panel.querySelectorAll<HTMLElement>('.cloud-task')];
    const query = search?.value.trim().toLocaleLowerCase() ?? '';
    const selected = category?.value.toLocaleLowerCase() ?? '';
    let shown = 0;
    for (const row of rows) {
      const copy = row.querySelector('.cloud-task-copy')?.textContent?.toLocaleLowerCase() ?? '';
      const matches = copy.includes(query) && (!selected || copy.includes(selected));
      row.hidden = !matches;
      if (matches) shown++;
    }
    const countText = rows.length ? `${shown} ${shown === 1 ? 'task' : 'tasks'}` : '';
    if (result && result.textContent !== countText) result.textContent = countText;
    if (empty) empty.hidden = rows.length === 0 || shown !== 0;
  };
  if (search && !search.dataset.bound) {
    search.addEventListener('input', applyFilters);
    search.dataset.bound = 'true';
  }
  if (category && !category.dataset.bound) {
    category.addEventListener('change', applyFilters);
    category.dataset.bound = 'true';
  }
  applyFilters();
}

export function installTaskTools() {
  attachTaskTools();
  observer?.disconnect();
  observer = new MutationObserver(() => attachTaskTools());
  observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });
}
