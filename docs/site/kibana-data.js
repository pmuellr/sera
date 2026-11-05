// @ts-check

// Kibana data shared by the rules, connectors, and alerts pages.
//
// Responses pasted into any of the pages are read for rules and connectors,
// from the Kibana APIs or saved object searches, and alert documents.
// They're kept in IndexedDB, so each page can use the data loaded on the
// others, for the links between rules and their connectors and alerts.  The
// records keep only the fields the pages use; secrets and API keys are
// dropped.
//
// Loaded with <script src> after site.js.

'use strict';

/** @typedef {'rules' | 'connectors' | 'alerts'} DataKind */

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
 *   rulesById: Map<string, Rule>;
 *   connectorsById: Map<string, Connector>;
 *   alertsByRule: Map<string, Alert[]>;
 *   rulesByConnector: Map<string, Rule[]>;
 *   asOf: number | undefined;
 * }} KibanaDataSets
 */

const KibanaData = (function () {

const h = Site.h;

const DB_NAME = 'sera';
const DB_STORE = 'kibana-data';
// change when the records change, so data saved by older versions is dropped
const RECORD_VERSION = 3;
// kinds of data that older versions saved
const OLD_KINDS = ['tasks'];

// the space of API responses, which don't say, from file names like rules-space-<id>.json
const SPACE_FILE_PATTERN = /(?:^|[-_.])space-([a-z0-9_-]+)\.json$/i;

const ALERTS_QUERY = 'GET .alerts-*/_search?size=2000&sort=@timestamp:desc';

const SPACES_HELP = 'The response doesn\'t say which space it\'s from, so run the requests for every space ' +
  'together, and paste all of the output; the space of each response is read from its request, in the line ' +
  'Dev Tools puts before it.  Files named like <kind>-space-<space id>.json are read as that space\'s.';

/** @type {Record<DataKind, { title: string; page: string; query: string; queryHelp: string }>} */
const KINDS = {
  rules: {
    title: 'rules',
    page: 'rules',
    query: 'GET kbn:/api/alerting/rules/_find?per_page=10000',
    queryHelp: 'The rules in the default space, from the Kibana rules API; for another space, use ' +
      'kbn:/s/<space id>/api/alerting/rules/_find?per_page=10000.  ' + SPACES_HELP + '  ' +
      'The API doesn\'t return the rules\' run durations and success ratios; a search of .kibana* for saved objects ' +
      'of type alert does, and works here too.',
  },
  connectors: {
    title: 'connectors',
    page: 'connectors',
    query: 'GET kbn:/api/actions/connectors',
    queryHelp: 'The connectors in the default space, including preconfigured connectors, from the Kibana connectors API; ' +
      'for another space, use kbn:/s/<space id>/api/actions/connectors.  ' + SPACES_HELP + '  ' +
      'A search of .kibana* for saved objects of type action works here too.',
  },
  alerts: {
    title: 'alerts',
    page: 'alerts',
    query: ALERTS_QUERY,
    queryHelp: 'The most recently updated alerts.',
  },
};
const KIND_NAMES = /** @type {DataKind[]} */ (Object.keys(KINDS));

/** @type {Partial<Record<DataKind, DataSet<any>>>} */
let memoryStore = {};

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
 * Find the rules, connectors, and alerts in parsed JSON values: rules
 * and connectors API responses, search and msearch responses, hits, and
 * documents.  The total of a rules API or search response is attributed to
 * the kind of its records.  `space` is the space of rules and connectors
 * from the APIs, whose responses don't say.
 * @type {(values: unknown[], space?: string) => Classified}
 */
function classify(values, space) {
  /** @type {Classified} */
  const result = { records: { rules: [], connectors: [], alerts: [] }, totals: {} };
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
  }

  function counts() {
    return {
      rules: result.records.rules.length,
      connectors: result.records.connectors.length,
      alerts: result.records.alerts.length,
    };
  }
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
 * kept once.
 * @type {(files: { name: string; text: string; space?: string }[]) => Classified}
 */
function classifyFiles(files) {
  /** @type {Classified & { sources: Partial<Record<DataKind, string[]>> }} */
  const result = { records: { rules: [], connectors: [], alerts: [] }, totals: {}, sources: {} };
  for (const file of files) {
    const classified = classify(Site.parseJsonValues(file.text), file.space ?? spaceFromFileName(file.name));
    for (const kind of KIND_NAMES) {
      if (classified.records[kind].length > 0) result.sources[kind] = [...(result.sources[kind] || []), file.name];
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
// storage, in IndexedDB, or memory if it's not available
// ---------------------------------------------------------------------------

/** @type {Promise<IDBDatabase | undefined> | undefined} */
let dbPromise;

/** @type {() => Promise<IDBDatabase | undefined>} */
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise(function (resolve) {
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = function () { request.result.createObjectStore(DB_STORE); };
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

/** @type {(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest) => Promise<any>} */
async function withStore(mode, fn) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise(function (resolve, reject) {
    const request = fn(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

/** @type {(kind: DataKind, dataSet: DataSet<any>) => Promise<void>} */
async function save(kind, dataSet) {
  memoryStore[kind] = dataSet;
  await withStore('readwrite', function (store) { return store.put({ version: RECORD_VERSION, ...dataSet }, kind); });
}

/** @type {(kind: DataKind) => Promise<void>} */
async function clear(kind) {
  delete memoryStore[kind];
  await withStore('readwrite', function (store) { return store.delete(kind); });
}

/** @type {() => Promise<KibanaDataSets>} */
async function load() {
  /** @type {Partial<Record<DataKind, DataSet<any>>>} */
  const stored = { ...memoryStore };
  for (const kind of KIND_NAMES) {
    try {
      const value = await withStore('readonly', function (store) { return store.get(kind); });
      if (value && value.version === RECORD_VERSION) stored[kind] = value;
      else if (value) await clear(kind);
    } catch (err) {
      console.warn(`unable to load ${kind}:`, err);
    }
  }
  for (const kind of OLD_KINDS) {
    await withStore('readwrite', function (store) { return store.delete(kind); }).catch(function () {});
  }
  memoryStore = stored;
  return withIndexes(stored);
}

/** @type {(stored: Partial<Record<DataKind, DataSet<any>>>) => KibanaDataSets} */
function withIndexes(stored) {
  /** @type {KibanaDataSets} */
  const data = {
    rules: stored.rules,
    connectors: stored.connectors,
    alerts: stored.alerts,
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
      'responses for rules, connectors, and alerts can be loaded on any of these pages',
    onData: function (text, source) {
      if (text === '') {
        update(clear(kind), '');
        return;
      }
      loaded(classifyFiles(splitConsoleOutput(source, text)), source);
    },
    onFiles: function (files) {
      try {
        const parts = files.flatMap(function (file) { return splitConsoleOutput(file.name, file.text); });
        loaded(classifyFiles(parts), files.map(function (file) { return file.name; }).join(', '));
      } catch (err) {
        message.textContent = Site.errorMessage(err);
        message.classList.add('error');
      }
    },
  });

  update(Promise.resolve(), '');
  return h('div', {}, input, message, status);

  /** @type {(classified: Classified, source: string) => void} */
  function loaded(classified, source) {
    const summary = summarize(classified);
    if (!summary) throw new Error('no rules, connectors, or alerts found');
    update(saveClassified(classified, source), `loaded ${summary} from ${source}`);
  }

  /** @type {(saving: Promise<unknown>, text: string) => void} */
  function update(saving, text) {
    saving
      .then(load)
      .then(function (data) {
        message.textContent = text;
        message.classList.remove('error');
        status.replaceChildren(renderStatus(data, kind, function (cleared) { update(clear(cleared), ''); }));
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
 * Save each kind of data found, replacing what was loaded before.  `source`
 * describes where it came from, unless the files of each kind are known.
 * @type {(classified: Classified, source: string) => Promise<void>}
 */
async function saveClassified(classified, source) {
  const loadedAt = new Date().toISOString();
  await Promise.all(KIND_NAMES
    .filter(function (name) { return classified.records[name].length > 0; })
    .map(function (name) {
      return save(name, {
        records: classified.records[name],
        total: classified.totals[name],
        source: classified.sources?.[name]?.join(', ') ?? source,
        loadedAt,
      });
    }));
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
 * All the rule tags in the rules and alerts.
 * @type {(data: KibanaDataSets) => string[]}
 */
function allTags(data) {
  return [...new Set([
    ...(data.rules?.records ?? []).flatMap(function (rule) { return rule.tags; }),
    ...(data.alerts?.records ?? []).flatMap(function (alert) { return alert.tags ?? []; }),
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
  summarize,
  parseInterval,
  load,
  panel,
  isComplete,
  countText,
  link,
  filterLink,
  hashParams,
  ruleLink,
  alertTags,
  allTags,
  connectorLink,
  notLoaded,
};

})();
