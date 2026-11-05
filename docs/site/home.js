// @ts-check

// The home page: the list of pages, the Dev Tools requests for their data,
// and a place to load the output of the requests, or files, all at once.

'use strict';

(function () {

const { h, section } = Site;

const SPACES_KEY = 'sera-spaces';

const HEALTH_REQUEST = 'GET kbn:/api/task_manager/_health';
const SPACES_REQUEST = 'GET kbn:/api/spaces/space';
const EVENT_LOG_REQUEST = 'GET .kibana-event-log-*/_search?size=2000&sort=@timestamp:desc';

/** @type {(id: string) => string} */
function pageTitle(id) {
  return SITE_PAGES.find(function (page) { return page.id === id; })?.title ?? id;
}

// ---------------------------------------------------------------------------
// the spaces whose rules and connectors are requested, saved in localStorage
// ---------------------------------------------------------------------------

/** @type {(text: string) => string[]} */
function parseSpaces(text) {
  const ids = text.split(/[\s,]+/).filter(function (id) { return id !== ''; });
  return [...new Set(['default', ...ids])];
}

/** @type {() => string[]} */
function getSpaces() {
  try {
    return parseSpaces(localStorage.getItem(SPACES_KEY) ?? '');
  } catch {
    return ['default'];
  }
}

/** @type {(spaces: string[]) => void} */
function setSpaces(spaces) {
  try {
    localStorage.setItem(SPACES_KEY, spaces.join(' '));
  } catch {
    // not saved, in private browsing
  }
}

// ---------------------------------------------------------------------------
// the Dev Tools requests
// ---------------------------------------------------------------------------

/** @type {(spaces: string[]) => string} */
function devToolsRequests(spaces) {
  return [
    '# sera: run all of these requests together, then copy all of the output',
    '# to "load the data" on the sera home page.',
    '',
    `# ${pageTitle('task-manager-health')}`,
    HEALTH_REQUEST,
    '',
    '# the spaces, to add the rules and connectors of any that are missing below',
    SPACES_REQUEST,
    '',
    ...spaces.flatMap(function (space) {
      return [
        `# rules and connectors in space ${space}`,
        KibanaData.requestInSpace(KibanaData.KINDS.rules.query, space),
        KibanaData.requestInSpace(KibanaData.KINDS.connectors.query, space),
        '',
      ];
    }),
    `# ${pageTitle('event-log')}, the most recent`,
    EVENT_LOG_REQUEST,
    '',
    `# ${pageTitle('alerts')}, the most recently updated`,
    KibanaData.KINDS.alerts.query,
    '',
  ].join('\n');
}

/** @type {{ spacesInput?: HTMLInputElement; update?: () => void }} */
const requestsView = {};

function renderRequests() {
  const pre = h('pre', {});
  const copy = h('button', {
    onclick: function () {
      navigator.clipboard.writeText(pre.textContent ?? '').then(function () { copy.textContent = 'copied'; });
    },
  }, 'copy');
  const spacesInput = h('input', {
    type: 'text',
    size: 40,
    value: getSpaces().join(' '),
    oninput: function () {
      setSpaces(parseSpaces(spacesInput.value));
      update();
    },
  });
  requestsView.spacesInput = spacesInput;
  requestsView.update = update;
  update();

  return section('getting the data',
    h('p', {},
      'Paste these requests into Kibana Dev Tools Console, select all of them, and run them.  ',
      'Then copy all of the output, which has each response after a line naming its request, ',
      'and paste it into "load the data", below.  Each page also shows the Dev Tools request for its own data.'),
    h('p', {},
      h('label', {}, 'spaces: ', spacesInput), '  ',
      h('span', { class: 'muted' },
        'The rules and connectors APIs return one space\'s, so there are requests for each of these spaces.  ',
        'Loading the output of the spaces request adds any that are missing; then run the requests again.')),
    pre,
    copy,
    h('p', {},
      'The user running the requests needs Kibana privileges to read the rules and connectors in every space, ',
      'which include the features of the rules\' types, like Observability or Security; the rules API leaves out ',
      'the rules it isn\'t allowed to read.  They also need to read the spaces, and Elasticsearch privileges to ',
      'read the ', h('code', {}, '.kibana-event-log-*'), ' and ', h('code', {}, '.alerts-*'), ' indices.'),
    h('p', {},
      'The Task Manager health report is from the Kibana instance that answers the request.  With more than ',
      'one instance, run that request a few more times to get more of the instances.'),
    h('p', {},
      'The APIs leave out rule API keys and connector secrets.  The output still contains names, user names, ',
      'and other details of the deployment, so share it with care.'),
  );

  function update() {
    pre.textContent = devToolsRequests(parseSpaces(spacesInput.value));
    copy.textContent = 'copy';
  }
}

/** @type {(ids: string[]) => void} */
function addSpaces(ids) {
  const current = getSpaces();
  const added = ids.filter(function (id) { return !current.includes(id); });
  if (added.length === 0) return;
  const spaces = [...current, ...added];
  setSpaces(spaces);
  if (requestsView.spacesInput) requestsView.spacesInput.value = spaces.join(' ');
  requestsView.update?.();
}

// ---------------------------------------------------------------------------
// loading the data
// ---------------------------------------------------------------------------

/** @typedef {{ name: string; text: string; space?: string }} InputFile */
/** @typedef {{ file: string; found: Child; pages: string[]; error?: boolean }} LoadResult */

/** @type {(text: string) => unknown[] | undefined} */
function parse(text) {
  try {
    return Site.parseJsonValues(text);
  } catch {
    return undefined;
  }
}

/**
 * Split Dev Tools output into each request's response, named for the
 * request, with the space of Kibana API requests.
 * @type {(file: InputFile) => InputFile[]}
 */
function splitResponses(file) {
  const parts = Site.splitDevToolsOutput(file.text);
  if (parts.length === 1 && !parts[0].request) return [file];
  return parts.map(function (part) {
    if (!part.request) return { name: file.name, text: part.text };
    const name = file.name === 'pasted text' ? part.request : `${file.name}: ${part.request}`;
    return { name, text: part.text, space: KibanaData.spaceFromRequest(part.request) };
  });
}

/**
 * Whether the values contain a Task Manager health report.
 * @type {(values: unknown[]) => boolean}
 */
function hasHealthReport(values) {
  return some(values, function (value) {
    const stats = value.stats;
    return stats != null && typeof stats === 'object' &&
      (stats.runtime != null || stats.workload != null || stats.configuration != null);
  });
}

/**
 * Whether the values contain event log documents, from search or ES|QL responses.
 * @type {(values: unknown[]) => boolean}
 */
function hasEventLogDocs(values) {
  return some(values, function (value) {
    if (Array.isArray(value.columns)) return value.columns.some(function (/** @type {any} */ column) { return column?.name === 'event.provider'; });
    return Site.get(value._source ?? value, 'event.provider') !== undefined && Site.get(value._source ?? value, 'kibana') !== undefined;
  });
}

/**
 * The space ids of a spaces API response.
 * @type {(values: unknown[]) => string[] | undefined}
 */
function spacesOf(values) {
  const value = /** @type {any} */ (values[0]);
  if (values.length !== 1 || !Array.isArray(value) || value.length === 0) return undefined;
  const isSpace = value.every(function (space) {
    return space != null && typeof space.id === 'string' && Array.isArray(space.disabledFeatures);
  });
  return isSpace ? value.map(function (space) { return String(space.id); }) : undefined;
}

/**
 * An Elasticsearch or Kibana error response's message.
 * @type {(values: unknown[]) => string | undefined}
 */
function errorOf(values) {
  const value = /** @type {any} */ (values[0]);
  if (values.length !== 1 || value == null || typeof value !== 'object' || value.hits) return undefined;
  const error = value.error;
  if (typeof error === 'string') return value.message ? `${error}: ${value.message}` : error;
  if (error && typeof error === 'object') return error.reason ?? error.type ?? JSON.stringify(error);
  return undefined;
}

/**
 * Whether the values are an empty connectors or rules API response, from a
 * space without any.
 * @type {(values: unknown[]) => boolean}
 */
function isEmptyApiResponse(values) {
  const value = /** @type {any} */ (values[0]);
  if (values.length !== 1 || value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.length === 0;
  return Array.isArray(value.data) && value.data.length === 0 && typeof value.per_page === 'number';
}

/** @type {(values: unknown[], test: (value: any) => boolean) => boolean} */
function some(values, test) {
  let budget = 100000;
  return values.some(walk);

  /** @type {(value: any, depth?: number) => boolean} */
  function walk(value, depth = 0) {
    if (value == null || typeof value !== 'object' || depth > 6 || --budget < 0) return false;
    if (test(value)) return true;
    return (Array.isArray(value) ? value : Object.values(value)).some(function (child) { return walk(child, depth + 1); });
  }
}

/**
 * Identify each response, and save it where its page will find it.
 * @type {(files: InputFile[]) => Promise<LoadResult[]>}
 */
async function loadFiles(files) {
  /** @type {LoadResult[]} */
  const results = [];
  /** @type {InputFile[]} */
  const kibanaFiles = [];
  /** @type {Record<string, InputFile[]>} */
  const byPage = { 'task-manager-health': [], 'event-log': [] };
  /** @type {{ result: LoadResult; ids: string[] }[]} */
  const spacesResults = [];
  /** @type {Set<string>} */
  const loadedSpaces = new Set();

  for (const file of files.flatMap(splitResponses)) {
    const values = parse(file.text);
    const space = file.space ?? KibanaData.spaceFromFileName(file.name);
    const spaces = values && spacesOf(values);
    const classified = values && !spaces && KibanaData.classify(values, space);
    const summary = classified && KibanaData.summarize(classified);
    const error = values && errorOf(values);
    if (spaces) {
      /** @type {LoadResult} */
      const result = { file: file.name, found: '', pages: [] };
      results.push(result);
      spacesResults.push({ result, ids: spaces });
    } else if (summary && classified) {
      kibanaFiles.push({ ...file, space });
      if (space) loadedSpaces.add(space);
      results.push({ file: file.name, found: space ? `${summary}, in space ${space}` : summary, pages: pagesOf(classified) });
    } else if (error) {
      results.push({ file: file.name, found: `an error response: ${error}`, pages: [], error: true });
    } else if (values && isEmptyApiResponse(values)) {
      if (space) loadedSpaces.add(space);
      results.push({ file: file.name, found: space ? `nothing, in space ${space}` : 'nothing', pages: [] });
    } else if ((values && hasHealthReport(values)) || (!values && file.text.includes('Latest Monitored Stats'))) {
      byPage['task-manager-health'].push(file);
      results.push({ file: file.name, found: 'Task Manager health', pages: ['task-manager-health'] });
    } else if (values && hasEventLogDocs(values)) {
      byPage['event-log'].push(file);
      results.push({ file: file.name, found: 'event log documents', pages: ['event-log'] });
    } else {
      results.push({ file: file.name, found: values ? 'nothing these pages analyze' : 'not JSON', pages: [], error: true });
    }
  }

  for (const { result, ids } of spacesResults) {
    addSpaces(ids);
    const missing = ids.filter(function (id) { return !loadedSpaces.has(id); });
    result.found = `spaces: ${ids.join(', ')}`;
    if (missing.length > 0) {
      result.found += `; there are no rules or connectors from ${missing.join(', ')}, so run the requests above, ` +
        'which now include every space, again';
      result.error = true;
    }
  }

  if (kibanaFiles.length > 0) {
    const names = kibanaFiles.map(function (file) { return file.name; }).join(', ');
    await KibanaData.saveClassified(KibanaData.classifyFiles(kibanaFiles), names);
  }
  for (const [page, pageFiles] of Object.entries(byPage)) {
    if (pageFiles.length === 0) continue;
    const text = pageFiles.map(function (file) { return file.text; }).join('\n');
    const saved = Site.saveInput(page, text, pageFiles.map(function (file) { return file.name; }).join(', '));
    if (!saved) {
      for (const result of results.filter(function (item) { return item.pages.includes(page); })) {
        result.found = [result.found, ', too large to keep for the page; load it on the page itself'];
        result.error = true;
      }
    }
  }
  return results;
}

/** @typedef {ReturnType<typeof KibanaData.classify>} KibanaClassified */

/** @type {(classified: KibanaClassified) => string[]} */
function pagesOf(classified) {
  return /** @type {DataKind[]} */ (Object.keys(classified.records))
    .filter(function (kind) { return classified.records[kind].length > 0; })
    .map(function (kind) { return KibanaData.KINDS[kind].page; });
}

function renderLoader() {
  const results = h('div');
  const input = Site.inputPanel({
    placeholder: 'paste the output of the requests above; files of saved responses can be dropped or loaded too',
    onFiles: function (files) { show(loadFiles(files)); },
    onData: function (text) {
      if (text !== '') show(loadFiles([{ name: 'pasted text', text }]));
      else results.replaceChildren();
    },
  });
  return section('load the data',
    h('p', {},
      'Paste the Dev Tools output here.  Each response is identified, and saved for its page; ',
      'then open the pages from the menu, in this browser tab.'),
    input,
    results,
  );

  /** @type {(loading: Promise<LoadResult[]>) => void} */
  function show(loading) {
    loading.then(function (list) {
      results.replaceChildren(Site.table([
        { label: 'response', value: function (row) { return row.file; } },
        { label: 'found', value: function (row) { return String(row.found); }, render: function (row) { return row.found; },
          cellClass: function (row) { return row.error ? 'cell-warn' : undefined; } },
        { label: 'page', value: function (row) { return row.pages.join(' '); }, render: function (row) {
          return Site.listOf(row.pages.map(function (page) { return h('a', { href: Site.pageUrl(page) }, pageTitle(page)); }));
        } },
      ], list));
    }).catch(function (err) {
      console.error(err);
      results.replaceChildren(h('p', { class: 'input-status error' }, `error loading the data: ${Site.errorMessage(err)}`));
    });
  }
}

// ---------------------------------------------------------------------------

function renderPages() {
  return h('ul', { class: 'page-list' }, SITE_PAGES.map(function (page) {
    return h('li', {},
      h('a', { href: Site.pageUrl(page.id) }, page.title),
      h('div', { class: 'muted' }, page.description),
    );
  }));
}

/** @type {HTMLElement} */ (document.getElementById('home')).append(
  renderPages(),
  renderRequests(),
  renderLoader(),
);

})();
