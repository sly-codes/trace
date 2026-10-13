// Trace inspector, injected into the active tab on request.
//
// Everything it draws lives in one host element with a closed Shadow DOM, so the
// page's styles cannot reach it and its own styles cannot leak into the page.
// While picking, a transparent overlay sits above the page: clicks land on the
// overlay, never on the page, so no link or button of the site is triggered.

(() => {
  'use strict';

  const KEY = '__traceInspector';
  // Already injected in this page: start picking again instead of building a second interface.
  if (globalThis[KEY]) {
    globalThis[KEY].start();
    return;
  }

  const HOST_ID = 'trace-extension-root';
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const COMPUTED = [
    'display',
    'position',
    'box-sizing',
    'color',
    'background-color',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'border-radius',
    'opacity',
    'z-index',
  ];
  const SAVED_STYLES = ['display', 'position', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'border-radius'];
  const INNER_COLOR_SCAN = 40; // how many descendants are looked at for extra colors
  const INNER_COLOR_MAX = 5;

  const state = {
    mode: 'idle', // idle | picking | selected
    hovered: null,
    selected: null,
    last: null, // WeakRef to the last selected element, for "reopen"
    data: null,
    crumbs: [],
    dock: 'right',
    frame: 0,
    timer: 0,
    toastTimer: 0,
  };
  let host = null;
  let ui = null;

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, onClick, title) {
    const node = make('button', className, label);
    node.type = 'button';
    if (title) node.title = title;
    node.addEventListener('click', onClick);
    return node;
  }

  const round = (value) => Math.round(value * 100) / 100;
  const px = (value) => round(parseFloat(value) || 0);

  // Works for HTML and SVG elements (SVG has no plain string className).
  const classesOf = (element) => (element.getAttribute('class') || '').split(/\s+/).filter(Boolean);

  function describe(element) {
    const classes = classesOf(element).slice(0, 2);
    return element.localName + (element.id ? `#${element.id}` : '') + classes.map((name) => `.${name}`).join('');
  }

  const isSensitive = (element) => element.matches('input[type="password" i]');

  // -------------------------------------------------------------------------
  // Reading the selected element
  // -------------------------------------------------------------------------

  function countMatches(root, selector) {
    try {
      return root.querySelectorAll(selector).length;
    } catch {
      return -1;
    }
  }

  // Builds a short selector by walking up from the element until it matches only
  // one element. It is a best effort: the page can change, and the result is not
  // guaranteed to stay unique.
  function buildSelector(target) {
    const root = target.getRootNode();
    const idSelector = (node) => (node.id ? `#${CSS.escape(node.id)}` : '');

    if (target.id && countMatches(root, idSelector(target)) === 1) {
      return { value: idSelector(target), matches: 1 };
    }

    const parts = [];
    let selector = '';
    let node = target;
    for (let depth = 0; node && node.nodeType === Node.ELEMENT_NODE && depth < 8; depth++) {
      if (node !== target && node.id && countMatches(root, idSelector(node)) === 1) {
        parts.unshift(idSelector(node));
        selector = parts.join(' > ');
        break;
      }
      let part = node.localName.includes(':') ? '*' : CSS.escape(node.localName);
      part += classesOf(node)
        .filter((name) => name.length <= 40)
        .slice(0, 2)
        .map((name) => `.${CSS.escape(name)}`)
        .join('');
      const parent = node.parentElement;
      if (parent) {
        const twins = Array.prototype.filter.call(parent.children, (child) => child.localName === node.localName);
        if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      selector = parts.join(' > ');
      if (countMatches(root, selector) === 1) break;
      node = parent;
    }
    return { value: selector, matches: countMatches(root, selector) };
  }

  let colorCanvas = null;

  // Turns a computed color into { hex, alpha }. Returns hex: null when it cannot be expressed.
  function parseColor(value) {
    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value);
    let channels = null;
    let approximate = false;

    if (rgb) {
      const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
      channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
    } else {
      // Other color spaces (oklch, color(), ...): let a 1x1 canvas convert them to sRGB.
      try {
        colorCanvas ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', {
          willReadFrequently: true,
        });
        colorCanvas.clearRect(0, 0, 1, 1);
        colorCanvas.fillStyle = '#000';
        colorCanvas.fillStyle = value;
        colorCanvas.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = colorCanvas.getImageData(0, 0, 1, 1).data;
        channels = [r, g, b, a / 255];
        approximate = true;
      } catch {
        return { hex: null, alpha: 1, transparent: false, approximate: false };
      }
    }

    const [r, g, b, alpha] = channels;
    if (alpha <= 0) return { hex: null, alpha: 0, transparent: true, approximate };
    const pair = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    const hex = `#${pair(r)}${pair(g)}${pair(b)}${alpha < 1 ? pair(alpha * 255) : ''}`.toUpperCase();
    return { hex, alpha: round(alpha), transparent: false, approximate };
  }

  function collectColors(element, style) {
    const colors = [];
    const add = (role, value) => colors.push({ role, value, ...parseColor(value) });

    add('Text', style.color);
    add('Background', style.backgroundColor);

    const borders = new Set();
    for (const side of SIDES) {
      if (parseFloat(style[`border-${side}-width`]) > 0 && style[`border-${side}-style`] !== 'none') {
        borders.add(style[`border-${side}-color`]);
      }
    }
    for (const value of borders) add('Border', value);

    if (element instanceof SVGElement) {
      if (style.fill && style.fill !== 'none') add('Fill', style.fill);
      if (style.stroke && style.stroke !== 'none') add('Stroke', style.stroke);
    }

    // A few colors used inside the element. The scan is capped: it never walks a whole page.
    const seen = new Set(colors.map((color) => color.value));
    const inside = element.querySelectorAll('*');
    let found = 0;
    for (let i = 0; i < inside.length && i < INNER_COLOR_SCAN && found < INNER_COLOR_MAX; i++) {
      const inner = getComputedStyle(inside[i]);
      for (const value of [inner.color, inner.backgroundColor]) {
        if (seen.has(value) || found >= INNER_COLOR_MAX) continue;
        seen.add(value);
        const parsed = parseColor(value);
        if (parsed.transparent || !parsed.hex) continue;
        colors.push({ role: 'Inside', value, ...parsed });
        found++;
      }
    }
    return colors;
  }

  // Everything Trace knows about an element. No text content, no attribute values,
  // no form values: only structure, geometry and computed styles.
  function collect(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const sides = (prefix, suffix = '') =>
      Object.fromEntries(SIDES.map((side) => [side, px(style[`${prefix}-${side}${suffix}`])]));

    const path = [];
    for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      path.unshift(node);
    }
    state.crumbs = path.slice(-6);

    const padding = sides('padding');
    const border = sides('border', '-width');

    return {
      tag: element.localName,
      id: element.id || null,
      classes: classesOf(element),
      selector: buildSelector(element),
      inShadowDom: element.getRootNode() !== document,
      hierarchy: path.map(describe),
      parent: element.parentElement ? describe(element.parentElement) : null,
      childElements: element.childElementCount,
      box: {
        width: round(rect.width),
        height: round(rect.height),
        viewportX: round(rect.left),
        viewportY: round(rect.top),
        // Size of the content area, once padding and borders are taken away.
        contentWidth: round(Math.max(0, rect.width - padding.left - padding.right - border.left - border.right)),
        contentHeight: round(Math.max(0, rect.height - padding.top - padding.bottom - border.top - border.bottom)),
        padding,
        border,
        margin: sides('margin'),
      },
      computedStyles: Object.fromEntries(COMPUTED.map((name) => [name, style.getPropertyValue(name)])),
      colors: collectColors(element, style),
      page: location.origin,
    };
  }

  // -------------------------------------------------------------------------
  // Interface
  // -------------------------------------------------------------------------

  function buildInterface() {
    host = make('div');
    host.id = HOST_ID;
    // Inline and !important so page stylesheets cannot move or hide the host.
    host.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important; pointer-events: none !important;';

    const root = host.attachShadow({ mode: 'closed' });
    const css = typeof globalThis.__traceInspectorCss === 'string' ? globalThis.__traceInspectorCss : '';
    try {
      // A constructed stylesheet is not affected by the page's Content Security Policy.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    } catch {
      root.append(make('style', '', css));
    }

    const overlay = make('div', 'overlay');
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerleave', () => setHovered(null));
    overlay.addEventListener('click', onPick);
    overlay.addEventListener('contextmenu', (event) => event.preventDefault());

    const hover = make('div', 'box box--hover');
    const hoverLabel = make('div', 'label');
    const select = make('div', 'box box--select');

    const bar = make('div', 'bar');
    const barText = make('span', 'bar__text', 'Click an element to inspect it');
    const key = make('kbd', '', 'Esc');
    bar.append(make('span', 'mark'), make('strong', '', 'Trace'), barText, key, button('Cancel', 'btn', stop));

    const panel = make('section', 'panel');
    panel.setAttribute('aria-label', 'Trace inspection panel');
    const toast = make('div', 'toast');
    toast.setAttribute('role', 'status');

    const clip = make('textarea', 'clip');
    clip.setAttribute('aria-hidden', 'true');
    clip.tabIndex = -1;

    root.append(overlay, hover, hoverLabel, select, bar, panel, toast, clip);
    ui = { root, overlay, hover, hoverLabel, select, bar, barText, panel, toast, clip };
  }

  function show(node, visible) {
    node.classList.toggle('is-on', visible);
  }

  function placeBox(box, rect) {
    box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  // Looks under the overlay, and inside open shadow roots, for the real element.
  function elementAt(x, y) {
    let found = null;
    for (const candidate of document.elementsFromPoint(x, y)) {
      if (candidate !== host) {
        found = candidate;
        break;
      }
    }
    for (let depth = 0; found?.shadowRoot && depth < 10; depth++) {
      const inner = found.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === found || !found.shadowRoot.contains(inner)) break;
      found = inner;
    }
    return found;
  }

  function setHovered(element) {
    if (state.hovered === element) return;
    state.hovered = element;
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(drawHover);
  }

  function drawHover() {
    const element = state.hovered;
    const visible = state.mode === 'picking' && Boolean(element?.isConnected);
    show(ui.hover, visible);
    show(ui.hoverLabel, visible);
    if (!visible) return;

    const rect = element.getBoundingClientRect();
    placeBox(ui.hover, rect);
    ui.hoverLabel.textContent = isSensitive(element)
      ? 'Password fields are not inspected'
      : `${describe(element)}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`;

    // The label sits above the element, or just inside it when there is no room above.
    const labelHeight = 24;
    const top = rect.top >= labelHeight + 4 ? rect.top - labelHeight - 2 : Math.min(window.innerHeight - labelHeight, Math.max(0, rect.top) + 2);
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - ui.hoverLabel.offsetWidth - 4));
    ui.hoverLabel.style.transform = `translate(${left}px, ${top}px)`;
  }

  // Keeps the outline on the selected element when the page scrolls or changes.
  function drawSelection() {
    const element = state.selected;
    if (state.mode !== 'selected' || !element) return;
    if (!element.isConnected) {
      show(ui.select, false);
      ui.panel.classList.add('is-stale');
      return;
    }
    show(ui.select, true);
    placeBox(ui.select, element.getBoundingClientRect());
  }

  function toast(message, isError = false) {
    clearTimeout(state.toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.toggle('is-error', isError);
    show(ui.toast, true);
    state.toastTimer = setTimeout(() => show(ui.toast, false), 1800);
  }

  // Writing to the clipboard needs no permission when it follows a click.
  async function copy(text, label) {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      toast(`${label} copied`);
    } catch {
      // Pages served over plain http have no clipboard API: fall back to a hidden text field.
      try {
        ui.clip.value = text;
        ui.clip.select();
        if (!document.execCommand('copy')) throw new Error('copy rejected');
        toast(`${label} copied`);
      } catch {
        toast('Copy failed: the page blocked clipboard access', true);
      } finally {
        ui.clip.value = '';
      }
    }
  }

  // -------------------------------------------------------------------------
  // Panel
  // -------------------------------------------------------------------------

  function section(title, note) {
    const node = make('div', 'section');
    const heading = make('h3', '', title);
    if (note) heading.append(make('span', '', note));
    node.append(heading);
    return node;
  }

  function row(name, value, className) {
    const node = make('div', 'row');
    node.append(make('span', 'row__name', name), make('span', `row__value ${className || ''}`, value));
    return node;
  }

  // The four values of one layer of the box model, around the next layer.
  function boxLayer(name, values, inner) {
    const layer = make('div', `model model--${name}`);
    layer.append(
      make('span', 'model__name', name),
      make('span', 'model__top', String(values.top)),
      make('span', 'model__left', String(values.left)),
      inner,
      make('span', 'model__right', String(values.right)),
      make('span', 'model__bottom', String(values.bottom))
    );
    return layer;
  }

  function renderPanel() {
    const data = state.data;
    const panel = ui.panel;
    panel.replaceChildren();
    panel.classList.remove('is-stale');
    panel.dataset.dock = state.dock;

    // Header
    const header = make('header', 'panel__head');
    const title = make('div', 'panel__title');
    title.append(make('span', 'mark'), make('code', 'tag', `<${data.tag}>`));
    if (data.id) title.append(make('code', 'muted', `#${data.id}`));
    const tools = make('div', 'panel__tools');
    tools.append(
      button('Inspect again', 'btn btn--accent', start, 'Pick another element'),
      button('⇆', 'btn btn--icon', toggleDock, 'Move the panel to the other side'),
      button('✕', 'btn btn--icon', stop, 'Close Trace (Esc)')
    );
    header.append(title, tools);

    const stale = make('p', 'stale', 'This element is no longer in the page. Pick another one.');

    // Identity
    const identity = section('Element');
    identity.append(row('Tag', data.tag, 'mono'), row('ID', data.id || 'none', data.id ? 'mono' : 'empty'));
    const classRow = make('div', 'row');
    const chips = make('span', 'row__value chips');
    if (data.classes.length) data.classes.forEach((name) => chips.append(make('code', 'chip', `.${name}`)));
    else chips.append(make('span', 'empty', 'none'));
    classRow.append(make('span', 'row__name', 'Classes'), chips);
    identity.append(classRow);

    const selector = make('div', 'selector');
    selector.append(make('code', '', data.selector.value));
    const matches = data.selector.matches;
    selector.append(
      make(
        'span',
        matches === 1 ? 'hint' : 'hint hint--warn',
        matches === 1
          ? `Matches 1 element ${data.inShadowDom ? 'inside its shadow root' : 'on this page'} right now.`
          : matches > 1
            ? `Matches ${matches} elements: not unique.`
            : 'Could not be checked on this page.'
      )
    );
    identity.append(make('span', 'row__name', 'Selector'), selector);
    identity.append(row('Parent', data.parent || 'none (document root)', data.parent ? 'mono' : 'empty'));
    identity.append(row('Children', `${data.childElements} element${data.childElements === 1 ? '' : 's'}`));

    const crumbs = make('div', 'crumbs');
    if (data.hierarchy.length > state.crumbs.length) crumbs.append(make('span', 'crumbs__gap', '…'));
    state.crumbs.forEach((element, index) => {
      const current = index === state.crumbs.length - 1;
      const crumb = button(describe(element), `crumb ${current ? 'is-current' : ''}`, () => {
        if (!current && element.isConnected) select(element);
      });
      crumb.disabled = current;
      if (!current) crumb.title = 'Inspect this ancestor';
      crumbs.append(crumb);
    });
    identity.append(make('span', 'row__name', 'Hierarchy'), crumbs);

    // Box
    const box = section('Box', 'px');
    const content = make('div', 'model model--content', `${data.box.contentWidth} × ${data.box.contentHeight}`);
    box.append(
      boxLayer('margin', data.box.margin, boxLayer('border', data.box.border, boxLayer('padding', data.box.padding, content))),
      row('Size (with border)', `${data.box.width} × ${data.box.height}`, 'mono'),
      row('Viewport position', `x ${data.box.viewportX}, y ${data.box.viewportY}`, 'mono')
    );

    // Computed styles
    const styles = section('Computed styles', 'final values, not the original CSS rules');
    for (const [name, value] of Object.entries(data.computedStyles)) styles.append(row(name, value || 'none', 'mono'));

    // Colors
    const colors = section('Colors');
    const swatches = make('div', 'swatches');
    for (const color of data.colors) {
      const label = color.transparent ? 'transparent' : color.hex || color.value;
      const swatch = button('', 'swatch', () => copy(color.hex || color.value, color.transparent ? 'Value' : 'Color'));
      swatch.title = color.transparent
        ? `${color.role}: fully transparent (${color.value})`
        : `${color.role}: ${color.value}${color.approximate ? ' (converted to sRGB, approximate)' : ''}. Click to copy.`;
      const chip = make('span', `swatch__chip ${color.transparent ? 'is-transparent' : ''}`);
      if (!color.transparent) chip.style.setProperty('--color', color.value);
      const info = make('span', 'swatch__info');
      info.append(make('span', 'swatch__role', color.role), make('code', '', `${color.approximate && color.hex ? '≈ ' : ''}${label}`));
      swatch.append(chip, info);
      swatches.append(swatch);
    }
    colors.append(swatches);

    // Copy actions
    const actions = section('Copy');
    const grid = make('div', 'actions');
    const summary =
      `/* ${describe(state.selected)}: computed styles (final values, not the original CSS rules) */\n` +
      Object.entries(data.computedStyles)
        .map(([name, value]) => `${name}: ${value};`)
        .join('\n');
    grid.append(
      button('Selector', 'btn', () => copy(data.selector.value, 'Selector')),
      button('Classes', 'btn', () =>
        data.classes.length ? copy(data.classes.join(' '), 'Classes') : toast('This element has no classes', true)
      ),
      button('Tag', 'btn', () => copy(data.tag, 'Tag')),
      button('Styles', 'btn', () => copy(summary, 'Style summary')),
      button('JSON', 'btn', () => copy(JSON.stringify(data, null, 2), 'JSON'))
    );
    actions.append(grid);

    const body = make('div', 'panel__body');
    body.append(stale, identity, box, styles, colors, actions);
    panel.append(header, body);
  }

  function toggleDock() {
    state.dock = state.dock === 'right' ? 'left' : 'right';
    ui.panel.dataset.dock = state.dock;
  }

  // -------------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------------

  function onPointerMove(event) {
    setHovered(elementAt(event.clientX, event.clientY));
  }

  function onPick(event) {
    event.preventDefault();
    const element = elementAt(event.clientX, event.clientY);
    if (!element) return;
    if (isSensitive(element)) {
      ui.barText.textContent = 'Password fields are not inspected. Pick another element.';
      return;
    }
    select(element);
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || state.mode === 'idle') return;
    event.preventDefault();
    event.stopPropagation();
    stop();
  }

  function onViewportChange() {
    if (state.mode === 'picking') drawHover();
    else drawSelection();
  }

  function attach() {
    if (!host) buildInterface();
    if (!host.isConnected) document.documentElement.append(host);
    // Registering the same function twice is a no-op, so repeated starts never stack listeners.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', onViewportChange, { passive: true });
  }

  function start() {
    attach();
    clearInterval(state.timer);
    state.mode = 'picking';
    state.hovered = null;
    state.selected = null;
    ui.barText.textContent = 'Click an element to inspect it';
    show(ui.overlay, true);
    show(ui.bar, true);
    show(ui.panel, false);
    show(ui.select, false);
    show(ui.hover, false);
    show(ui.hoverLabel, false);
  }

  function select(element) {
    attach();
    state.mode = 'selected';
    state.selected = element;
    state.last = new WeakRef(element);
    state.hovered = null;
    state.data = collect(element);

    // The panel moves aside when it would cover the element.
    const rect = element.getBoundingClientRect();
    if (rect.left > window.innerWidth - 440) state.dock = 'left';
    else if (rect.right < 440) state.dock = 'right';

    show(ui.overlay, false);
    show(ui.bar, false);
    show(ui.hover, false);
    show(ui.hoverLabel, false);
    renderPanel();
    show(ui.panel, true);
    drawSelection();

    // Pages can move things without scrolling: check the outline a few times per second.
    clearInterval(state.timer);
    state.timer = setInterval(drawSelection, 350);
    save();
  }

  // Ends inspection completely: no listener, no timer and no element left in the page.
  function stop() {
    clearInterval(state.timer);
    clearTimeout(state.toastTimer);
    cancelAnimationFrame(state.frame);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onViewportChange, { capture: true });
    window.removeEventListener('resize', onViewportChange);
    state.mode = 'idle';
    state.hovered = null;
    state.selected = null;
    if (host) host.remove();
  }

  function reopen() {
    const element = state.last?.deref();
    if (!element?.isConnected) return false;
    select(element);
    return true;
  }

  // Sends the minimal history entry to the service worker, which validates and stores it.
  function save() {
    const data = state.data;
    try {
      chrome.runtime
        .sendMessage({
          type: 'trace:save',
          entry: {
            tag: data.tag,
            elementId: data.id || '',
            classes: data.classes,
            selector: data.selector.value,
            width: data.box.width,
            height: data.box.height,
            styles: Object.fromEntries(SAVED_STYLES.map((name) => [name, data.computedStyles[name]])),
          },
        })
        .catch(() => {});
    } catch {
      // The extension was reloaded or removed while this page stayed open.
    }
  }

  // Messages from the popup.
  function onMessage(message, sender, sendResponse) {
    if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'trace:ping':
        sendResponse({ ok: true, mode: state.mode, canReopen: Boolean(state.last?.deref()?.isConnected) });
        break;
      case 'trace:stop':
        stop();
        sendResponse({ ok: true });
        break;
      case 'trace:reopen':
        sendResponse({ ok: reopen() });
        break;
    }
  }

  globalThis[KEY] = { start, stop };
  chrome.runtime.onMessage.addListener(onMessage);
  start();
})();
