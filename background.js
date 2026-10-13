// Trace service worker.
// It does two things: it injects the inspector into a tab on request, and it is
// the only place that writes the inspection history, after validating the data.

const HISTORY_KEY = 'traceHistory';
const HISTORY_LIMIT = 20;
const SAVED_STYLES = [
  'display',
  'position',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'border-radius',
];

let inspectorCss = null;

// Turns Chrome's injection errors into something a person can act on.
function explainFailure(error, url = '') {
  const text = String(error?.message || error || '');
  if (/^(chrome|edge|brave|about|devtools|view-source|chrome-extension|chrome-search):/i.test(url) || /chrome:\/\/|chrome-extension:\/\//i.test(text)) {
    return 'Chrome does not allow extensions on its own pages. Open a regular website and try again.';
  }
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url) || /extensions gallery/i.test(text)) {
    return 'The Chrome Web Store cannot be inspected by extensions. Try another website.';
  }
  if (/^file:/i.test(url)) {
    return 'Local files are blocked by default. Enable "Allow access to file URLs" for Trace in chrome://extensions, then reload the page.';
  }
  if (/No tab with id|Frame with ID|tab was closed/i.test(text)) {
    return 'The tab changed while Trace was starting. Try again.';
  }
  if (/Cannot access|permission/i.test(text)) {
    return 'Trace cannot run on this page. Chrome protects some pages, such as the built-in PDF viewer and other extensions.';
  }
  return 'Trace could not start on this page. Reload the page and try again.';
}

// Injects the inspector. The stylesheet is read here and handed to the page script,
// so no extension file has to be exposed to websites.
async function startInspecting(tabId, url) {
  try {
    if (inspectorCss === null) {
      inspectorCss = await (await fetch(chrome.runtime.getURL('inspector.css'))).text();
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (css) => {
        globalThis.__traceInspectorCss = css;
      },
      args: [inspectorCss],
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['inspector.js'] });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: explainFailure(error, url) };
  }
}

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const size = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(100000, Math.round(value))) : 0);

// Builds a history entry from scratch: only known fields, with types and lengths checked.
// Anything else sent by the page script is ignored.
function sanitizeEntry(raw, senderUrl) {
  if (!raw || typeof raw !== 'object') return null;
  const tag = text(raw.tag, 40).toLowerCase();
  if (!/^[a-z][a-z0-9:._-]*$/.test(tag)) return null;

  let origin = '';
  try {
    const parsed = new URL(senderUrl);
    origin = parsed.origin === 'null' ? parsed.protocol : parsed.origin;
  } catch {
    return null;
  }

  const styles = {};
  if (raw.styles && typeof raw.styles === 'object') {
    for (const name of SAVED_STYLES) {
      const value = text(raw.styles[name], 160);
      if (value) styles[name] = value;
    }
  }

  return {
    id: crypto.randomUUID(),
    time: Date.now(),
    origin,
    tag,
    elementId: text(raw.elementId, 120),
    classes: Array.isArray(raw.classes)
      ? raw.classes.filter((name) => typeof name === 'string').slice(0, 12).map((name) => name.slice(0, 80))
      : [],
    selector: text(raw.selector, 400),
    width: size(raw.width),
    height: size(raw.height),
    styles,
  };
}

async function saveEntry(raw, senderUrl) {
  const entry = sanitizeEntry(raw, senderUrl);
  if (!entry) return { ok: false };

  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
  // Selecting the same element twice in a row updates the entry instead of repeating it.
  if (history[0] && history[0].origin === entry.origin && history[0].selector === entry.selector) history.shift();
  history.unshift(entry);
  await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, HISTORY_LIMIT) });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only messages from this extension's own pages and scripts are accepted.
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false;

  if (message.type === 'trace:start' && !sender.tab && Number.isInteger(message.tabId)) {
    startInspecting(message.tabId, text(message.url, 2000)).then(sendResponse);
    return true;
  }
  if (message.type === 'trace:save' && sender.tab && sender.url) {
    saveEntry(message.entry, sender.url).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'start-inspecting') return;
  const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (target?.id !== undefined) await startInspecting(target.id, target.url);
});
