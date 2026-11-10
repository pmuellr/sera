// @ts-check

// Kibana data shared by the rules, connectors, alerts, and event log pages.
//
// Responses pasted into any of the pages are read for rules and connectors,
// from the Kibana APIs or saved object searches, alert documents, and event
// log documents.
// They're kept in IndexedDB, so each page can use the data loaded on the
// others, for the links between rules and their connectors and alerts.  Each
// set of loaded data is a session, and the pages show the current one.  The
// records keep only the fields the pages use; secrets and API keys are
// dropped.
//
// Loaded with <script src> after site.js.

'use strict';

/** @typedef {'rules' | 'connectors' | 'alerts' | 'events'} DataKind */

/**
 * A rule, from the rules API or an `alert` saved object.  Durations are in
 * ms.  The rules API doesn't return the monitoring fields, p50 through
 * gapS, or the snooze fields.  space is undefined if it isn't known.
 * @typedef {{
 *   id: string;
 *   name: string;
 *   type: string;
 *   consumer: string | undefined;
 *   enabled: boolean;
 *   space: string | undefined;
 *   tags: string[];
 *   interval: string | undefined;
 *   intervalMs: number | undefined;
 *   actions: RuleAction[];
 *   scheduledTaskId: string | undefined;
 *   status: string | undefined;
 *   statusReason: string | undefined;
 *   statusMessage: string | undefined;
 *   outcome: string | undefined;
 *   outcomeMessage: string | undefined;
 *   lastRunAt: string | undefined;
 *   lastDurationMs: number | undefined;
 *   p50: number | undefined;
 *   p95: number | undefined;
 *   p99: number | undefined;
 *   successRatio: number | undefined;
 *   historyRuns: number;
 *   historyFailures: number;
 *   gapS: number | undefined;
 *   searchMs: number | undefined;
 *   alertsActive: number | undefined;
 *   alertsNew: number | undefined;
 *   alertsRecovered: number | undefined;
 *   muteAll: boolean;
 *   mutedAlerts: number;
 *   snoozedUntil: string | undefined;
 *   snoozeSchedules: number;
 *   running: boolean;
 *   nextRun: string | undefined;
 *   createdAt: string | undefined;
 *   updatedAt: string | undefined;
 *   doc: any;
 * }} Rule
 */

/**
 * An action of a rule.  connectorId is undefined if the reference is missing.
 * @typedef {{
 *   connectorId: string | undefined;
 *   connectorType: string | undefined;
 *   group: string | undefined;
 *   preconfigured: boolean;
 *   system: boolean;
 *   summary: boolean;
 *   notifyWhen: string | undefined;
 *   throttle: string | undefined;
 * }} RuleAction
 */

/**
 * A connector, from the connectors API or an `action` saved object.  The API
 * also returns preconfigured and system connectors, which aren't in a space,
 * and the number of saved objects referencing each connector.
 * @typedef {{
 *   id: string;
 *   name: string;
 *   type: string;
 *   space: string | undefined;
 *   preconfigured: boolean;
 *   system: boolean;
 *   referencedBy: number | undefined;
 *   isMissingSecrets: boolean;
 *   config: any;
 *   createdAt: string | undefined;
 *   updatedAt: string | undefined;
 *   doc: any;
 * }} Connector
 */

/**
 * An alert, from the .alerts-* indices.
 * @typedef {{
 *   uuid: string;
 *   index: string | undefined;
 *   time: string | undefined;
 *   ruleId: string | undefined;
 *   ruleName: string | undefined;
 *   ruleType: string | undefined;
 *   consumer: string | undefined;
 *   status: string;
 *   workflowStatus: string | undefined;
 *   start: string | undefined;
 *   end: string | undefined;
 *   durationUs: number | undefined;
 *   flapping: boolean;
 *   instanceId: string | undefined;
 *   actionGroup: string | undefined;
 *   reason: string | undefined;
 *   tags: string[];
 *   spaces: string[];
 *   doc: any;
 * }} Alert
 */

/**
 * The records of one kind, with the total number of matching documents from
 * the responses, when they have it.
 * @template T
 * @typedef {{ records: T[]; total: number | undefined; source: string; loadedAt: string }} DataSet
 */

/**
 * All the loaded data, with indexes for looking up related records.
 * @typedef {{
 *   rules: DataSet<Rule> | undefined;
 *   connectors: DataSet<Connector> | undefined;
 *   alerts: DataSet<Alert> | undefined;
 *   events: DataSet<any> | undefined;
 *   rulesById: Map<string, Rule>;
 *   connectorsById: Map<string, Connector>;
 *   alertsByRule: Map<string, Alert[]>;
 *   rulesByConnector: Map<string, Rule[]>;
 *   asOf: number | undefined;
 * }} KibanaDataSets
 */

/**
 * A set of loaded data, which the pages show when it's the current session.
 * sizes are of the data as JSON, in characters, by kind, and of the Task
 * Manager health report.
 * @typedef {{
 *   id: string;
 *   name: string;
 *   description: string;
 *   createdAt: string;
 *   updatedAt: string;
 *   counts: Partial<Record<DataKind, number>>;
 *   sizes: Partial<Record<DataKind | 'health', number>>;
 * }} Session
 */

const KibanaData = (function () {

const h = Site.h;

const DB_NAME = 'sera';
// version 1 kept a single set of data, by kind
const DB_VERSION = 2;
const DB_STORE = 'kibana-data';
const SESSIONS_STORE = 'sessions';
const SESSION_KEY = 'sera.session';
const HEALTH_KEY = 'health';
// the session the data saved by version 1 of the database is moved to
const FIRST_SESSION = 'before-sessions';
// change when the records change, so data saved by older versions is dropped
const RECORD_VERSION = 4;

// the space of API responses, which don't say, from file names like rules-space-<id>.json
const SPACE_FILE_PATTERN = /(?:^|[-_.])space-([a-z0-9_-]+)\.json$/i;

const ALERTS_QUERY = 'GET .alerts-*/_search?size=10000&sort=@timestamp:desc';
const EVENTS_QUERY = 'GET .kibana-event-log-*/_search?size=10000&sort=@timestamp:desc';

const SPACES_HELP = 'The response doesn\'t say which space it\'s from, so run the requests for every space ' +
  'together, and paste all of the output; the space of each response is read from its request, in the line ' +
  'Dev Tools puts before it.  Files named like <kind>-space-<space id>.json are read as that space\'s.';

/** @type {Record<DataKind, { title: string; one: string; page: string; query: string; queryHelp: string }>} */
const KINDS = {
  rules: {
    title: 'rules',
    one: 'rule',
    page: 'rules',
    query: 'GET kbn:/api/alerting/rules/_find?per_page=10000',
    queryHelp: 'The rules in the default space, from the Kibana rules API; for another space, use ' +
      'kbn:/s/<space id>/api/alerting/rules/_find?per_page=10000.  ' + SPACES_HELP + '  ' +
      'The API doesn\'t return the rules\' run durations and success ratios; a search of .kibana* for saved objects ' +
      'of type alert does, and works here too.',
  },
  connectors: {
    title: 'connectors',
    one: 'connector',
    page: 'connectors',
    query: 'GET kbn:/api/actions/connectors',
    queryHelp: 'The connectors in the default space, including preconfigured connectors, from the Kibana connectors API; ' +
      'for another space, use kbn:/s/<space id>/api/actions/connectors.  ' + SPACES_HELP + '  ' +
      'A search of .kibana* for saved objects of type action works here too.',
  },
  alerts: {
    title: 'alerts',
    one: 'alert',
    page: 'alerts',
    query: ALERTS_QUERY,
    queryHelp: 'The most recently updated alerts.',
  },
  events: {
    title: 'event log documents',
    one: 'event log document',
    page: 'event-log',
    query: EVENTS_QUERY,
    queryHelp: 'The most recent event log documents.  ES|QL responses, JSON arrays of documents, and NDJSON work here too.',
  },
};
const KIND_NAMES = /** @type {DataKind[]} */ (Object.keys(KINDS));

// ---------------------------------------------------------------------------
// reading API and search responses
// ---------------------------------------------------------------------------

/**
 * The records found, and their totals.  `sources` has the names of the files
 * each kind was found in, when they were classified separately.
 * @typedef {{
 *   records: Record<DataKind, any[]>;
 *   totals: Partial<Record<DataKind, number>>;
 *   sources?: Partial<Record<DataKind, string[]>>;
 * }} Classified
 */

/**
 * Find the rules, connectors, alerts, and event log documents in parsed JSON
 * values: rules and connectors API responses, search, msearch, and ES|QL
 * responses, hits, and documents.  The total of a rules API or search
 * response is attributed to the kind of its records.  `space` is the space of
 * rules and connectors from the APIs, whose responses don't say.
 * @type {(values: unknown[], space?: string) => Classified}
 */
function classify(values, space) {
  /** @type {Classified} */
  const result = { records: { rules: [], connectors: [], alerts: [], events: [] }, totals: {} };
  for (const value of values) walk(value);
  return result;

  /** @type {(value: any) => void} */
  function walk(value) {
    if (value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (Array.isArray(value.responses)) {
      walk(value.responses);
    } else if (Array.isArray(value.hits?.hits)) {
      walkWithTotal(value.hits.hits, searchTotal(value.hits.total));
    } else if (Array.isArray(value.data) && typeof value.per_page === 'number') {
      // a rules API _find response
      walkWithTotal(value.data, value.total);
    } else if (Array.isArray(value.columns) && Array.isArray(value.values)) {
      walk(esqlRows(value));
    } else if (value.rawResponse && typeof value.rawResponse === 'object') {
      walk(value.rawResponse);
    } else if (value._source && typeof value._source === 'object') {
      add(value._source, value._id, value._index);
    } else {
      add(value, undefined, undefined);
    }
  }

  /**
   * Infinity when the search stopped counting, without track_total_hits.
   * @type {(total: any) => number | undefined}
   */
  function searchTotal(total) {
    if (typeof total === 'number') return total;
    if (typeof total?.value !== 'number') return undefined;
    return total.relation === 'gte' ? Infinity : total.value;
  }

  /** @type {(items: any[], total: unknown) => void} */
  function walkWithTotal(items, total) {
    const before = counts();
    walk(items);
    const after = counts();
    const added = KIND_NAMES.filter(function (kind) { return after[kind] > before[kind]; });
    if (added.length === 1 && typeof total === 'number') {
      result.totals[added[0]] = (result.totals[added[0]] || 0) + total;
    }
  }

  /** @type {(source: any, id: string | undefined, index: string | undefined) => void} */
  function add(source, id, index) {
    if (source.type === 'alert' && source.alert) result.records.rules.push(toRule(source, savedObjectId('alert', id)));
    else if (source.type === 'action' && source.action) result.records.connectors.push(toConnector(source, savedObjectId('action', id)));
    else if (isApiRule(source)) result.records.rules.push(toApiRule(source, space));
    else if (isApiConnector(source)) result.records.connectors.push(toApiConnector(source, space));
    else if (Site.get(source, 'kibana.alert.rule.uuid') !== undefined) result.records.alerts.push(toAlert(source, id, index));
    else if (Site.get(source, 'event.provider') !== undefined) result.records.events.push(source);
  }

  function counts() {
    return {
      rules: result.records.rules.length,
      connectors: result.records.connectors.length,
      alerts: result.records.alerts.length,
      events: result.records.events.length,
    };
  }
}

/**
 * ES|QL rows, as objects with dotted keys.
 * @type {(response: { columns: { name: string }[]; values: unknown[][] }) => Record<string, unknown>[]}
 */
function esqlRows(response) {
  return response.values.map(function (row) {
    /** @type {Record<string, unknown>} */
    const doc = {};
    response.columns.forEach(function (column, index) { doc[column.name] = row[index]; });
    return doc;
  });
}

/**
 * The space of an API response from its file name, like rules-space-<id>.json.
 * @type {(fileName: string) => string | undefined}
 */
function spaceFromFileName(fileName) {
  return SPACE_FILE_PATTERN.exec(fileName)?.[1];
}

/**
 * The space of a Kibana API request, like `GET kbn:/s/<id>/api/actions/connectors`.
 * Requests of Elasticsearch have no space.
 * @type {(request: string) => string | undefined}
 */
function spaceFromRequest(request) {
  const path = request.trim().split(/\s+/).pop() ?? '';
  const match = /^(?:kbn:)?\/?s\/([^/?]+)\/api\//.exec(path);
  if (match) return decodeURIComponent(match[1]);
  return /^(?:kbn:)?\/?api\//.test(path) ? 'default' : undefined;
}

/**
 * A Dev Tools request of the Kibana API, like `GET kbn:/api/actions/connectors`,
 * in the given space.
 * @type {(request: string, space: string) => string}
 */
function requestInSpace(request, space) {
  return space === 'default' ? request : request.replace('kbn:/api/', `kbn:/s/${encodeURIComponent(space)}/api/`);
}

/**
 * Split Dev Tools Console output into each request's response, with the
 * space of Kibana API requests.  Other text is a single response.
 * @type {(name: string, text: string) => { name: string; text: string; space?: string }[]}
 */
function splitConsoleOutput(name, text) {
  return Site.splitDevToolsOutput(text).map(function (part) {
    if (!part.request) return { name, text: part.text };
    const partName = name === 'pasted text' ? part.request : `${name}: ${part.request}`;
    return { name: partName, text: part.text, space: spaceFromRequest(part.request) };
  });
}

/**
 * Classify the files separately, so each file's space, or its name, can give
 * the space of its API responses, and combine them.  Connectors in more than
 * one file, like the preconfigured connectors in each space's connectors, are
 * kept once.  A file can have its values already parsed, instead of text.
 * @type {(files: { name: string; text?: string; values?: unknown[]; space?: string }[]) => Classified}
 */
function classifyFiles(files) {
  /** @type {Classified & { sources: Partial<Record<DataKind, string[]>> }} */
  const result = { records: { rules: [], connectors: [], alerts: [], events: [] }, totals: {}, sources: {} };
  for (const file of files) {
    const values = file.values ?? Site.parseJsonValues(file.text ?? '');
    const classified = classify(values, file.space ?? spaceFromFileName(file.name));
    for (const kind of KIND_NAMES) {
      const sources = result.sources[kind] || [];
      if (classified.records[kind].length > 0 && !sources.includes(file.name)) result.sources[kind] = [...sources, file.name];
      result.records[kind].push(...classified.records[kind]);
      const total = classified.totals[kind];
      if (total !== undefined) result.totals[kind] = (result.totals[kind] || 0) + total;
    }
  }
  /** @type {Set<string>} */
  const connectorIds = new Set();
  result.records.connectors = result.records.connectors.filter(function (connector) {
    if (connectorIds.has(connector.id)) return false;
    connectorIds.add(connector.id);
    return true;
  });
  return result;
}

// ---------------------------------------------------------------------------
// sera data files
// ---------------------------------------------------------------------------

const HEALTH_PAGE = 'task-manager-health';
// the pages whose data is from the Kibana APIs, which return one space's
const SPACE_PAGES = ['rules', 'connectors'];

/**
 * The responses in a sera data file for a page, with their spaces.  Since
 * version 2, the rules and connectors are objects of each space's response,
 * by space id; before, they were the default space's response.
 * @type {(dataFile: DataFile, page: string) => { space: string; value: unknown }[]}
 */
function dataFileResponses(dataFile, page) {
  const value = dataFile[page];
  if (value === undefined) return [];
  if (SPACE_PAGES.includes(page) && dataFile.meta.version >= 2 && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).map(function ([space, response]) { return { space, value: response }; });
  }
  return [{ space: 'default', value }];
}

/**
 * Save the data in a sera data file in a new session, which becomes the
 * current one: the rules, connectors, alerts, and event log documents, whose
 * properties are named by their pages' ids, and the Task Manager health
 * report, which its page analyzes when it's opened in this tab.  The Kibana
 * URL it was downloaded from replaces the Kibana URL setting, for the links
 * to Discover.  Returns what was loaded, for each page.
 * @type {(dataFile: DataFile, name: string) => Promise<{ page: string; text: string }[]>}
 */
async function loadDataFile(dataFile, name) {
  const kibanaUrl = dataFile.meta.kibanaUrl;
  if (kibanaUrl && kibanaUrl !== Site.getSettings().kibanaUrl) {
    Site.setSettings({ ...Site.getSettings(), kibanaUrl });
  }

  const classified = classifyFiles(KIND_NAMES.flatMap(function (kind) {
    return dataFileResponses(dataFile, KINDS[kind].page).map(function ({ space, value }) {
      return { name, values: [value], space };
    });
  }));
  const session = await createSession(name, dataFileSource(dataFile));
  await saveClassified(classified, name, session);

  const loaded = KIND_NAMES
    .filter(function (kind) { return classified.records[kind].length > 0; })
    .map(function (kind) {
      const count = classified.records[kind].length;
      return { page: KINDS[kind].page, text: `${Site.formatNumber(count)} ${count === 1 ? KINDS[kind].one : KINDS[kind].title}` };
    });
  const health = dataFile[HEALTH_PAGE];
  if (health === undefined) {
    Site.removeInput(HEALTH_PAGE);
  } else {
    const text = JSON.stringify(health, null, 2);
    await saveHealth(session, text, name);
    if (Site.saveInput(HEALTH_PAGE, text, name)) loaded.unshift({ page: HEALTH_PAGE, text: 'the health report' });
  }
  return loaded;
}

/**
 * What a sera data file says about itself: when and where it was downloaded,
 * and which requests failed.
 * @type {(dataFile: DataFile) => string[]}
 */
function dataFileNotes(dataFile) {
  return [dataFileSource(dataFile), ...dataFileErrors(dataFile)].filter(Boolean);
}

/**
 * When and where a sera data file was downloaded, like
 * `downloaded 2026-11-09 19:03:00.000 from Kibana at http://localhost:5601`.
 * @type {(dataFile: DataFile) => string}
 */
function dataFileSource(dataFile) {
  const { timestamp, kibanaUrl, elasticsearchUrl } = dataFile.meta;
  const from = [
    kibanaUrl && `Kibana at ${kibanaUrl}`,
    elasticsearchUrl && `Elasticsearch at ${elasticsearchUrl}`,
  ].filter(Boolean).join(' and ');
  if (!timestamp && !from) return '';
  return ['downloaded', timestamp && Site.formatDate(timestamp), from && `from ${from}`].filter(Boolean).join(' ');
}

/** @type {(dataFile: DataFile) => string[]} */
function dataFileErrors(dataFile) {
  return Object.entries(dataFile.meta.errors ?? {}).map(function ([page, error]) {
    return `the request for ${page} failed: ${error}`;
  });
}

/**
 * The prompt to load a sera data file, which loads the data of every page.
 * Files dropped on the page are loaded too.  After a file is loaded, its
 * pages are listed, and onLoaded is called.
 * @type {(options: { hint: Child[]; onLoaded?: () => void }) => HTMLElement}
 */
function dataFileLoader({ hint, onLoaded }) {
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    onchange: function () {
      const file = fileInput.files?.[0];
      if (file) loadFile(file);
      fileInput.value = '';
    },
  });
  const status = h('div', { class: 'input-status' });

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
    const file = event.dataTransfer?.files[0];
    if (file) loadFile(file);
  });

  return h('div', { class: 'data-file-loader' },
    h('div', { class: 'data-file-loader-prompt' },
      h('button', { onclick: function () { fileInput.click(); } }, 'load a sera data file'),
      h('span', { class: 'muted' }, hint),
    ),
    fileInput,
    status,
  );

  /** @type {(file: File) => Promise<void>} */
  async function loadFile(file) {
    showStatus(`reading ${file.name}`, false);
    try {
      const dataFile = Site.parseDataFile(await file.text());
      if (!dataFile) {
        throw new Error(`${file.name} isn't a sera data file; load other files on the pages for their data`);
      }
      const loaded = await loadDataFile(dataFile, file.name);
      const source = dataFileSource(dataFile);
      showStatus('', false);
      status.append(
        h('div', {}, [`loaded ${file.name}`, source].filter(Boolean).join(', ')),
        loaded.length === 0 ? h('div', {}, 'it had no data') : h('ul', {}, loaded.map(function (item) {
          const page = SITE_PAGES.find(function (p) { return p.id === item.page; });
          return h('li', {}, h('a', { href: Site.pageUrl(item.page) }, page?.title ?? item.page), ': ', item.text);
        })),
        ...dataFileErrors(dataFile).map(function (error) {
          return h('div', { class: 'error' }, error);
        }),
      );
      if (onLoaded) onLoaded();
    } catch (err) {
      console.error(err);
      showStatus(`error loading ${file.name}: ${Site.errorMessage(err)}`, true);
    }
  }

  /** @type {(message: string, isError: boolean) => void} */
  function showStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }
}

/** @type {(value: unknown) => any[]} */
function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The saved object id from a document _id, like `alert:<id>`, or
 * `<namespace>:action:<id>` for single-namespace types.
 * @type {(type: string, rawId: string | undefined) => string | undefined}
 */
function savedObjectId(type, rawId) {
  if (rawId == null) return undefined;
  const prefix = `${type}:`;
  if (rawId.startsWith(prefix)) return rawId.slice(prefix.length);
  const index = rawId.indexOf(`:${prefix}`);
  return index === -1 ? rawId : rawId.slice(index + prefix.length + 1);
}

/**
 * The fields from a rule's monitoring, which has the same names in the saved
 * object and the API.
 * @type {(monitoring: any) => Pick<Rule, 'p50' | 'p95' | 'p99' | 'successRatio' | 'historyRuns' | 'historyFailures' | 'gapS' | 'searchMs'> & { lastRunAt: string | undefined; durationMs: number | undefined }}
 */
function monitoringOf(monitoring) {
  const run = monitoring?.run || {};
  const history = Array.isArray(run.history) ? run.history : [];
  const metrics = run.last_run?.metrics || {};
  return {
    lastRunAt: run.last_run?.timestamp ?? undefined,
    durationMs: Site.toNumber(metrics.duration),
    p50: Site.toNumber(run.calculated_metrics?.p50),
    p95: Site.toNumber(run.calculated_metrics?.p95),
    p99: Site.toNumber(run.calculated_metrics?.p99),
    successRatio: Site.toNumber(run.calculated_metrics?.success_ratio),
    historyRuns: history.length,
    historyFailures: history.filter(function (/** @type {any} */ entry) { return entry?.success === false; }).length,
    gapS: Site.toNumber(metrics.gap_duration_s),
    searchMs: Site.toNumber(metrics.total_search_duration_ms),
  };
}

/** @type {(message: unknown) => string | undefined} */
function outcomeMessageOf(message) {
  if (Array.isArray(message)) return message.join('\n');
  return typeof message === 'string' ? message : undefined;
}

/** @type {(source: any, id: string | undefined) => Rule} */
function toRule(source, id) {
  const rule = source.alert;
  const references = Array.isArray(source.references) ? source.references : [];
  const { lastRunAt, durationMs, ...monitoring } = monitoringOf(rule.monitoring);

  return {
    id: id ?? rule.scheduledTaskId ?? 'unknown',
    name: String(rule.name ?? ''),
    type: String(rule.alertTypeId ?? 'unknown'),
    consumer: rule.consumer,
    enabled: !!rule.enabled,
    space: spaceOf(source),
    tags: toArray(rule.tags).map(String),
    interval: rule.schedule?.interval,
    intervalMs: parseInterval(rule.schedule?.interval),
    actions: toArray(rule.actions).map(function (/** @type {any} */ action) {
      return toRuleAction(action, references, rule);
    }),
    scheduledTaskId: rule.scheduledTaskId ?? undefined,
    status: rule.executionStatus?.status,
    statusReason: rule.executionStatus?.error?.reason ?? rule.executionStatus?.warning?.reason,
    statusMessage: rule.executionStatus?.error?.message ?? rule.executionStatus?.warning?.message,
    outcome: rule.lastRun?.outcome,
    outcomeMessage: outcomeMessageOf(rule.lastRun?.outcomeMsg),
    lastRunAt: lastRunAt ?? rule.executionStatus?.lastExecutionDate,
    lastDurationMs: Site.toNumber(rule.executionStatus?.lastDuration) ?? durationMs,
    ...monitoring,
    alertsActive: Site.toNumber(rule.lastRun?.alertsCount?.active),
    alertsNew: Site.toNumber(rule.lastRun?.alertsCount?.new),
    alertsRecovered: Site.toNumber(rule.lastRun?.alertsCount?.recovered),
    muteAll: !!rule.muteAll,
    mutedAlerts: toArray(rule.mutedInstanceIds).length,
    snoozedUntil: rule.isSnoozedUntil ?? undefined,
    snoozeSchedules: toArray(rule.snoozeSchedule).length,
    running: !!rule.running,
    nextRun: rule.nextRun ?? undefined,
    createdAt: rule.createdAt ?? source.created_at,
    updatedAt: rule.updatedAt ?? source.updated_at,
    doc: withoutSecrets(source),
  };
}

/** @type {(action: any, references: any[], rule: any) => RuleAction} */
function toRuleAction(action, references, rule) {
  const ref = String(action.actionRef ?? '');
  const preconfigured = ref.startsWith('preconfigured:');
  const system = ref.startsWith('system_action:');
  let connectorId;
  if (preconfigured || system) connectorId = ref.slice(ref.indexOf(':') + 1);
  else connectorId = references.find(function (reference) { return reference?.name === ref; })?.id;
  return {
    connectorId,
    connectorType: action.actionTypeId,
    group: action.group,
    preconfigured,
    system,
    summary: !!action.frequency?.summary,
    notifyWhen: action.frequency?.notifyWhen ?? rule.notifyWhen ?? undefined,
    throttle: action.frequency?.throttle ?? rule.throttle ?? undefined,
  };
}

/** @type {(value: any) => boolean} */
function isApiRule(value) {
  return typeof value.id === 'string' && typeof value.rule_type_id === 'string' && value.schedule != null;
}

/**
 * A rule from the rules API, GET /api/alerting/rules/_find.  System actions
 * are in its actions, without an action group.
 * @type {(rule: any, space: string | undefined) => Rule}
 */
function toApiRule(rule, space) {
  const { lastRunAt, durationMs, ...monitoring } = monitoringOf(rule.monitoring);
  const status = rule.execution_status;
  return {
    id: rule.id,
    name: String(rule.name ?? ''),
    type: rule.rule_type_id,
    consumer: rule.consumer,
    enabled: !!rule.enabled,
    space,
    tags: toArray(rule.tags).map(String),
    interval: rule.schedule?.interval,
    intervalMs: parseInterval(rule.schedule?.interval),
    actions: toArray(rule.actions).map(function (/** @type {any} */ action) {
      return {
        connectorId: action.id ?? undefined,
        connectorType: action.connector_type_id,
        group: action.group,
        preconfigured: false,
        system: action.group === undefined,
        summary: !!action.frequency?.summary,
        notifyWhen: action.frequency?.notify_when ?? rule.notify_when ?? undefined,
        throttle: action.frequency?.throttle ?? rule.throttle ?? undefined,
      };
    }),
    scheduledTaskId: rule.scheduled_task_id ?? undefined,
    status: status?.status,
    statusReason: status?.error?.reason ?? status?.warning?.reason,
    statusMessage: status?.error?.message ?? status?.warning?.message,
    outcome: rule.last_run?.outcome,
    outcomeMessage: outcomeMessageOf(rule.last_run?.outcome_msg),
    lastRunAt: lastRunAt ?? status?.last_execution_date,
    lastDurationMs: Site.toNumber(status?.last_duration) ?? durationMs,
    ...monitoring,
    alertsActive: Site.toNumber(rule.last_run?.alerts_count?.active),
    alertsNew: Site.toNumber(rule.last_run?.alerts_count?.new),
    alertsRecovered: Site.toNumber(rule.last_run?.alerts_count?.recovered),
    muteAll: !!rule.mute_all,
    mutedAlerts: toArray(rule.muted_alert_ids).length,
    snoozedUntil: rule.is_snoozed_until ?? undefined,
    snoozeSchedules: toArray(rule.snooze_schedule).length,
    running: !!rule.running,
    nextRun: rule.next_run ?? undefined,
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
    doc: withoutSecrets(rule),
  };
}

/** @type {(value: any) => boolean} */
function isApiConnector(value) {
  return typeof value.id === 'string' && typeof value.connector_type_id === 'string' && 'is_preconfigured' in value;
}

/**
 * A connector from the connectors API, GET /api/actions/connectors.
 * @type {(connector: any, space: string | undefined) => Connector}
 */
function toApiConnector(connector, space) {
  const preconfigured = !!connector.is_preconfigured;
  const system = !!connector.is_system_action;
  return {
    id: connector.id,
    name: String(connector.name ?? ''),
    type: connector.connector_type_id,
    space: preconfigured || system ? undefined : space,
    preconfigured,
    system,
    referencedBy: Site.toNumber(connector.referenced_by_count),
    isMissingSecrets: !!connector.is_missing_secrets,
    config: connector.config ?? {},
    createdAt: undefined,
    updatedAt: undefined,
    doc: withoutSecrets(connector),
  };
}

/** @type {(source: any, id: string | undefined) => Connector} */
function toConnector(source, id) {
  const connector = source.action;
  return {
    id: id ?? 'unknown',
    name: String(connector.name ?? ''),
    type: String(connector.actionTypeId ?? 'unknown'),
    space: spaceOf(source),
    preconfigured: false,
    system: false,
    referencedBy: undefined,
    isMissingSecrets: !!connector.isMissingSecrets,
    config: connector.config ?? {},
    createdAt: source.created_at,
    updatedAt: source.updated_at,
    doc: withoutSecrets(source),
  };
}

/** @type {(source: any, id: string | undefined, index: string | undefined) => Alert} */
function toAlert(source, id, index) {
  /** @type {(field: string) => any} */
  function field(name) {
    const value = Site.get(source, `kibana.alert.${name}`);
    return Array.isArray(value) && value.length === 1 ? value[0] : value;
  }
  const spaces = Site.get(source, 'kibana.space_ids');
  return {
    uuid: String(field('uuid') ?? id ?? 'unknown'),
    index,
    time: Site.get(source, '@timestamp'),
    ruleId: field('rule.uuid'),
    ruleName: field('rule.name'),
    ruleType: field('rule.rule_type_id'),
    consumer: field('rule.consumer'),
    status: String(field('status') ?? 'unknown'),
    workflowStatus: field('workflow_status'),
    start: field('start'),
    end: field('end'),
    durationUs: Site.toNumber(field('duration.us')),
    flapping: field('flapping') === true,
    instanceId: field('instance.id'),
    actionGroup: field('action_group'),
    reason: field('reason'),
    tags: toArray(Site.get(source, 'kibana.alert.rule.tags')).map(String),
    spaces: Array.isArray(spaces) ? spaces : spaces ? [spaces] : [],
    doc: source,
  };
}

/** @type {(source: any) => string} */
function spaceOf(source) {
  const namespaces = toArray(source.namespaces);
  if (namespaces.length > 0) return namespaces.join(', ');
  return source.namespace ?? 'default';
}

/**
 * A copy of a saved object without its secrets and API keys.
 * @type {(source: any) => any}
 */
function withoutSecrets(source) {
  return JSON.parse(JSON.stringify(source, function (key, value) {
    return ['apiKey', 'secrets', 'userScope'].includes(key) ? undefined : value;
  }));
}

/**
 * Parse a rule schedule interval, like `30s`, `5m`, `1h`, or `1d`, into ms.
 * @type {(interval: unknown) => number | undefined}
 */
function parseInterval(interval) {
  const match = /^(\d+)([smhd])$/.exec(String(interval ?? ''));
  if (!match) return undefined;
  const units = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return Number(match[1]) * units[/** @type {'s' | 'm' | 'h' | 'd'} */ (match[2])];
}

// ---------------------------------------------------------------------------
// storage, in IndexedDB, or memory if it's not available.  Each session's
// data is saved by kind, with keys like <session id>/<kind>, and the current
// session's id is in localStorage, shared by the tabs.
// ---------------------------------------------------------------------------

/** @type {Promise<IDBDatabase | undefined> | undefined} */
let dbPromise;

/** @type {Record<string, Map<string, any>>} */
const memoryDb = { [DB_STORE]: new Map(), [SESSIONS_STORE]: new Map() };

/** @type {() => Promise<IDBDatabase | undefined>} */
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise(function (resolve) {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function (event) {
          const db = request.result;
          if (event.oldVersion < 1) db.createObjectStore(DB_STORE);
          if (event.oldVersion < 2) {
            db.createObjectStore(SESSIONS_STORE);
            if (event.oldVersion === 1 && request.transaction) moveToFirstSession(request.transaction);
          }
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () {
          console.warn('IndexedDB is not available, data is kept in memory:', request.error);
          resolve(undefined);
        };
      } catch (err) {
        console.warn('IndexedDB is not available, data is kept in memory:', err);
        resolve(undefined);
      }
    });
  }
  return dbPromise;
}

/**
 * Move the data saved by version 1 of the database, keyed by kind, to a
 * session, which becomes the current one.  The keys are all read before any
 * are written, since the new keys sort among the old ones.
 * @type {(transaction: IDBTransaction) => void}
 */
function moveToFirstSession(transaction) {
  const store = transaction.objectStore(DB_STORE);
  /** @type {{ key: IDBValidKey; value: any }[]} */
  const old = [];
  const cursorRequest = store.openCursor();
  cursorRequest.onsuccess = function () {
    const cursor = cursorRequest.result;
    if (cursor) {
      old.push({ key: cursor.key, value: cursor.value });
      cursor.continue();
      return;
    }
    const now = new Date().toISOString();
    const session = newSession(FIRST_SESSION, 'data loaded before sessions', '', now);
    /** @type {string[]} */
    const sources = [];
    for (const { key, value } of old) {
      store.delete(key);
      const kind = /** @type {DataKind} */ (String(key));
      if (!KIND_NAMES.includes(kind) || value?.version !== RECORD_VERSION) continue;
      store.put(value, dataKey(session.id, kind));
      session.counts[kind] = value.records.length;
      session.sizes[kind] = JSON.stringify(value).length;
      if (value.loadedAt < session.createdAt) session.createdAt = value.loadedAt;
      if (!sources.includes(value.source)) sources.push(value.source);
    }
    if (Object.keys(session.counts).length === 0) return;
    session.description = `from ${sources.join(', ')}`;
    transaction.objectStore(SESSIONS_STORE).put(session, session.id);
    if (!currentSessionId()) setCurrentSessionId(session.id);
  };
}

/**
 * A request to a store, or the same operation on its map in memory, if
 * IndexedDB isn't available.
 * @type {(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest, inMemory: (map: Map<string, any>) => any) => Promise<any>}
 */
async function storeRequest(storeName, mode, fn, inMemory) {
  const db = await openDb();
  if (!db) return inMemory(memoryDb[storeName]);
  return new Promise(function (resolve, reject) {
    const request = fn(db.transaction(storeName, mode).objectStore(storeName));
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

/** @type {(storeName: string, key: string) => Promise<any>} */
function dbGet(storeName, key) {
  return storeRequest(storeName, 'readonly', function (store) { return store.get(key); }, function (map) { return map.get(key); });
}

/** @type {(storeName: string, key: string, value: any) => Promise<void>} */
async function dbPut(storeName, key, value) {
  await storeRequest(storeName, 'readwrite', function (store) { return store.put(value, key); }, function (map) { map.set(key, value); });
}

/** @type {(storeName: string, key: string) => Promise<void>} */
async function dbDelete(storeName, key) {
  await storeRequest(storeName, 'readwrite', function (store) { return store.delete(key); }, function (map) { map.delete(key); });
}

/** @type {(sessionId: string, kind: DataKind | 'health') => string} */
function dataKey(sessionId, kind) {
  return `${sessionId}/${kind}`;
}

/**
 * The current session's id, after opening the database, which can move the
 * data saved by version 1 to a session that becomes the current one.
 * @type {() => Promise<string | undefined>}
 */
async function openCurrentSessionId() {
  await openDb();
  return currentSessionId();
}

/** @type {() => string | undefined} */
function currentSessionId() {
  try {
    return localStorage.getItem(SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** @type {(id: string | undefined) => void} */
function setCurrentSessionId(id) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // without localStorage, there's no current session
  }
}

/** @type {(id: string, name: string, description: string, createdAt: string) => Session} */
function newSession(id, name, description, createdAt) {
  return { id, name, description, createdAt, updatedAt: createdAt, counts: {}, sizes: {} };
}

/**
 * The sessions, newest first.
 * @type {() => Promise<Session[]>}
 */
async function listSessions() {
  /** @type {Session[]} */
  const sessions = await storeRequest(SESSIONS_STORE, 'readonly',
    function (store) { return store.getAll(); },
    function (map) { return [...map.values()]; });
  return sessions.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
}

/**
 * Start a new session, which becomes the current one.
 * @type {(name: string, description?: string) => Promise<Session>}
 */
async function createSession(name, description = '') {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session = newSession(id, name, description, new Date().toISOString());
  await dbPut(SESSIONS_STORE, id, session);
  setCurrentSessionId(id);
  return session;
}

/**
 * The current session, or a new one named `name`, if there isn't one.
 * @type {(name: string) => Promise<Session>}
 */
async function currentSession(name) {
  const id = await openCurrentSessionId();
  const session = id ? await dbGet(SESSIONS_STORE, id) : undefined;
  return session ?? createSession(name);
}

/**
 * Make a session the current one, with its Task Manager health report, if it
 * has one, for the health page.
 * @type {(id: string) => Promise<void>}
 */
async function useSession(id) {
  setCurrentSessionId(id);
  const health = await dbGet(DB_STORE, dataKey(id, HEALTH_KEY));
  if (health) Site.saveInput(HEALTH_PAGE, health.text, health.source);
  else Site.removeInput(HEALTH_PAGE);
}

/**
 * Delete a session and its data.  If it's the current session, there's no
 * current session after.
 * @type {(id: string) => Promise<void>}
 */
async function deleteSession(id) {
  for (const kind of [...KIND_NAMES, HEALTH_KEY]) await dbDelete(DB_STORE, dataKey(id, /** @type {DataKind | 'health'} */ (kind)));
  await dbDelete(SESSIONS_STORE, id);
  if (currentSessionId() === id) {
    setCurrentSessionId(undefined);
    Site.removeInput(HEALTH_PAGE);
  }
}

/** @type {(session: Session) => Promise<void>} */
async function touch(session) {
  session.updatedAt = new Date().toISOString();
  await dbPut(SESSIONS_STORE, session.id, session);
}

/** @type {(session: Session, kind: DataKind, dataSet: DataSet<any>) => Promise<void>} */
async function save(session, kind, dataSet) {
  const value = { version: RECORD_VERSION, ...dataSet };
  await dbPut(DB_STORE, dataKey(session.id, kind), value);
  session.counts[kind] = dataSet.records.length;
  session.sizes[kind] = JSON.stringify(value).length;
  await touch(session);
}

/** @type {(session: Session, text: string, source: string) => Promise<void>} */
async function saveHealth(session, text, source) {
  await dbPut(DB_STORE, dataKey(session.id, HEALTH_KEY), { text, source });
  session.sizes.health = text.length;
  await touch(session);
}

/**
 * Clear a kind of data from the current session.
 * @type {(kind: DataKind) => Promise<void>}
 */
async function clear(kind) {
  const id = await openCurrentSessionId();
  if (!id) return;
  await dbDelete(DB_STORE, dataKey(id, kind));
  /** @type {Session | undefined} */
  const session = await dbGet(SESSIONS_STORE, id);
  if (!session) return;
  delete session.counts[kind];
  delete session.sizes[kind];
  await touch(session);
}

/**
 * The current session's data.
 * @type {() => Promise<KibanaDataSets>}
 */
async function load() {
  /** @type {Partial<Record<DataKind, DataSet<any>>>} */
  const stored = {};
  const id = await openCurrentSessionId();
  if (!id) return withIndexes(stored);
  for (const kind of KIND_NAMES) {
    try {
      const value = await dbGet(DB_STORE, dataKey(id, kind));
      if (value && value.version === RECORD_VERSION) stored[kind] = value;
      else if (value) await clear(kind);
    } catch (err) {
      console.warn(`unable to load ${kind}:`, err);
    }
  }
  return withIndexes(stored);
}

/**
 * What a session has, like `12 rules, 4 connectors, the health report`.
 * @type {(session: Session) => string}
 */
function sessionContents(session) {
  return [
    ...KIND_NAMES
      .filter(function (kind) { return session.counts[kind] !== undefined; })
      .map(function (kind) {
        const count = session.counts[kind] ?? 0;
        return `${Site.formatNumber(count)} ${count === 1 ? KINDS[kind].one : KINDS[kind].title}`;
      }),
    session.sizes.health !== undefined ? 'the health report' : '',
  ].filter(Boolean).join(', ');
}

/** @type {(session: Session) => number} */
function sessionSize(session) {
  return Object.values(session.sizes).reduce(function (sum, size) { return sum + (size ?? 0); }, 0);
}

/**
 * The sessions, to pick the current one, or delete them, with how much data
 * each has.  onChange is called after the current session changes, here or
 * in another tab.  Call refresh() after loading data.
 * @type {(options?: { onChange?: () => void }) => { element: HTMLElement; refresh: () => Promise<void> }}
 */
function sessionPicker({ onChange } = {}) {
  const element = h('div', { class: 'sessions' });
  window.addEventListener('storage', function (event) {
    if (event.key === SESSION_KEY) changed();
  });
  refresh();
  return { element, refresh };

  function changed() {
    refresh();
    if (onChange) onChange();
  }

  async function refresh() {
    try {
      const [sessions, estimate] = await Promise.all([listSessions(), storageEstimate()]);
      const current = currentSessionId();
      element.replaceChildren(
        h('div', { class: 'sessions-title' }, 'sessions'),
        sessions.length === 0
          ? h('p', { class: 'muted' }, 'none yet; loading data starts one')
          : h('table', { class: 'data sessions-table' },
            h('thead', {}, h('tr', {},
              h('th', {}, 'session'), h('th', {}, 'created'), h('th', {}, 'data'), h('th', { class: 'numeric' }, 'size'), h('th', {}))),
            h('tbody', {}, sessions.map(function (session) { return row(session, session.id === current); }))),
        h('p', { class: 'muted' },
          'Loading a sera data file starts a new session.  Sizes are of the data as JSON.',
          estimate?.usage !== undefined && estimate.quota !== undefined
            ? `  This site, ${location.host || 'here'}, is using ${Site.formatBytes(estimate.usage)} ` +
              `of the ${Site.formatBytes(estimate.quota)} the browser allows it.`
            : ''),
      );
    } catch (err) {
      console.error(err);
      element.replaceChildren(h('p', { class: 'error' }, `error listing the sessions: ${Site.errorMessage(err)}`));
    }
  }

  /** @type {(session: Session, isCurrent: boolean) => HTMLElement} */
  function row(session, isCurrent) {
    const radio = /** @type {HTMLInputElement} */ (h('input', {
      type: 'radio',
      name: 'sera-session',
      onchange: function () { useSession(session.id).then(changed); },
    }));
    radio.checked = isCurrent;
    return h('tr', { class: isCurrent ? 'current' : '' },
      h('td', {},
        h('label', {}, radio, ' ', session.name),
        session.description ? h('div', { class: 'muted' }, session.description) : ''),
      h('td', {}, Site.formatDate(session.createdAt)),
      h('td', {}, sessionContents(session) || h('span', { class: 'muted' }, 'nothing')),
      h('td', { class: 'numeric' }, Site.formatBytes(sessionSize(session))),
      h('td', {}, h('button', {
        onclick: function () {
          if (confirm(`Delete the session ${session.name}, and its data?`)) deleteSession(session.id).then(changed);
        },
      }, 'delete')),
    );
  }
}

/** @type {() => Promise<StorageEstimate | undefined>} */
async function storageEstimate() {
  try {
    return await navigator.storage?.estimate();
  } catch {
    return undefined;
  }
}

/** @type {(stored: Partial<Record<DataKind, DataSet<any>>>) => KibanaDataSets} */
function withIndexes(stored) {
  /** @type {KibanaDataSets} */
  const data = {
    rules: stored.rules,
    connectors: stored.connectors,
    alerts: stored.alerts,
    events: stored.events,
    rulesById: new Map(),
    connectorsById: new Map(),
    alertsByRule: new Map(),
    rulesByConnector: new Map(),
    asOf: undefined,
  };
  for (const rule of data.rules?.records || []) {
    data.rulesById.set(rule.id, rule);
    for (const action of rule.actions) {
      if (!action.connectorId) continue;
      const rules = data.rulesByConnector.get(action.connectorId) || [];
      if (!rules.includes(rule)) rules.push(rule);
      data.rulesByConnector.set(action.connectorId, rules);
    }
  }
  for (const connector of data.connectors?.records || []) data.connectorsById.set(connector.id, connector);
  // rules from the API don't say which of their connectors are preconfigured
  for (const rule of data.rules?.records || []) {
    for (const action of rule.actions) {
      const connector = action.connectorId ? data.connectorsById.get(action.connectorId) : undefined;
      if (connector?.preconfigured) action.preconfigured = true;
      if (connector?.system) action.system = true;
    }
  }
  for (const alert of data.alerts?.records || []) {
    if (!alert.ruleId) continue;
    const alerts = data.alertsByRule.get(alert.ruleId) || [];
    alerts.push(alert);
    data.alertsByRule.set(alert.ruleId, alerts);
  }

  // the newest time in the data, as an estimate of when it was collected
  const times = [
    ...(data.rules?.records || []).flatMap(function (rule) { return [rule.lastRunAt, rule.updatedAt]; }),
    ...(data.alerts?.records || []).map(function (alert) { return alert.time; }),
    ...(data.events?.records || []).map(function (event) { return Site.get(event, '@timestamp'); }),
  ].map(function (time) { return Site.toDate(time)?.getTime(); })
    .filter(function (time) { return time !== undefined; })
    .map(Number);
  data.asOf = times.length ? Math.max(...times) : undefined;
  return data;
}

// ---------------------------------------------------------------------------
// the data panel at the top of each page
// ---------------------------------------------------------------------------

/**
 * The input panel, and the status of the loaded data, for the page that
 * analyzes `kind`.  Data of any kind can be loaded on any of the pages.
 * onData is called with the loaded data, initially and whenever it changes.
 * @type {(kind: DataKind, onData: (data: KibanaDataSets) => void) => HTMLElement}
 */
function panel(kind, onData) {
  const status = h('div', { class: 'data-status' });
  const message = h('div', { class: 'input-status' });

  const input = Site.inputPanel({
    placeholder: `paste the response for ${KINDS[kind].title} here, drop files on the page, or load files; ` +
      'responses for rules, connectors, alerts, and the event log can be loaded on any of these pages, ' +
      'and a sera data file loads all of them',
    onData: function (text, source) {
      if (text === '') {
        update(clear(kind).then(function () { return ''; }));
        return;
      }
      loaded([{ name: source, text }]);
    },
    onFiles: function (files) {
      try {
        loaded(files);
      } catch (err) {
        message.textContent = Site.errorMessage(err);
        message.classList.add('error');
      }
    },
  });

  const addToCurrent = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));
  addToCurrent.checked = true;
  const picker = sessionPicker({ onChange: function () { update(Promise.resolve('')); } });

  const details = Site.dataPanel(
    input,
    h('label', { class: 'session-option' }, addToCurrent,
      ' add pasted and loaded responses to the current session, instead of starting a new one'),
    message,
    picker.element,
    status);
  update(Promise.resolve(''));
  return details.element;

  /**
   * Load sera data files, and then the other files' responses.
   * @type {(files: { name: string; text: string }[]) => void}
   */
  function loaded(files) {
    /** @type {{ name: string; dataFile: DataFile }[]} */
    const dataFiles = [];
    /** @type {{ name: string; text: string; space?: string }[]} */
    const parts = [];
    for (const file of files) {
      const dataFile = Site.parseDataFile(file.text);
      if (dataFile) dataFiles.push({ name: file.name, dataFile });
      else parts.push(...splitConsoleOutput(file.name, file.text));
    }
    const classified = parts.length > 0 ? classifyFiles(parts) : undefined;
    const summary = classified && summarize(classified);
    if (classified && !summary && dataFiles.length === 0) {
      throw new Error('no rules, connectors, alerts, or event log documents found');
    }

    /** @type {string[]} */
    const messages = [];
    let saving = Promise.resolve();
    for (const { name, dataFile } of dataFiles) {
      saving = saving
        .then(function () { return loadDataFile(dataFile, name); })
        .then(function (pages) {
          const what = pages.map(function (page) { return page.text; }).join(', ') || 'nothing';
          messages.push([`loaded ${what} from ${name}`, ...dataFileNotes(dataFile)].join('; '));
        });
    }
    if (classified && summary) {
      const source = parts.length === 1 ? parts[0].name : files.map(function (file) { return file.name; }).join(', ');
      saving = saving.then(async function () {
        messages.push(`loaded ${summary} from ${source}`);
        return saveClassified(classified, source, addToCurrent.checked ? undefined : await createSession(source));
      });
    }
    update(saving.then(function () { return messages.join('; '); }));
  }

  /** @type {(saving: Promise<string>) => void} */
  function update(saving) {
    saving
      .then(function (text) {
        return load().then(function (data) { return { data, text }; });
      })
      .then(function ({ data, text }) {
        picker.refresh();
        message.textContent = text;
        message.classList.remove('error');
        status.replaceChildren(renderStatus(data, kind, function (cleared) {
          update(clear(cleared).then(function () { return ''; }));
        }));
        const counts = KIND_NAMES.flatMap(function (name) {
          const dataSet = data[name];
          if (!dataSet) return [];
          return [`${countText(dataSet)} ${dataSet.records.length === 1 ? KINDS[name].one : KINDS[name].title}`];
        });
        details.update(
          counts.length ? counts.join(', ') : 'nothing loaded; paste a response, drop files on the page, or load files',
          counts.length > 0);
        onData(data);
      })
      .catch(function (err) {
        console.error(err);
        message.textContent = `error saving the data: ${Site.errorMessage(err)}`;
        message.classList.add('error');
      });
  }
}

/**
 * Save each kind of data found in a session, replacing what it had before;
 * by default, the current session, or a new one if there isn't one.
 * `source` describes where it came from, unless the files of each kind are
 * known.
 * @type {(classified: Classified, source: string, session?: Session) => Promise<void>}
 */
async function saveClassified(classified, source, session) {
  const target = session ?? await currentSession(source);
  const loadedAt = new Date().toISOString();
  for (const name of KIND_NAMES) {
    if (classified.records[name].length === 0) continue;
    await save(target, name, {
      records: classified.records[name],
      total: classified.totals[name],
      source: classified.sources?.[name]?.join(', ') ?? source,
      loadedAt,
    });
  }
}

/**
 * What was found, like `12 rules, 4 connectors`, or '' if nothing was.
 * @type {(classified: Classified) => string}
 */
function summarize(classified) {
  return KIND_NAMES
    .filter(function (name) { return classified.records[name].length > 0; })
    .map(function (name) {
      const count = classified.records[name].length;
      return `${Site.formatNumber(count)} ${count === 1 ? KINDS[name].title.replace(/s$/, '') : KINDS[name].title}`;
    })
    .join(', ');
}

/** @type {(data: KibanaDataSets, current: DataKind, onClear: (kind: DataKind) => void) => HTMLElement} */
function renderStatus(data, current, onClear) {
  return h('table', { class: 'kv data-status-table' }, h('tbody', {}, KIND_NAMES.map(function (kind) {
    const dataSet = data[kind];
    const title = kind === current ? h('b', {}, KINDS[kind].title) : h('a', { href: Site.pageUrl(KINDS[kind].page) }, KINDS[kind].title);
    return h('tr', {},
      h('th', {}, title),
      h('td', {}, dataSet
        ? [
          `${countText(dataSet)} from ${dataSet.source}, loaded ${Site.formatDate(dataSet.loadedAt)} `,
          h('button', { onclick: function () { onClear(kind); } }, 'clear'),
          isComplete(dataSet) ? '' : h('span', { class: 'status status-warn', title: 'the response didn\'t return all the matching records' }, 'incomplete'),
        ]
        : h('span', { class: 'muted' }, 'not loaded')),
      h('td', {}, queryDetails(kind)),
    );
  })));
}

/** @type {(kind: DataKind) => HTMLElement} */
function queryDetails(kind) {
  return h('details', { class: 'query' },
    h('summary', {}, 'Dev Tools query'),
    h('p', { class: 'muted' }, KINDS[kind].queryHelp),
    copyable(KINDS[kind].query),
  );
}

/** @type {(text: string) => HTMLElement} */
function copyable(text) {
  return h('div', {},
    h('pre', {}, text),
    h('button', {
      onclick: function (/** @type {Event} */ event) {
        const button = /** @type {HTMLButtonElement} */ (event.target);
        navigator.clipboard.writeText(text).then(function () { button.textContent = 'copied'; });
      },
    }, 'copy'),
  );
}

/** @type {(dataSet: DataSet<any>) => string} */
function countText(dataSet) {
  const count = dataSet.records.length;
  if (dataSet.total === Infinity) return `${Site.formatNumber(count)} of more`;
  return dataSet.total !== undefined && dataSet.total > count
    ? `${Site.formatNumber(count)} of ${Site.formatNumber(dataSet.total)}`
    : Site.formatNumber(count);
}

/**
 * Whether the data set has all the matching documents, so missing records
 * mean they don't exist.
 * @type {(dataSet: DataSet<any> | undefined) => boolean}
 */
function isComplete(dataSet) {
  return !!dataSet && (dataSet.total === undefined || dataSet.records.length >= dataSet.total);
}

// ---------------------------------------------------------------------------
// links between the pages, with #id=<id> to show a record, or #q=<text> to
// filter the page's tables
// ---------------------------------------------------------------------------

/** @type {(kind: DataKind, id: string, label: Child) => HTMLElement} */
function link(kind, id, label) {
  return h('a', { href: `${Site.pageUrl(KINDS[kind].page)}#id=${encodeURIComponent(id)}` }, label);
}

/** @type {(kind: DataKind, text: string, label: Child) => HTMLElement} */
function filterLink(kind, text, label) {
  return h('a', { href: `${Site.pageUrl(KINDS[kind].page)}#q=${encodeURIComponent(text)}` }, label);
}

/** @type {() => { id: string | undefined; q: string | undefined }} */
function hashParams() {
  const params = new URLSearchParams(location.hash.slice(1));
  return { id: params.get('id') ?? undefined, q: params.get('q') ?? undefined };
}

/**
 * An alert's rule tags: its own, and its rule's, when the rule is loaded.
 * @type {(data: KibanaDataSets, alert: Alert) => string[]}
 */
function alertTags(data, alert) {
  const rule = alert.ruleId === undefined ? undefined : data.rulesById.get(alert.ruleId);
  return [...new Set([...(alert.tags ?? []), ...(rule?.tags ?? [])])];
}

/**
 * All the rule tags in the rules, alerts, and event log documents.
 * @type {(data: KibanaDataSets) => string[]}
 */
function allTags(data) {
  return [...new Set([
    ...(data.rules?.records ?? []).flatMap(function (rule) { return rule.tags; }),
    ...(data.alerts?.records ?? []).flatMap(function (alert) { return alert.tags ?? []; }),
    ...(data.events?.records ?? []).flatMap(function (event) { return toArray(Site.get(event, 'kibana.alert.rule.tags')).map(String); }),
  ])];
}

/**
 * The spaces of a rule or connector, which are joined in its space when it's
 * from a saved object in more than one.  Preconfigured and system
 * connectors aren't in a space.
 * @type {(record: { space: string | undefined }) => string[]}
 */
function recordSpaces(record) {
  return record.space === undefined ? [] : record.space.split(', ');
}

/**
 * The spaces of an event log document, from kibana.space_ids.
 * @type {(event: any) => string[]}
 */
function eventSpaces(event) {
  return toArray(Site.get(event, 'kibana.space_ids')).map(String);
}

/**
 * All the spaces of the rules, connectors, alerts, and event log documents.
 * @type {(data: KibanaDataSets) => string[]}
 */
function allSpaces(data) {
  return [...new Set([
    ...(data.rules?.records ?? []).flatMap(recordSpaces),
    ...(data.connectors?.records ?? []).flatMap(recordSpaces),
    ...(data.alerts?.records ?? []).flatMap(function (alert) { return alert.spaces; }),
    ...(data.events?.records ?? []).flatMap(eventSpaces),
  ])];
}

/**
 * A rule's name linked to the rules page, or its id if the rule isn't loaded.
 * @type {(data: KibanaDataSets, ruleId: string | undefined, name?: string) => Child}
 */
function ruleLink(data, ruleId, name) {
  if (!ruleId) return name || '';
  const rule = data.rulesById.get(ruleId);
  return link('rules', ruleId, rule?.name || name || h('span', { class: 'mono' }, ruleId));
}

/**
 * A connector's name linked to the connectors page, or its id if it isn't loaded.
 * @type {(data: KibanaDataSets, connectorId: string | undefined) => Child}
 */
function connectorLink(data, connectorId) {
  if (!connectorId) return h('span', { class: 'muted' }, 'missing reference');
  const connector = data.connectorsById.get(connectorId);
  return link('connectors', connectorId, connector?.name || h('span', { class: 'mono' }, connectorId));
}

/**
 * A message for when a page's data isn't loaded.
 * @type {(kind: DataKind) => HTMLElement}
 */
function notLoaded(kind) {
  return h('p', { class: 'muted' },
    `No ${KINDS[kind].title} are loaded.  Run the Dev Tools query above, and paste the response here.`);
}

return {
  KINDS,
  classify,
  classifyFiles,
  spaceFromFileName,
  spaceFromRequest,
  requestInSpace,
  saveClassified,
  loadDataFile,
  dataFileNotes,
  dataFileSource,
  dataFileErrors,
  dataFileLoader,
  summarize,
  parseInterval,
  load,
  listSessions,
  currentSessionId,
  createSession,
  useSession,
  deleteSession,
  sessionPicker,
  panel,
  isComplete,
  countText,
  link,
  filterLink,
  hashParams,
  ruleLink,
  alertTags,
  allTags,
  recordSpaces,
  eventSpaces,
  allSpaces,
  connectorLink,
  notLoaded,
};

})();
