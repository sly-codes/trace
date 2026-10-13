// Shows one of the Markdown documents shipped with the extension.
// Only a small part of Markdown is handled: headings, lists, paragraphs,
// code blocks and tables (shown as plain text), with bold, code and links inline.

const ALLOWED = ['README.md', 'PRIVACY.md'];

// Splits a line into text, **bold**, `code` and [links](url) nodes.
function inline(parent, text) {
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) {
      parent.append(Object.assign(document.createElement('strong'), { textContent: match[1] }));
    } else if (match[2] !== undefined) {
      parent.append(Object.assign(document.createElement('code'), { textContent: match[2] }));
    } else {
      const link = Object.assign(document.createElement('a'), { textContent: match[3] });
      const href = match[4];
      if (/^https:\/\//.test(href)) {
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else if (ALLOWED.includes(href)) {
        link.href = `doc.html?file=${href}`;
      }
      parent.append(link);
    }
  }
  parent.append(text.slice(cursor));
}

function render(markdown) {
  const content = document.getElementById('content');
  content.replaceChildren();
  const lines = markdown.replace(/\r/g, '').split('\n');
  let list = null;
  let inCode = false;
  let code = [];
  let table = [];

  const pre = (rows) => content.append(Object.assign(document.createElement('pre'), { textContent: rows.join('\n') }));
  const flushTable = () => {
    if (table.length) pre(table);
    table = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      flushTable();
      if (inCode) pre(code);
      code = [];
      inCode = !inCode;
      list = null;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (line.startsWith('|')) {
      // The separator row of a table (| --- | --- |) is dropped.
      if (!/^\|[\s|:-]+\|$/.test(line)) table.push(line.replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, '   '));
      list = null;
      continue;
    }
    flushTable();
    if (line.startsWith('![')) continue; // images (badges) are not shown

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (heading) {
      const node = document.createElement(`h${heading[1].length}`);
      inline(node, heading[2]);
      content.append(node);
      list = null;
    } else if (item) {
      if (!list) {
        list = document.createElement(/^\s*\d+\./.test(line) ? 'ol' : 'ul');
        content.append(list);
      }
      const node = document.createElement('li');
      inline(node, item[2]);
      list.append(node);
    } else if (line.trim()) {
      const node = document.createElement('p');
      inline(node, line.trim());
      content.append(node);
      list = null;
    } else {
      list = null;
    }
  }
  flushTable();
}

const file = new URLSearchParams(location.search).get('file');
if (ALLOWED.includes(file)) {
  document.title = `Trace · ${file === 'PRIVACY.md' ? 'Privacy policy' : 'Read me'}`;
  fetch(file)
    .then((response) => response.text())
    .then(render)
    .catch(() => {
      document.getElementById('content').textContent = 'This document could not be loaded.';
    });
} else {
  document.getElementById('content').textContent = 'Unknown document.';
}
