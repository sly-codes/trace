// Trace popup: starts and stops inspection in the active tab and shows the local history.

const HISTORY_KEY = 'traceHistory';
const $ = (id) => document.getElementById(id);

const view = {
  tab: null,
  page: { mode: 'idle', canReopen: false }, // answer of the inspector in the tab, if it is there
  history: [],
  open: null, // id of the expanded history entry
};

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const nameOf = (entry) =>
  entry.tag + (entry.elementId ? `#${entry.elementId}` : '') + entry.classes.slice(0, 3).map((name) => `.${name}`).join('');

function timeAgo(time) {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(time).toLocaleDateString();
}

let toastTimer = 0;
function toast(message, isError = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('is-error', isError);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 1600);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Selector copied');
  } catch {
    toast('Copy failed', true);
  }
}

// ---------------------------------------------------------------------------
// Talking to the tab
// ---------------------------------------------------------------------------

// Asks the inspector in the tab for its state. Fails quietly when it is not injected.
async function askPage(type) {
  if (view.tab?.id === undefined) return null;
  try {
    const answer = await chrome.tabs.sendMessage(view.tab.id, { type });
    return answer && typeof answer === 'object' ? answer : null;
  } catch {
    return null;
  }
}

async function refreshPage() {
  const answer = await askPage('trace:ping');
  view.page = {
    mode: ['picking', 'selected'].includes(answer?.mode) ? answer.mode : 'idle',
    canReopen: answer?.canReopen === true,
  };
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
  $('hint').hidden = Boolean(message);
}

async function startInspecting() {
  showError('');
  if (view.tab?.id === undefined) {
    showError('No active tab was found. Click on a web page, then open Trace again.');
    return;
  }

  $('toggle').disabled = true;
  let result;
  try {
    result = await chrome.runtime.sendMessage({ type: 'trace:start', tabId: view.tab.id, url: view.tab.url || '' });
  } catch {
    result = null;
  }
  $('toggle').disabled = false;

  // Inspection is only announced once the injection has really succeeded.
  if (!result?.ok) {
    $('status').dataset.state = 'blocked';
    $('status-text').textContent = 'Unavailable';
    showError(result?.message || 'Trace could not start on this page. Reload the page and try again.');
    return;
  }

  view.page.mode = 'picking';
  render();
  // The popup would cover part of the page: close it so the page can be explored right away.
  setTimeout(() => window.close(), 700);
}

async function stopInspecting() {
  await askPage('trace:stop');
  await refreshPage();
  render();
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function loadHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  view.history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].filter((entry) => entry && typeof entry.tag === 'string' && Array.isArray(entry.classes)) : [];
}

async function removeEntry(id) {
  view.history = view.history.filter((entry) => entry.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: view.history });
  render();
}

async function clearHistory() {
  const button = $('clear');
  // Two clicks: the first one asks for confirmation.
  if (!button.classList.contains('is-confirm')) {
    button.classList.add('is-confirm');
    button.textContent = 'Click again to clear';
    setTimeout(() => {
      button.classList.remove('is-confirm');
      button.textContent = 'Clear all';
    }, 2500);
    return;
  }
  view.history = [];
  await chrome.storage.local.remove(HISTORY_KEY);
  render();
}

// ---------------------------------------------------------------------------
// Rendering. Stored values come from web pages, so they are only ever written as text.
// ---------------------------------------------------------------------------

function renderLast() {
  const entry = view.history[0];
  $('last').hidden = !entry;
  if (!entry) return;

  $('last-name').textContent = nameOf(entry);
  $('last-size').textContent = `${entry.width} × ${entry.height}`;
  $('last-meta').textContent = `${entry.origin.replace(/^https?:\/\//, '')} · ${timeAgo(entry.time)}`;

  // The last step of the selector is the element itself. The steps before it are its path.
  const steps = entry.selector.split(' > ');
  const target = steps.pop();
  $('last-target').textContent = target;
  $('last-target').hidden = target === nameOf(entry); // already shown in the chip above
  $('last-path').textContent = steps.length ? `in ${steps.join(' > ')}` : '';
  $('last-path').hidden = steps.length === 0;
  $('last-path').title = entry.selector;

  const colors = $('last-colors');
  colors.replaceChildren();
  for (const name of ['color', 'background-color']) {
    const value = entry.styles?.[name];
    if (!value) continue;
    const dot = make('span', 'dot');
    dot.title = `${name}: ${value}`;
    if (CSS.supports('color', value)) dot.style.setProperty('--color', value);
    colors.append(dot);
  }

  $('reopen').disabled = !view.page.canReopen;
  $('reopen').title = view.page.canReopen
    ? 'Show the inspection panel again on the page'
    : 'Only available while the inspected page is still open in this tab';
}

function renderHistory() {
  const list = $('history');
  list.replaceChildren();
  $('count').textContent = view.history.length ? `${view.history.length} / 20` : '';
  $('empty').hidden = view.history.length > 0;
  $('clear').hidden = view.history.length === 0;

  for (const entry of view.history) {
    const item = make('li', 'entry');
    const row = make('div', 'entry__row');

    const main = make('button', 'entry__main');
    main.type = 'button';
    main.title = 'Show the saved details';
    main.setAttribute('aria-expanded', String(view.open === entry.id));
    main.append(make('span', 'entry__name', nameOf(entry)), make('span', 'entry__meta', `${entry.origin} · ${timeAgo(entry.time)}`));
    main.addEventListener('click', () => {
      view.open = view.open === entry.id ? null : entry.id;
      renderHistory();
    });

    const copyButton = make('button', 'entry__tool', '⧉');
    copyButton.type = 'button';
    copyButton.title = 'Copy the selector';
    copyButton.setAttribute('aria-label', 'Copy the selector');
    copyButton.addEventListener('click', () => copy(entry.selector));

    const removeButton = make('button', 'entry__tool', '✕');
    removeButton.type = 'button';
    removeButton.title = 'Remove from history';
    removeButton.setAttribute('aria-label', 'Remove from history');
    removeButton.addEventListener('click', () => removeEntry(entry.id));

    row.append(main, copyButton, removeButton);
    item.append(row);

    if (view.open === entry.id) {
      const details = make('dl', 'entry__details');
      const add = (name, value) => details.append(make('dt', '', name), make('dd', '', value));
      add('selector', entry.selector);
      add('size', `${entry.width} × ${entry.height} px`);
      for (const [name, value] of Object.entries(entry.styles || {})) add(name, String(value));
      item.append(details);
    }
    list.append(item);
  }
}

function render() {
  const picking = view.page.mode === 'picking';
  const active = view.page.mode !== 'idle';

  $('status').dataset.state = active ? 'active' : 'idle';
  $('status-text').textContent = picking ? 'Inspecting' : active ? 'Panel open' : 'Ready';

  const toggle = $('toggle');
  toggle.textContent = picking ? 'Stop Inspecting' : active ? 'Inspect Again' : 'Start Inspecting';
  toggle.classList.toggle('is-stop', picking);

  renderLast();
  renderHistory();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function init() {
  $('toggle').addEventListener('click', () => (view.page.mode === 'picking' ? stopInspecting() : startInspecting()));
  $('clear').addEventListener('click', clearHistory);
  $('copy-last').addEventListener('click', () => view.history[0] && copy(view.history[0].selector));
  $('reopen').addEventListener('click', async () => {
    const answer = await askPage('trace:reopen');
    if (answer?.ok) window.close();
    else toast('The element is no longer on the page', true);
  });

  try {
    [view.tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    view.tab = null;
  }
  await Promise.all([loadHistory(), refreshPage()]);
  render();
}

init();
