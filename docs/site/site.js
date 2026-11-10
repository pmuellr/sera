// @ts-check

// Shared code for the pages: the menu at the top of each page (built from
// SITE_PAGES in pages.js), settings, data input (paste, drop, or file upload),
// JSON parsing, DOM building, tables, statistics, and formatting.
//
// Pages load it with <script src>, after pages.js.  Plain scripts rather than
// ES modules are used so the pages also work when opened from file: URLs.

'use strict';

// types used by the pages, outside the function so they're global

/** @typedef {Node | string | number | null | undefined | false | Child[]} Child */

/**
 * A finding of an analysis.
 * @typedef {{ level: 'error' | 'warn' | 'info'; message: Child }} Finding
 */

/**
 * A table column.
 * @template T
 * @typedef {{
 *   label: string;
 *   value: (row: T) => unknown;
 *   render?: (row: T) => Child;
 *   numeric?: boolean;
 *   title?: string;
 *   cellClass?: (row: T) => string | undefined;
 * }} Column
 */

/**
 * Statistics of a list of numbers.
 * @typedef {{ count: number; min: number; max: number; sum: number; avg: number;
 *   p50: number; p90: number; p95: number; p99: number }} Stats
 */

/**
 * A sera data file, as written by scripts/sera-download: the response for
 * each page, as the property named by the page's id, like `rules` or
 * `task-manager-health`, and a `meta` property describing the file: when the
 * data was downloaded, from which Kibana and Elasticsearch URLs, and the
 * errors of the requests that failed, by page id.
 * @typedef {{
 *   format: 'sera-data';
 *   version: number;
 *   timestamp?: string;
 *   kibanaUrl?: string;
 *   elasticsearchUrl?: string;
 *   errors?: Record<string, string>;
 * }} DataFileMeta
 * @typedef {{ meta: DataFileMeta; [pageId: string]: unknown }} DataFile
 */

/** @typedef {import('../vendor/discover-url.js').DiscoverUrlParams} DiscoverUrlParams */
/** @typedef {import('../vendor/discover-url.js').FilterParam} FilterParam */

const Site = (function () {

// site.js is in docs/site/, so the site root is its parent directory
const ROOT_URL = new URL('..', /** @type {HTMLScriptElement} */ (document.currentScript).src).href;

const SETTINGS_KEY = 'sera.settings';
const SETTINGS_EVENT = 'sera-settings-changed';
const INPUT_KEY_PREFIX = 'sera.input.';
const DATA_FILE_FORMAT = 'sera-data';
const COLLAPSED_KEY = 'sera.collapsed';
const TAGS_KEY = 'sera.tags';
const RECENT_TAGS_KEY = 'sera.tags.recent';
const MAX_RECENT_TAGS = 10;
const KNOWN_TAGS_KEY = 'sera.tags.known';
const TAGS_EVENT = 'sera-tags-changed';
const SPACES_KEY = 'sera.spaces';

// textareas get slow with very large values, so larger input isn't shown in them
const MAX_TEXTAREA_LENGTH = 2 * 1024 * 1024;

/** @typedef {{ kibanaUrl: string; eventLogDataView: string }} Settings */

/** @type {Settings} */
const DEFAULT_SETTINGS = {
  kibanaUrl: 'http://localhost:5601',
  eventLogDataView: '.kibana-event-log-ds',
};

document.addEventListener('DOMContentLoaded', renderHeader);

// ---------------------------------------------------------------------------
// menu
// ---------------------------------------------------------------------------

/** @type {(id: string) => string} */
function pageUrl(id) {
  return new URL(`${id}/index.html`, ROOT_URL).href;
}

/** @type {() => string} */
function homeUrl() {
  return new URL('index.html', ROOT_URL).href;
}

/** @type {(url: string) => string} */
function normalizeUrl(url) {
  const result = new URL(url);
  result.hash = '';
  result.search = '';
  if (result.pathname.endsWith('/')) result.pathname += 'index.html';
  return result.href;
}

function renderHeader() {
  const current = normalizeUrl(location.href);

  const links = SITE_PAGES.map(function (page) {
    const href = pageUrl(page.id);
    const className = normalizeUrl(href) === current ? 'current' : '';
    return h('a', { href, class: className, title: page.description }, page.title);
  });

  const header = h('header', { class: 'site-header' },
    h('a', { class: 'site-name', href: homeUrl(), title: 'sera - static elasticsearch resource analysis: all pages' }, 'sera'),
    h('nav', { class: 'site-nav' }, links),
    renderSettings(),
  );

  document.body.prepend(header);
}

/** @type {() => HTMLElement} */
function renderSettings() {
  const settings = getSettings();

  /** @type {(key: keyof Settings, label: string, help: string) => HTMLElement} */
  function field(key, label, help) {
    const input = h('input', {
      type: 'text',
      value: settings[key],
      placeholder: DEFAULT_SETTINGS[key],
      spellcheck: 'false',
      onchange: function () {
        setSettings({ ...getSettings(), [key]: input.value.trim() || DEFAULT_SETTINGS[key] });
      },
    });
    return h('label', {}, h('span', {}, label), input, h('small', {}, help));
  }

  return h('details', { class: 'site-settings' },
    h('summary', {}, 'settings'),
    h('div', { class: 'site-settings-panel' },
      field('kibanaUrl', 'Kibana URL', 'base URL of the Kibana used for Discover links, including any base path'),
      field('eventLogDataView', 'event log data view', 'id of a data view for .kibana-event-log-*'),    ),
  );
}

// ---------------------------------------------------------------------------
// settings, saved in localStorage
// ---------------------------------------------------------------------------

/** @type {() => Settings} */
function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** @type {(settings: Settings) => void} */
function setSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('unable to save settings:', err);
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
}

/** @type {(fn: (settings: Settings) => void) => void} */
function onSettingsChange(fn) {
  window.addEventListener(SETTINGS_EVENT, function () { fn(getSettings()); });
}

// ---------------------------------------------------------------------------
// the rule tags and spaces filters, shared by the pages, saved in localStorage
// ---------------------------------------------------------------------------

/** @type {(key: string) => any} */
function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

/** @type {(key: string, value: unknown) => void} */
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not saved, in private browsing
  }
}

/** @type {() => string[]} */
function selectedTags() {
  const tags = readJson(TAGS_KEY);
  return Array.isArray(tags) ? tags.map(String) : [];
}

/** @type {(tags: string[]) => void} */
function setSelectedTags(tags) {
  const added = tags.filter(function (tag) { return !selectedTags().includes(tag); });
  writeJson(TAGS_KEY, tags);
  if (added.length > 0) {
    writeJson(RECENT_TAGS_KEY, [...added, ...recentTags().filter(function (tag) { return !added.includes(tag); })]
      .slice(0, MAX_RECENT_TAGS));
  }
  window.dispatchEvent(new CustomEvent(TAGS_EVENT));
}

/**
 * The tags selected most recently, most recent first.
 * @type {() => string[]}
 */
function recentTags() {
  const tags = readJson(RECENT_TAGS_KEY);
  return Array.isArray(tags) ? tags.map(String) : [];
}

function clearRecentTags() {
  writeJson(RECENT_TAGS_KEY, []);
  window.dispatchEvent(new CustomEvent(TAGS_EVENT));
}

/**
 * Call `fn` when the selected tags or spaces change, on this page or in
 * another tab.
 * @type {(fn: () => void) => void}
 */
function onTagsChange(fn) {
  window.addEventListener(TAGS_EVENT, fn);
  window.addEventListener('storage', function (event) { if (event.key === TAGS_KEY || event.key === SPACES_KEY) fn(); });
}

/** @type {() => string[]} */
function selectedSpaces() {
  const spaces = readJson(SPACES_KEY);
  return Array.isArray(spaces) ? spaces.map(String) : [];
}

/** @type {(spaces: string[]) => void} */
function setSelectedSpaces(spaces) {
  writeJson(SPACES_KEY, spaces);
  window.dispatchEvent(new CustomEvent(TAGS_EVENT));
}

/**
 * Whether something in the spaces is in a selected space.  What isn't in a
 * space, like preconfigured connectors, or is in every space, `*`, is in all
 * of them.
 * @type {(spaces: string[], selected?: string[]) => boolean}
 */
function inSelectedSpaces(spaces, selected = selectedSpaces()) {
  if (selected.length === 0 || spaces.length === 0 || spaces.includes('*')) return true;
  return spaces.some(function (space) { return selected.includes(space); });
}

/**
 * Whether any rule tags or spaces are selected, so the pages are filtered.
 * @type {() => boolean}
 */
function isFiltered() {
  return selectedTags().length > 0 || selectedSpaces().length > 0;
}

/**
 * Remember the tags in a page's data, so the other pages offer them too.
 * @type {(source: string, tags: string[]) => void}
 */
function rememberTags(source, tags) {
  const known = readJson(KNOWN_TAGS_KEY) || {};
  known[source] = [...new Set(tags)].sort();
  writeJson(KNOWN_TAGS_KEY, known);
}

/** @type {() => string[]} */
function knownTags() {
  const known = readJson(KNOWN_TAGS_KEY) || {};
  return Object.values(known).flat().map(String);
}

/**
 * Whether the tags include every selected tag.
 * @type {(tags: string[], selected?: string[]) => boolean}
 */
function hasSelectedTags(tags, selected = selectedTags()) {
  return selected.every(function (tag) { return tags.includes(tag); });
}

/**
 * The state of the filter dropdowns, kept while the page re-renders them
 * after each change to the selection: which one is open, and the search and
 * scroll position of each.
 * @type {{ open: string | undefined; query: Record<string, string>; scrollTop: Record<string, number> }}
 */
const filterMenu = { open: undefined, query: {}, scrollTop: {} };

document.addEventListener('click', function (event) {
  const target = /** @type {Element | null} */ (event.target);
  if (filterMenu.open && !target?.closest?.('.tag-dropdown')) closeFilterMenus();
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && filterMenu.open) closeFilterMenus();
});

function closeFilterMenus() {
  filterMenu.open = undefined;
  for (const menu of document.querySelectorAll('details.tag-dropdown')) menu.removeAttribute('open');
}

/**
 * The rule tags and spaces filters, and a note describing what's shown.
 * The tags are those given, the ones other pages remembered, and the
 * selected and recently selected ones, which are listed first; what's shown
 * must have all the selected tags.  What's shown must be in one of the
 * selected spaces.  The spaces filter is left out when there are no spaces.
 * @type {(tags: string[], note?: Child, spaces?: string[]) => HTMLElement | undefined}
 */
function tagFilter(tags, note, spaces = []) {
  const selected = selectedTags();
  const recent = [...new Set([...recentTags(), ...selected])];
  const others = [...new Set([...tags, ...knownTags()])]
    .filter(function (tag) { return !recent.includes(tag); })
    .sort(function (a, b) { return a.localeCompare(b); });

  const spacesSelected = selectedSpaces();
  const allSpaces = [...new Set([...spaces, ...spacesSelected])]
    .filter(function (space) { return space !== '*'; })
    .sort(function (a, b) { return a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b); });

  const tagMenu = recent.length + others.length === 0 ? undefined : checkDropdown({
    id: 'tags',
    label: 'rule tags',
    noun: 'tags',
    groups: [
      { heading: 'recent', items: recent },
      { heading: recent.length > 0 ? 'all tags' : undefined, items: others },
    ],
    selected,
    summary: selected.length <= 2 ? selected.join(' and ') : `${formatNumber(selected.length)} tags`,
    footer: 'shows what has all the selected tags',
    onChange: setSelectedTags,
    extra: recentTags().length > 0 && h('button', { type: 'button', class: 'tag-clear', onclick: clearRecentTags }, 'clear history'),
  });
  const spaceMenu = allSpaces.length === 0 ? undefined : checkDropdown({
    id: 'spaces',
    label: 'spaces',
    noun: 'spaces',
    groups: [{ heading: undefined, items: allSpaces }],
    selected: spacesSelected,
    summary: spacesSelected.length <= 2 ? spacesSelected.join(' or ') : `${formatNumber(spacesSelected.length)} spaces`,
    footer: 'shows what is in any of the selected spaces',
    onChange: setSelectedSpaces,
  });
  if (!tagMenu && !spaceMenu) return undefined;

  return h('div', { class: 'tag-filter' },
    tagMenu,
    spaceMenu,
    (selected.length > 0 || spacesSelected.length > 0) && h('button', {
      type: 'button',
      class: 'tag-clear',
      onclick: function () {
        writeJson(SPACES_KEY, []);
        setSelectedTags([]);
      },
    }, 'clear'),
    note && h('span', { class: 'muted tag-filter-note' }, note),
  );
}

/**
 * A dropdown of checkboxes, with a search, for a filter.
 * @type {(options: {
 *   id: string;
 *   label: string;
 *   noun: string;
 *   groups: { heading: string | undefined; items: string[] }[];
 *   selected: string[];
 *   summary: string;
 *   footer: string;
 *   onChange: (selected: string[]) => void;
 *   extra?: Child;
 * }) => HTMLElement}
 */
function checkDropdown({ id, label, noun, groups, selected, summary, footer, onChange, extra }) {
  const count = groups.reduce(function (sum, group) { return sum + group.items.length; }, 0);
  const search = h('input', {
    type: 'search',
    placeholder: `search ${formatNumber(count)} ${noun}`,
    value: filterMenu.query[id] ?? '',
    oninput: function () {
      filterMenu.query[id] = search.value;
      applySearch();
    },
  });
  const options = h('div', { class: 'tag-options' },
    groups.filter(function (group) { return group.items.length > 0; }).map(optionGroup));
  const empty = h('div', { class: 'muted tag-none' }, `no matching ${noun}`);
  applySearch();

  const isOpen = filterMenu.open === id;
  const menu = h('details', { class: 'tag-dropdown', open: isOpen },
    h('summary', { title: selected.join(', ') },
      h('span', { class: 'muted' }, `${label}: `),
      selected.length === 0 ? 'any' : summary),
    h('div', { class: 'tag-menu' },
      search,
      options,
      empty,
      h('div', { class: 'tag-menu-footer' }, h('span', { class: 'muted' }, footer), extra),
    ),
  );
  menu.addEventListener('toggle', function () {
    if (menu.open) {
      for (const other of document.querySelectorAll('details.tag-dropdown')) {
        if (other !== menu) other.removeAttribute('open');
      }
      filterMenu.open = id;
      search.focus();
    } else if (filterMenu.open === id) {
      filterMenu.open = undefined;
    }
  });
  if (isOpen) {
    requestAnimationFrame(function () {
      options.scrollTop = filterMenu.scrollTop[id] ?? 0;
    });
  }
  return menu;

  /** @type {(group: { heading: string | undefined; items: string[] }) => HTMLElement} */
  function optionGroup(group) {
    return h('div', { class: 'tag-group' },
      group.heading && h('div', { class: 'tag-group-heading' }, group.heading),
      group.items.map(function (item) {
        const isSelected = selected.includes(item);
        return h('label', { class: `tag-option${isSelected ? ' selected' : ''}`, 'data-tag': item.toLowerCase() },
          h('input', {
            type: 'checkbox',
            checked: isSelected,
            onchange: function () {
              filterMenu.scrollTop[id] = options.scrollTop;
              onChange(isSelected ? selected.filter(function (other) { return other !== item; }) : [...selected, item]);
            },
          }),
          ' ', item);
      }));
  }

  function applySearch() {
    const query = (filterMenu.query[id] ?? '').trim().toLowerCase();
    let shown = 0;
    for (const group of /** @type {HTMLElement[]} */ ([...options.children])) {
      let groupShown = 0;
      for (const option of /** @type {HTMLElement[]} */ ([...group.querySelectorAll('.tag-option')])) {
        const matches = query === '' || String(option.dataset.tag).includes(query);
        option.hidden = !matches;
        if (matches) groupShown++;
      }
      group.hidden = groupShown === 0;
      shown += groupShown;
    }
    empty.hidden = shown > 0;
  }
}

// ---------------------------------------------------------------------------
// data input: paste, drag and drop, or file upload
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   storageKey?: string;
 *   placeholder?: string;
 *   onData: (text: string, source: string) => void;
 *   onFiles?: (files: { name: string; text: string }[]) => void;
 * }} InputPanelOptions
 */

/**
 * Create the data input panel.  Files dropped anywhere on the page are read.
 * With a storageKey, the last input is saved in sessionStorage, and
 * re-analyzed when the page is reloaded or revisited from the menu.  Errors
 * thrown by onData are shown in the panel.  With onFiles, loaded and dropped
 * files are passed to it separately, instead of to onData together.
 * @type {(options: InputPanelOptions) => HTMLElement}
 */
function inputPanel({ storageKey, placeholder, onData, onFiles }) {
  const key = storageKey && INPUT_KEY_PREFIX + storageKey;

  const textarea = h('textarea', {
    placeholder: placeholder || 'paste JSON here, drop a file on the page, or load a file',
    spellcheck: 'false',
    onpaste: function () {
      // the textarea's value isn't updated until after the paste event
      setTimeout(function () { analyze(textarea.value, 'pasted text'); }, 0);
    },
  });
  const fileInput = h('input', {
    type: 'file',
    multiple: true,
    onchange: function () {
      if (fileInput.files) readFiles(fileInput.files);
      fileInput.value = '';
    },
  });
  const status = h('div', { class: 'input-status' });

  const panel = h('div', { class: 'input-panel' },
    textarea,
    h('div', { class: 'input-buttons' },
      h('button', { onclick: function () { analyze(textarea.value, 'pasted text'); } }, 'analyze'),
      h('button', { onclick: function () { fileInput.click(); } }, 'load file'),
      h('button', { onclick: clear }, 'clear'),
      status,
    ),
    fileInput,
  );

  document.addEventListener('dragover', function (event) {
    event.preventDefault();
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', function (event) {
    if (event.relatedTarget == null) document.body.classList.remove('dragging');
  });
  document.addEventListener('drop', function (event) {
    event.preventDefault();
    document.body.classList.remove('dragging');
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      readFiles(files);
    } else {
      const text = event.dataTransfer?.getData('text/plain');
      if (text) analyze(text, 'dropped text');
    }
  });

  setTimeout(restore, 0);
  return panel;

  /** @type {(files: FileList) => Promise<void>} */
  async function readFiles(files) {
    const list = Array.from(files);
    try {
      const texts = await Promise.all(list.map(function (file) { return file.text(); }));
      if (onFiles) {
        onFiles(list.map(function (file, index) { return { name: file.name, text: texts[index] }; }));
        showStatus(`read ${list.map(function (file) { return file.name; }).join(', ')}`, false);
        return;
      }
      analyze(texts.join('\n'), list.map(function (file) { return file.name; }).join(', '));
    } catch (err) {
      showStatus(`error reading file: ${errorMessage(err)}`, true);
    }
  }

  /** @type {(text: string, source: string) => void} */
  function analyze(text, source) {
    if (text.trim() === '') {
      showStatus('nothing to analyze', true);
      return;
    }

    if (text.length <= MAX_TEXTAREA_LENGTH) {
      textarea.value = text;
    } else {
      textarea.value = '';
      textarea.placeholder = `${source}: ${formatNumber(text.length)} characters, too large to show here`;
    }

    if (storageKey) saveInput(storageKey, text, source);

    try {
      onData(text, source);
      showStatus(`analyzed ${source}, ${formatNumber(text.length)} characters`, false);
    } catch (err) {
      console.error(err);
      showStatus(`error analyzing ${source}: ${errorMessage(err)}`, true);
    }
  }

  function restore() {
    if (!key) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved) analyze(saved.text, saved.source);
    } catch {
      sessionStorage.removeItem(key);
    }
  }

  function clear() {
    textarea.value = '';
    textarea.placeholder = placeholder || '';
    if (key) sessionStorage.removeItem(key);
    showStatus('', false);
    onData('', '');
  }

  /** @type {(message: string, isError: boolean) => void} */
  function showStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }
}

/**
 * A collapsible panel for a page's data input and what's loaded, whose
 * summary line says what's loaded.  It starts open when nothing is loaded,
 * and closed when something is; it opens again when the data is cleared.
 * Call `update(text, loaded)` whenever the data changes.
 * @type {(...children: Child[]) => { element: HTMLElement; update: (text: string, loaded: boolean) => void }}
 */
function dataPanel(...children) {
  const summaryText = h('span', { class: 'data-panel-summary' });
  const details = h('details', { class: 'data-panel' },
    h('summary', {}, h('span', { class: 'data-panel-title' }, 'data'), summaryText),
    h('div', { class: 'data-panel-body' }, children));
  /** @type {boolean | undefined} */
  let wasLoaded;

  return {
    element: details,
    update: function (text, loaded) {
      summaryText.textContent = text;
      if (wasLoaded === undefined) details.open = !loaded;
      else if (wasLoaded && !loaded) details.open = true;
      wasLoaded = loaded;
    },
  };
}

/**
 * Save the input for the page whose input panel has `storageKey`, in
 * sessionStorage, so it's analyzed when that page is opened in this tab.
 * Returns false if it's too large to save.
 * @type {(storageKey: string, text: string, source: string) => boolean}
 */
function saveInput(storageKey, text, source) {
  const key = INPUT_KEY_PREFIX + storageKey;
  try {
    sessionStorage.setItem(key, JSON.stringify({ text, source }));
    return true;
  } catch {
    sessionStorage.removeItem(key);
    return false;
  }
}

/** @type {(storageKey: string) => void} */
function removeInput(storageKey) {
  sessionStorage.removeItem(INPUT_KEY_PREFIX + storageKey);
}

/**
 * The input saved for the page whose input panel has `storageKey`.
 * @type {(storageKey: string) => { text: string; source: string } | undefined}
 */
function loadInput(storageKey) {
  try {
    const value = JSON.parse(sessionStorage.getItem(INPUT_KEY_PREFIX + storageKey) ?? 'null');
    return typeof value?.text === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// sera data files
// ---------------------------------------------------------------------------

/**
 * The sera data file in text, or undefined if it isn't one.
 * @type {(text: string) => DataFile | undefined}
 */
function parseDataFile(text) {
  if (!/^\s*\{/.test(text) || !text.includes(DATA_FILE_FORMAT)) return undefined;
  /** @type {any} */
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return value?.meta?.format === DATA_FILE_FORMAT ? value : undefined;
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

/**
 * Parse text containing one or more JSON values: a single JSON document,
 * NDJSON, or concatenated (possibly pretty-printed) JSON values, as copied
 * from Kibana Dev Tools.  Lines starting with `#` between values are ignored,
 * as are `GET` / `POST` request lines.
 * @type {(text: string) => unknown[]}
 */
function parseJsonValues(text) {
  try {
    return [JSON.parse(text)];
  } catch {
    // try multiple values next
  }

  /** @type {unknown[]} */
  const values = [];
  let index = 0;
  while (true) {
    index = skipNonJson(text, index);
    if (index >= text.length) break;

    const end = endOfValue(text, index);
    const source = text.slice(index, end);
    try {
      values.push(JSON.parse(source));
    } catch (err) {
      const line = text.slice(0, index).split('\n').length;
      throw new Error(`invalid JSON at line ${line}: ${errorMessage(err)}`);
    }
    index = end;
  }
  return values;
}

/**
 * Split the output of running several requests at once in Kibana Dev Tools
 * Console into each request's response.  Console puts a line like
 * `# GET kbn:/api/actions/connectors 200 OK` before each one.  Text without
 * those lines is returned as a single response, without a request.
 * @type {(text: string) => { request?: string; text: string }[]}
 */
function splitDevToolsOutput(text) {
  const pattern = /^#\s*(GET|POST|PUT|DELETE|HEAD|PATCH)\s+(\S+).*$/gm;
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return [{ text }];

  /** @type {{ request?: string; text: string }[]} */
  const parts = [];
  const before = text.slice(0, matches[0].index);
  if (before.trim() !== '') parts.push({ text: before });
  matches.forEach(function (match, i) {
    const start = /** @type {number} */ (match.index) + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    parts.push({ request: `${match[1]} ${match[2]}`, text: text.slice(start, end) });
  });
  return parts;
}

/** @type {(text: string, index: number) => number} */
function skipNonJson(text, index) {
  while (index < text.length) {
    const char = text[index];
    if (/\s|,/.test(char)) {
      index++;
    } else if (char === '#' || /^(GET|POST|PUT|DELETE|HEAD)\s/.test(text.slice(index, index + 7))) {
      const newline = text.indexOf('\n', index);
      index = newline === -1 ? text.length : newline + 1;
    } else {
      break;
    }
  }
  return index;
}

/** @type {(text: string, start: number) => number} */
function endOfValue(text, start) {
  const first = text[start];
  if (first !== '{' && first !== '[') {
    const newline = text.indexOf('\n', start);
    return newline === -1 ? text.length : newline;
  }

  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

/**
 * Get a property by dotted path, e.g. `event.provider`, from nested objects,
 * objects with dotted keys, or a mix of both.
 * @type {(object: unknown, path: string) => any}
 */
function get(object, path) {
  if (object == null || typeof object !== 'object') return undefined;
  const record = /** @type {Record<string, unknown>} */ (object);
  if (path in record) return record[path];

  const parts = path.split('.');
  for (let count = parts.length - 1; count > 0; count--) {
    const head = parts.slice(0, count).join('.');
    if (head in record) {
      const value = get(record[head], parts.slice(count).join('.'));
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// DOM building
// ---------------------------------------------------------------------------

/**
 * Create an element.  Attributes starting with `on` are event listeners,
 * other attributes with null, undefined, or false values are skipped.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [attrs]
 * @param {Child[]} children
 * @returns {HTMLElementTagNameMap[K]}
 */
function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2), value);
    } else if (name === 'value') {
      /** @type {any} */ (element).value = value;
    } else if (value === true) {
      element.setAttribute(name, '');
    } else {
      element.setAttribute(name, String(value));
    }
  }
  append(element, children);
  return element;
}

/** @type {(parent: Node, children: Child[]) => void} */
function append(parent, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * A section, which can be collapsed by clicking its title.  Which sections of
 * the page are collapsed is saved in localStorage, by title.
 * @type {(title: string, ...children: Child[]) => HTMLElement}
 */
function section(title, ...children) {
  return keyedSection(title, title, ...children);
}

/**
 * A section whose collapsed state is saved by `key` rather than its title,
 * for titles that change, like the name of the rule shown.
 * @type {(key: string, title: string, ...children: Child[]) => HTMLElement}
 */
function keyedSection(key, title, ...children) {
  const details = h('details', { class: 'section', open: !collapsedSections().includes(key) },
    h('summary', {}, h('h2', {}, title)),
    children);
  details.addEventListener('toggle', function () { setSectionCollapsed(key, !details.open); });
  return h('section', {}, details);
}

/** @type {() => string} */
function pageKey() {
  return normalizeUrl(location.href).slice(ROOT_URL.length) || 'index.html';
}

/** @type {() => Record<string, string[]>} */
function readCollapsed() {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** @type {() => string[]} */
function collapsedSections() {
  const keys = readCollapsed()[pageKey()];
  return Array.isArray(keys) ? keys : [];
}

/** @type {(key: string, collapsed: boolean) => void} */
function setSectionCollapsed(key, collapsed) {
  const all = readCollapsed();
  const keys = collapsedSections().filter(function (item) { return item !== key; });
  if (collapsed) keys.push(key);
  if (keys.length > 0) all[pageKey()] = keys;
  else delete all[pageKey()];
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(all));
  } catch {
    // not saved, in private browsing
  }
}

/** @type {(label: string, value: Child) => HTMLElement} */
function card(label, value) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-label' }, label),
    h('div', { class: 'card-value' }, value),
  );
}

/**
 * Items separated by commas, with at most `max` of them shown.
 * @type {(items: Child[], max?: number) => Child[]}
 */
function listOf(items, max = 10) {
  const shown = items.slice(0, max);
  /** @type {Child[]} */
  const result = [];
  shown.forEach(function (item, index) {
    if (index > 0) result.push(', ');
    result.push(item);
  });
  if (items.length > shown.length) result.push(`, and ${items.length - shown.length} more`);
  return result;
}

/** @type {(status: unknown) => HTMLElement} */
function statusBadge(status) {
  const text = status == null ? 'unknown' : String(status);
  return h('span', { class: `status status-${statusLevel(text)}` }, text);
}

/** @type {(status: string) => 'ok' | 'warn' | 'error' | 'unknown'} */
function statusLevel(status) {
  const lower = status.toLowerCase();
  if (lower === 'ok' || lower === 'success' || lower === 'succeeded') return 'ok';
  if (lower.startsWith('warn')) return 'warn';
  if (lower === 'error' || lower === 'failure' || lower === 'failed') return 'error';
  return 'unknown';
}

/**
 * A list of findings, most severe first.
 * @type {(findings: Finding[]) => HTMLElement}
 */
function findingsList(findings) {
  if (findings.length === 0) return h('p', { class: 'muted' }, 'nothing notable found');
  const order = { error: 0, warn: 1, info: 2 };
  const sorted = [...findings].sort(function (a, b) { return order[a.level] - order[b.level]; });
  return h('ul', { class: 'findings' },
    sorted.map(function (finding) {
      return h('li', { class: `finding finding-${finding.level}` },
        h('span', { class: 'finding-level' }, finding.level), ' ', finding.message);
    }),
  );
}

/**
 * A two-column table of an object's leaf values, with nested keys dotted.
 * @type {(object: unknown) => HTMLElement}
 */
function keyValueTable(object) {
  /** @type {[string, unknown][]} */
  const rows = [];
  flatten(object, '');
  return h('table', { class: 'kv' },
    h('tbody', {}, rows.map(function ([key, value]) {
      return h('tr', {}, h('th', {}, key), h('td', {}, formatValue(value)));
    })),
  );

  /** @type {(value: unknown, prefix: string) => void} */
  function flatten(value, prefix) {
    if (value != null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key);
    } else {
      rows.push([prefix, value]);
    }
  }
}

// ---------------------------------------------------------------------------
// sortable, filterable tables
// ---------------------------------------------------------------------------

/**
 * @template T
 * @typedef {{
 *   sortBy?: number;
 *   descending?: boolean;
 *   filter?: boolean;
 *   filterText?: string;
 *   search?: (row: T) => string;
 *   limit?: number;
 * }} TableOptions
 */

/**
 * A table whose columns can be sorted by clicking their headers.  `sortBy`
 * is the index of the column initially sorted.  With `filter`, a text box
 * filters the rows, starting with `filterText`; rows match if a column's
 * value, or the text from `search`, contains the filter text.  With `limit`,
 * only that many rows are shown.
 * @template T
 * @param {Column<T>[]} columns
 * @param {T[]} rows
 * @param {TableOptions<T>} [options]
 * @returns {HTMLElement}
 */
function table(columns, rows, options = {}) {
  let sortBy = options.sortBy ?? -1;
  let descending = options.descending ?? false;
  let filterText = (options.filterText || '').toLowerCase();

  const tbody = h('tbody');
  const count = h('span', { class: 'muted' });
  const headers = columns.map(function (column, index) {
    return h('th', {
      class: column.numeric ? 'numeric sortable' : 'sortable',
      title: column.title || 'click to sort',
      onclick: function () {
        descending = sortBy === index ? !descending : !!column.numeric;
        sortBy = index;
        renderRows();
      },
    }, column.label);
  });

  const filterInput = options.filter && h('input', {
    type: 'search',
    placeholder: 'filter rows',
    value: options.filterText,
    oninput: function () {
      filterText = filterInput ? filterInput.value.toLowerCase() : '';
      renderRows();
    },
  });

  renderRows();

  return h('div', { class: 'table-wrapper' },
    (filterInput || options.limit !== undefined) && h('div', { class: 'table-filter' }, filterInput, ' ', count),
    h('div', { class: 'table-scroll' },
      h('table', { class: 'data' }, h('thead', {}, h('tr', {}, headers)), tbody),
    ),
  );

  function renderRows() {
    let shown = rows;
    if (filterText) {
      shown = rows.filter(function (row) {
        if (options.search?.(row).toLowerCase().includes(filterText)) return true;
        return columns.some(function (column) {
          return String(column.value(row) ?? '').toLowerCase().includes(filterText);
        });
      });
    }
    if (sortBy >= 0) {
      const column = columns[sortBy];
      shown = [...shown].sort(function (a, b) {
        const result = compare(column.value(a), column.value(b));
        return descending ? -result : result;
      });
    }

    headers.forEach(function (header, index) {
      header.classList.toggle('sorted-asc', index === sortBy && !descending);
      header.classList.toggle('sorted-desc', index === sortBy && descending);
    });
    const limited = options.limit !== undefined && shown.length > options.limit ? shown.slice(0, options.limit) : shown;
    count.textContent = `${shown.length} of ${rows.length} rows` +
      (limited.length < shown.length ? `, showing the first ${limited.length}` : '');

    tbody.replaceChildren(...limited.map(function (row) {
      return h('tr', {}, columns.map(function (column) {
        const content = column.render ? column.render(row) : formatValue(column.value(row));
        const className = [column.numeric ? 'numeric' : '', column.cellClass?.(row) || ''].join(' ').trim();
        return h('td', { class: className || null }, content);
      }));
    }));
  }
}

/** @type {(a: unknown, b: unknown) => number} */
function compare(a, b) {
  // missing values sort last
  if (a == null || a === '') return (b == null || b === '') ? 0 : 1;
  if (b == null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

// ---------------------------------------------------------------------------
// statistics
// ---------------------------------------------------------------------------

/**
 * Statistics of the finite numbers in `values`, undefined if there are none.
 * @type {(values: unknown[]) => Stats | undefined}
 */
function stats(values) {
  const numbers = values
    .filter(function (value) { return typeof value === 'number' && Number.isFinite(value); })
    .map(Number)
    .sort(function (a, b) { return a - b; });
  if (numbers.length === 0) return undefined;

  const sum = numbers.reduce(function (total, value) { return total + value; }, 0);
  /** @type {(percent: number) => number} */
  function percentile(percent) {
    return numbers[Math.min(numbers.length - 1, Math.ceil((percent / 100) * numbers.length) - 1)];
  }
  return {
    count: numbers.length,
    min: numbers[0],
    max: numbers[numbers.length - 1],
    sum,
    avg: sum / numbers.length,
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
  };
}

/**
 * Convert a value to a number; strings are parsed, since some numeric
 * fields like event.duration are longs that may be serialized as strings.
 * @type {(value: unknown) => number | undefined}
 */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

/**
 * The number of times each value occurs, most frequent first.
 * @type {(values: string[]) => [string, number][]}
 */
function countBy(values) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort(function (a, b) { return b[1] - a[1]; });
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

/** @type {(value: unknown, digits?: number) => string} */
function formatNumber(value, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** @type {(value: unknown) => string} */
function formatPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${formatNumber(value, value < 10 ? 1 : 0)}%`;
}

/** @type {(ms: unknown) => string} */
function formatMillis(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const abs = Math.abs(ms);
  if (abs < 1000) return `${formatNumber(ms, abs < 10 ? 1 : 0)} ms`;
  if (abs < 60 * 1000) return `${formatNumber(ms / 1000, 1)} s`;
  if (abs < 60 * 60 * 1000) return `${formatNumber(ms / 60 / 1000, 1)} m`;
  if (abs < 24 * 60 * 60 * 1000) return `${formatNumber(ms / 60 / 60 / 1000, 1)} h`;
  return `${formatNumber(ms / 24 / 60 / 60 / 1000, 1)} d`;
}

/** @type {(bytes: unknown) => string} */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${formatNumber(bytes / 1024 / 1024, 1)} MB`;
  return `${formatNumber(bytes / 1024 / 1024 / 1024, 1)} GB`;
}

/** @type {(value: unknown) => string} */
function formatDate(value) {
  const date = toDate(value);
  return date ? date.toISOString().replace('T', ' ').replace('Z', '') : '';
}

/** @type {(value: unknown) => Date | undefined} */
function toDate(value) {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return undefined;
  const date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

/** @type {(value: unknown) => string} */
function formatValue(value) {
  if (value == null) return '';
  if (typeof value === 'number') return formatNumber(value, 3);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** @type {(err: unknown) => string} */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Discover links, built with discover-url.js
// ---------------------------------------------------------------------------

// Discover skips the first search when the "Search on page load" advanced
// setting is off, unless auto-refresh is on; a day's interval runs it once.
const DISCOVER_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Build a Discover URL with the Kibana URL from the settings, and the event
 * log data view unless another is given.  Returns undefined if discover-url.js
 * isn't loaded, or the parameters are invalid.
 * @type {(params: DiscoverUrlParams) => string | undefined}
 */
function discoverHref(params) {
  if (typeof discoverUrl === 'undefined') return undefined;
  const settings = getSettings();
  const dataView = params.esql ? undefined : (params.dataView || settings.eventLogDataView);
  try {
    return discoverUrl.buildDiscoverUrl({ kibana: settings.kibanaUrl, refresh: DISCOVER_REFRESH_MS, ...params, dataView });
  } catch (err) {
    console.warn('unable to build Discover URL:', err);
    return undefined;
  }
}

/**
 * A link that opens Discover in a new browser tab.
 * @type {(label: Child, params: DiscoverUrlParams) => HTMLElement}
 */
function discoverLink(label, params) {
  const href = discoverHref(params);
  if (!href) return h('span', {}, label);
  return h('a', { href, target: '_blank', rel: 'noopener', class: 'discover-link', title: 'open in Discover' }, label);
}

/**
 * A Discover "is" filter, for any value.  Filters built from strings like
 * `{ filter: 'a=b' }` can't contain every value.
 * @type {(field: string, value: string | number | boolean, options?: { negate?: boolean }) =>
 *   FilterParam}
 */
function isFilter(field, value, options = {}) {
  const index = getSettings().eventLogDataView;
  return { filterJson: discoverUrl.phraseFilter(field, value, { ...options, index }) };
}

/**
 * A Discover time range around the given times, padded so the first and
 * last documents are included.
 * @type {(from: Date | undefined, to: Date | undefined) => { from: string; to: string }}
 */
function timeRange(from, to) {
  if (!from || !to) return { from: 'now-24h', to: 'now' };
  const pad = Math.max(1000, (to.getTime() - from.getTime()) * 0.01);
  return {
    from: new Date(from.getTime() - pad).toISOString(),
    to: new Date(to.getTime() + pad).toISOString(),
  };
}

return {
  ROOT_URL,
  pageUrl,
  getSettings,
  setSettings,
  onSettingsChange,
  selectedTags,
  onTagsChange,
  rememberTags,
  hasSelectedTags,
  selectedSpaces,
  inSelectedSpaces,
  isFiltered,
  tagFilter,
  inputPanel,
  dataPanel,
  saveInput,
  removeInput,
  loadInput,
  parseDataFile,
  parseJsonValues,
  splitDevToolsOutput,
  get,
  h,
  append,
  section,
  keyedSection,
  card,
  listOf,
  statusBadge,
  statusLevel,
  findingsList,
  keyValueTable,
  table,
  stats,
  toNumber,
  toDate,
  countBy,
  formatNumber,
  formatPercent,
  formatMillis,
  formatBytes,
  formatDate,
  formatValue,
  errorMessage,
  discoverHref,
  discoverLink,
  isFilter,
  timeRange,
};

})();
