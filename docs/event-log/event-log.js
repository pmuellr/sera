// @ts-check

// Analyze Kibana event log documents.  event.duration and
// kibana.task.schedule_delay are in nanoseconds; they're converted to ms.

'use strict';

(function () {

const { h, section, table, get, stats, toNumber, toDate, formatNumber, formatPercent, formatMillis, formatDate } = Site;

const NANOS_PER_MILLI = 1000 * 1000;

// chart colors, for the largest groups; the rest are combined as "other"
const COLORS = ['#54b399', '#6092c0', '#d36086', '#9170b8', '#ca8eae', '#d6bf57', '#b9a888', '#da8b45', '#aa6556', '#e7664c'];
const OTHER_COLOR = '#98a2b3';

const CHART_GROUPS = {
  provider: { label: 'provider', key: function (/** @type {LogEvent} */ event) { return event.provider; } },
  action: { label: 'provider and action', key: function (/** @type {LogEvent} */ event) { return `${event.provider} ${event.action}`; } },
  outcome: { label: 'outcome', key: function (/** @type {LogEvent} */ event) { return event.outcome; } },
  server: { label: 'Kibana server', key: function (/** @type {LogEvent} */ event) { return event.server; } },
};
/** @typedef {keyof typeof CHART_GROUPS} ChartGroup */

const output = /** @type {HTMLElement} */ (document.getElementById('output'));
const input = /** @type {HTMLElement} */ (document.getElementById('input'));

/**
 * The fields of an event log document used in the analysis.
 * @typedef {{
 *   doc: any;
 *   time: Date | undefined;
 *   provider: string;
 *   action: string;
 *   outcome: string;
 *   durationMs: number | undefined;
 *   error: string | undefined;
 *   server: string;
 *   version: string | undefined;
 *   taskType: string | undefined;
 *   scheduleDelayMs: number | undefined;
 *   ruleId: string | undefined;
 *   ruleName: string | undefined;
 *   ruleType: string | undefined;
 *   connectorId: string | undefined;
 *   connectorName: string | undefined;
 *   connectorType: string | undefined;
 *   relatedRuleId: string | undefined;
 *   tags: string[];
 *   spaces: string[];
 * }} LogEvent
 */

/** @type {LogEvent[]} */
let allEvents = [];
/**
 * The events with the selected rule tags.
 * @type {LogEvent[]}
 */
let events = [];
/** @type {ChartGroup} */
let chartGroup = 'provider';
/**
 * The shared data, for the event log documents, and the tags of the events'
 * rules.
 * @type {KibanaDataSets | undefined}
 */
let kibanaData;

input.append(KibanaData.panel('events', function (loaded) {
  kibanaData = loaded;
  allEvents = (loaded.events?.records ?? []).map(toEvent);
  Site.rememberTags('event-log', allEvents.flatMap(function (event) { return event.tags; }));
  render();
}));
Site.onSettingsChange(render);
Site.onTagsChange(render);

/**
 * An event's rule tags: its own, and its rule's, when the rule is loaded.
 * @type {(event: LogEvent) => string[]}
 */
function eventTags(event) {
  const rule = event.relatedRuleId === undefined ? undefined : kibanaData?.rulesById.get(event.relatedRuleId);
  return rule ? [...new Set([...event.tags, ...rule.tags])] : event.tags;
}

// ---------------------------------------------------------------------------
// reading documents
// ---------------------------------------------------------------------------

/** @type {(doc: any) => LogEvent} */
function toEvent(doc) {
  const savedObjects = Array.isArray(get(doc, 'kibana.saved_objects')) ? get(doc, 'kibana.saved_objects') : [];
  /** @type {(type: string) => any} */
  function savedObject(type) {
    return savedObjects.find(function (/** @type {any} */ so) { return so?.type === type; });
  }

  const provider = String(get(doc, 'event.provider') ?? 'unknown');
  const isAction = provider === 'actions';
  const isRule = provider === 'alerting';
  const durationNanos = toNumber(get(doc, 'event.duration'));
  const delayNanos = toNumber(get(doc, 'kibana.task.schedule_delay'));
  const error = get(doc, 'error.message');

  return {
    doc,
    time: toDate(get(doc, '@timestamp')),
    provider,
    action: String(get(doc, 'event.action') ?? 'unknown'),
    outcome: String(get(doc, 'event.outcome') ?? 'unknown'),
    durationMs: durationNanos === undefined ? undefined : durationNanos / NANOS_PER_MILLI,
    error: error == null || error === '' ? undefined : String(error),
    server: String(get(doc, 'kibana.server_uuid') ?? 'unknown'),
    version: get(doc, 'kibana.version'),
    taskType: get(doc, 'kibana.task.type') ?? (provider === 'taskManager' ? savedObject('task')?.type_id : undefined),
    scheduleDelayMs: delayNanos === undefined ? undefined : delayNanos / NANOS_PER_MILLI,
    ruleId: isRule ? (get(doc, 'rule.id') ?? savedObject('alert')?.id) : undefined,
    ruleName: isRule ? get(doc, 'rule.name') : undefined,
    ruleType: isRule ? (get(doc, 'kibana.alert.rule.rule_type_id') ?? get(doc, 'rule.category')) : undefined,
    connectorId: isAction ? (get(doc, 'kibana.action.id') ?? savedObject('action')?.id) : undefined,
    connectorName: isAction ? get(doc, 'kibana.action.name') : undefined,
    connectorType: isAction ? (get(doc, 'kibana.action.type_id') ?? savedObject('action')?.type_id) : undefined,
    relatedRuleId: get(doc, 'rule.id') ?? savedObject('alert')?.id,
    tags: toArray(get(doc, 'kibana.alert.rule.tags')).map(String),
    spaces: KibanaData.eventSpaces(doc),
  };
}

/** @type {(value: unknown) => unknown[]} */
function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function render() {
  if (!kibanaData) return;
  if (allEvents.length === 0) {
    output.replaceChildren(KibanaData.notLoaded('events'));
    return;
  }
  const selected = Site.selectedTags();
  const spaces = Site.selectedSpaces();
  events = allEvents.filter(function (event) {
    return Site.hasSelectedTags(eventTags(event), selected) && Site.inSelectedSpaces(event.spaces, spaces);
  });
  const tagFilter = Site.tagFilter(
    [...allEvents.flatMap(eventTags), ...(kibanaData ? KibanaData.allTags(kibanaData) : [])],
    Site.isFiltered()
      ? `showing ${formatNumber(events.length)} of ${formatNumber(allEvents.length)} documents` +
        (selected.length > 0 ? ', those with the tags, or whose rules have them, when the rules are loaded' : '')
      : undefined,
    kibanaData ? KibanaData.allSpaces(kibanaData) : []);
  if (events.length === 0) {
    output.replaceChildren(tagFilter ?? '', h('p', { class: 'muted' }, 'None of the documents have the selected rule tags and spaces.'));
    return;
  }

  const times = events.map(function (event) { return event.time?.getTime(); })
    .filter(function (time) { return time !== undefined; })
    .map(Number);
  const from = times.length ? new Date(Math.min(...times)) : undefined;
  const to = times.length ? new Date(Math.max(...times)) : undefined;
  const range = Site.timeRange(from, to);

  output.replaceChildren(
    tagFilter ?? '',
    renderSummary(from, to, range),
    section('findings', Site.findingsList(analyze())),
    renderTimeline(from, to),
    section('providers and actions', renderActions(range)),
    section('errors', renderErrors(range)),
    section('task runs', renderTaskRuns(range)),
    section('rule executions', renderRules(range)),
    section('connector executions', renderConnectors(range)),
    section('Kibana servers', renderServers(range)),
  );
}

/** @type {(from: Date | undefined, to: Date | undefined, range: { from: string; to: string }) => HTMLElement} */
function renderSummary(from, to, range) {
  const versions = distinct(events.map(function (event) { return event.version; }));
  return section('summary',
    h('div', { class: 'cards' },
      card('documents', formatNumber(events.length)),
      card('from', formatDate(from)),
      card('to', formatDate(to)),
      card('time span', from && to ? formatMillis(to.getTime() - from.getTime()) : ''),
      card('providers', formatNumber(distinct(events.map(function (event) { return event.provider; })).length)),
      card('Kibana servers', formatNumber(distinct(events.map(function (event) { return event.server; })).length)),
      card('Kibana versions', versions.join(', ')),
      card('errors', formatNumber(events.filter(function (event) { return event.error; }).length)),
    ),
    h('p', {}, Site.discoverLink('open these documents in Discover', {
      tabLabel: 'event log',
      ...range,
      columns: ['event.provider', 'event.action', 'event.outcome', 'event.duration', 'message'],
      breakdown: 'event.provider',
    }), h('span', { class: 'muted' }, ' (uses the Kibana URL and data view in the settings)')),
  );
}

/** @type {(label: string, value: Child) => HTMLElement} */
function card(label, value) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-label' }, label),
    h('div', { class: 'card-value' }, value),
  );
}

/**
 * Columns for the count, failures, and duration statistics of a group of events.
 * @template {{ events: LogEvent[] }} T
 * @returns {Column<T>[]}
 */
function outcomeColumns() {
  return [
    { label: 'count', value: function (row) { return row.events.length; }, numeric: true },
    { label: 'failures', value: function (row) { return failures(row.events); }, numeric: true,
      cellClass: function (row) { return failures(row.events) > 0 ? 'cell-warn' : undefined; } },
    { label: 'failure %', value: function (row) { return failurePercent(row.events); }, numeric: true,
      render: function (row) { return formatPercent(failurePercent(row.events)); } },
    ...durationColumns('duration', function (/** @type {T} */ row) {
      return row.events.map(function (event) { return event.durationMs; });
    }),
  ];
}

/**
 * Columns for the p50, p99, and max of the durations in ms.
 * @template T
 * @param {string} label
 * @param {(row: T) => unknown[]} values
 * @returns {Column<T>[]}
 */
function durationColumns(label, values) {
  // statistics are computed once per row, since sorting asks for them repeatedly
  /** @type {WeakMap<object, Stats | undefined>} */
  const cache = new WeakMap();
  /** @type {(row: T) => Stats | undefined} */
  function rowStats(row) {
    const key = /** @type {object} */ (row);
    if (!cache.has(key)) cache.set(key, stats(values(row)));
    return cache.get(key);
  }
  /** @type {(name: 'p50' | 'p99' | 'max') => Column<T>} */
  function column(name) {
    return {
      label: `${label} ${name}`,
      value: function (row) { return rowStats(row)?.[name]; },
      render: function (row) { return formatMillis(rowStats(row)?.[name]); },
      numeric: true,
    };
  }
  return [column('p50'), column('p99'), column('max')];
}

/** @type {(range: { from: string; to: string }) => HTMLElement} */
function renderActions(range) {
  const rows = [...groupBy(events, function (event) { return `${event.provider}\n${event.action}`; }).values()]
    .map(function (group) { return { provider: group[0].provider, action: group[0].action, events: group }; });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'provider', value: function (row) { return row.provider; } },
    { label: 'action', value: function (row) { return row.action; } },
    ...outcomeColumns(),
    { label: 'Discover', value: function () { return ''; }, render: function (row) {
      return Site.discoverLink('documents', {
        tabLabel: `${row.provider} ${row.action}`,
        ...range,
        filters: [Site.isFilter('event.provider', row.provider), Site.isFilter('event.action', row.action)],
        columns: ['event.outcome', 'event.duration', 'message', 'error.message'],
        breakdown: 'event.outcome',
      });
    } },
  ];
  return table(columns, rows, { sortBy: 2, descending: true });
}

/** @type {(range: { from: string; to: string }) => HTMLElement} */
function renderErrors(range) {
  const withErrors = events.filter(function (event) { return event.error; });
  if (withErrors.length === 0) return h('p', { class: 'muted' }, 'no documents with error.message');

  const rows = [...groupBy(withErrors, function (event) { return `${event.provider}\n${event.action}\n${event.error}`; }).values()]
    .map(function (group) {
      const times = group.map(function (event) { return event.time?.getTime(); }).filter(Boolean).map(Number);
      return {
        provider: group[0].provider,
        action: group[0].action,
        error: /** @type {string} */ (group[0].error),
        count: group.length,
        first: times.length ? new Date(Math.min(...times)) : undefined,
        last: times.length ? new Date(Math.max(...times)) : undefined,
      };
    });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'count', value: function (row) { return row.count; }, numeric: true },
    { label: 'provider', value: function (row) { return row.provider; } },
    { label: 'action', value: function (row) { return row.action; } },
    { label: 'error.message', value: function (row) { return row.error; }, render: function (row) {
      return h('div', { class: 'wrap mono' }, truncate(row.error, 1000));
    } },
    { label: 'first', value: function (row) { return formatDate(row.first); } },
    { label: 'last', value: function (row) { return formatDate(row.last); } },
    { label: 'Discover', value: function () { return ''; }, render: function (row) {
      return Site.discoverLink('documents', {
        tabLabel: `errors: ${row.provider} ${row.action}`,
        ...range,
        filters: [
          Site.isFilter('event.provider', row.provider),
          Site.isFilter('event.action', row.action),
          Site.isFilter('error.message', row.error),
        ],
        columns: ['event.outcome', 'message', 'error.message'],
      });
    } },
  ];
  return table(columns, rows, { sortBy: 0, descending: true, filter: true });
}

/** @type {(range: { from: string; to: string }) => HTMLElement} */
function renderTaskRuns(range) {
  const runs = events.filter(function (event) { return event.provider === 'taskManager' && event.action === 'task-run'; });
  if (runs.length === 0) return h('p', { class: 'muted' }, 'no taskManager task-run documents');

  const rows = [...groupBy(runs, function (event) { return event.taskType || 'unknown'; }).entries()]
    .map(function ([type, group]) { return { type, events: group }; });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'task type', value: function (row) { return row.type; }, render: function (row) { return h('span', { class: 'mono' }, row.type); } },
    ...outcomeColumns(),
    ...durationColumns('schedule delay', function (/** @type {Row} */ row) {
      return row.events.map(function (event) { return event.scheduleDelayMs; });
    }),
    { label: 'Discover', value: function () { return ''; }, render: function (row) {
      return Site.discoverLink('task runs', {
        tabLabel: `task runs: ${row.type}`,
        ...range,
        filters: [
          Site.isFilter('event.provider', 'taskManager'),
          Site.isFilter('event.action', 'task-run'),
          Site.isFilter('kibana.task.type', row.type),
        ],
        columns: ['kibana.task.id', 'event.outcome', 'kibana.task.schedule_delay', 'event.duration', 'error.message'],
        breakdown: 'event.outcome',
      });
    } },
  ];
  return h('div', {},
    h('p', { class: 'muted' }, 'Schedule delay is how late a task started, compared to when it was scheduled.'),
    table(columns, rows, { sortBy: 1, descending: true, filter: true }),
  );
}

/** @type {(range: { from: string; to: string }) => HTMLElement} */
function renderRules(range) {
  const ruleEvents = events.filter(function (event) { return event.ruleId; });
  if (ruleEvents.length === 0) return h('p', { class: 'muted' }, 'no alerting rule documents');

  const rows = [...groupBy(ruleEvents, function (event) { return /** @type {string} */ (event.ruleId); }).entries()]
    .map(function ([id, group]) {
      const executions = group.filter(function (event) { return event.action === 'execute'; });
      /** @type {(field: string) => number[]} */
      function metric(field) {
        return executions.map(function (event) { return toNumber(get(event.doc, `kibana.alert.rule.execution.metrics.${field}`)); })
          .filter(function (value) { return value !== undefined; })
          .map(Number);
      }
      const gaps = metric('execution_gap_duration_s').filter(function (value) { return value > 0; });
      const lastError = [...executions].reverse().find(function (event) { return event.error; })?.error;
      return {
        id,
        name: group.find(function (event) { return event.ruleName; })?.ruleName,
        type: group.find(function (event) { return event.ruleType; })?.ruleType,
        events: executions,
        timeouts: group.filter(function (event) { return event.action === 'execute-timeout'; }).length,
        searchMs: stats(metric('total_search_duration_ms'))?.avg,
        newAlerts: sum(metric('alert_counts.new')),
        maxActiveAlerts: stats(metric('alert_counts.active'))?.max,
        triggeredActions: sum(metric('number_of_triggered_actions')),
        gaps: gaps.length,
        maxGapMs: gaps.length ? Math.max(...gaps) * 1000 : undefined,
        lastError,
      };
    });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'rule', value: function (row) { return row.name || row.id; }, render: function (row) {
      const label = row.name || h('span', { class: 'mono' }, row.id);
      return kibanaData?.rulesById.has(row.id)
        ? KibanaData.link('rules', row.id, label)
        : h('span', { title: row.id }, label);
    } },
    { label: 'rule type', value: function (row) { return row.type; }, render: function (row) { return h('span', { class: 'mono' }, row.type); } },
    ...outcomeColumns(),
    { label: 'timeouts', value: function (row) { return row.timeouts; }, numeric: true,
      cellClass: function (row) { return row.timeouts > 0 ? 'cell-warn' : undefined; } },
    { label: 'avg search', value: function (row) { return row.searchMs; }, numeric: true,
      render: function (row) { return formatMillis(row.searchMs); }, title: 'average of total_search_duration_ms' },
    { label: 'new alerts', value: function (row) { return row.newAlerts; }, numeric: true },
    { label: 'max active alerts', value: function (row) { return row.maxActiveAlerts; }, numeric: true },
    { label: 'triggered actions', value: function (row) { return row.triggeredActions; }, numeric: true },
    { label: 'gaps', value: function (row) { return row.gaps; }, numeric: true, title: 'executions with an execution gap',
      cellClass: function (row) { return row.gaps > 0 ? 'cell-warn' : undefined; } },
    { label: 'max gap', value: function (row) { return row.maxGapMs; }, numeric: true, render: function (row) { return formatMillis(row.maxGapMs); } },
    { label: 'last error', value: function (row) { return row.lastError; }, render: function (row) {
      return row.lastError ? h('div', { class: 'wrap mono', title: row.lastError }, truncate(row.lastError, 200)) : '';
    } },
    { label: 'Discover', value: function () { return ''; }, render: function (row) {
      return Site.discoverLink('executions', {
        tabLabel: `rule: ${row.name || row.id}`,
        ...range,
        filters: [Site.isFilter('event.provider', 'alerting'), Site.isFilter('rule.id', row.id)],
        columns: ['event.action', 'event.outcome', 'event.duration', 'kibana.alert.rule.execution.metrics.total_search_duration_ms', 'error.message'],
        breakdown: 'event.action',
      });
    } },
  ];
  return h('div', {},
    h('p', { class: 'muted' }, 'Counts, failures, durations, and metrics are of the execute documents of each rule.'),
    table(columns, rows, { sortBy: 2, descending: true, filter: true }),
  );
}

/** @type {(range: { from: string; to: string }) => HTMLElement} */
function renderConnectors(range) {
  const executions = events.filter(function (event) { return event.provider === 'actions' && event.action === 'execute'; });
  if (executions.length === 0) return h('p', { class: 'muted' }, 'no actions execute documents');

  const rows = [...groupBy(executions, function (event) { return event.connectorId || 'unknown'; }).entries()]
    .map(function ([id, group]) {
      return {
        id,
        name: group.find(function (event) { return event.connectorName; })?.connectorName,
        type: group.find(function (event) { return event.connectorType; })?.connectorType,
        hasActionId: group.some(function (event) { return get(event.doc, 'kibana.action.id') != null; }),
        events: group,
        lastError: [...group].reverse().find(function (event) { return event.error; })?.error,
      };
    });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'connector', value: function (row) { return row.name || row.id; }, render: function (row) {
      const label = row.name || h('span', { class: 'mono' }, row.id);
      return kibanaData?.connectorsById.has(row.id)
        ? KibanaData.link('connectors', row.id, label)
        : h('span', { title: row.id }, label);
    } },
    { label: 'connector type', value: function (row) { return row.type; }, render: function (row) { return h('span', { class: 'mono' }, row.type); } },
    ...outcomeColumns(),
    { label: 'last error', value: function (row) { return row.lastError; }, render: function (row) {
      return row.lastError ? h('div', { class: 'wrap mono', title: row.lastError }, truncate(row.lastError, 200)) : '';
    } },
    { label: 'Discover', value: function () { return ''; }, render: function (row) {
      // older documents only have the connector id in the nested kibana.saved_objects
      const params = row.hasActionId
        ? { filters: [Site.isFilter('event.provider', 'actions'), Site.isFilter('kibana.action.id', row.id)] }
        : { kql: `event.provider: "actions" and kibana.saved_objects: { type: "action" and id: ${kqlString(row.id)} }` };
      return Site.discoverLink('executions', {
        tabLabel: `connector: ${row.name || row.id}`,
        ...range,
        ...params,
        columns: ['event.action', 'event.outcome', 'event.duration', 'error.message'],
      });
    } },
  ];
  return table(columns, rows, { sortBy: 2, descending: true, filter: true });
}

/** @type {(range: { from: string; to: string }) => HTMLElement} */
function renderServers(range) {
  const rows = [...groupBy(events, function (event) { return event.server; }).entries()]
    .map(function ([server, group]) {
      const times = group.map(function (event) { return event.time?.getTime(); }).filter(Boolean).map(Number);
      return {
        server,
        version: group.find(function (event) { return event.version; })?.version,
        events: group,
        taskRuns: group.filter(function (event) { return event.action === 'task-run'; }).length,
        ruleExecutions: group.filter(function (event) { return event.provider === 'alerting' && event.action === 'execute'; }).length,
        first: times.length ? new Date(Math.min(...times)) : undefined,
        last: times.length ? new Date(Math.max(...times)) : undefined,
      };
    });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'kibana.server_uuid', value: function (row) { return row.server; }, render: function (row) { return h('span', { class: 'mono' }, row.server); } },
    { label: 'version', value: function (row) { return row.version; } },
    { label: 'documents', value: function (row) { return row.events.length; }, numeric: true },
    { label: 'failures', value: function (row) { return failures(row.events); }, numeric: true },
    { label: 'task runs', value: function (row) { return row.taskRuns; }, numeric: true },
    { label: 'rule executions', value: function (row) { return row.ruleExecutions; }, numeric: true },
    { label: 'first', value: function (row) { return formatDate(row.first); } },
    { label: 'last', value: function (row) { return formatDate(row.last); } },
    { label: 'Discover', value: function () { return ''; }, render: function (row) {
      return Site.discoverLink('documents', {
        tabLabel: `server: ${row.server}`,
        ...range,
        filters: [Site.isFilter('kibana.server_uuid', row.server)],
        columns: ['event.provider', 'event.action', 'event.outcome', 'event.duration', 'message'],
        breakdown: 'event.provider',
      });
    } },
  ];
  return table(columns, rows, { sortBy: 2, descending: true });
}

// ---------------------------------------------------------------------------
// timeline chart
// ---------------------------------------------------------------------------

const INTERVALS = [1, 5, 10, 30, 60, 300, 600, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 7 * 86400]
  .map(function (seconds) { return seconds * 1000; });

/** @type {(from: Date | undefined, to: Date | undefined) => HTMLElement} */
function renderTimeline(from, to) {
  if (!from || !to) return section('timeline', h('p', { class: 'muted' }, 'no documents with @timestamp'));

  const span = Math.max(1000, to.getTime() - from.getTime());
  const interval = INTERVALS.find(function (ms) { return span / ms <= 80; }) || INTERVALS[INTERVALS.length - 1];
  const start = Math.floor(from.getTime() / interval) * interval;
  const bucketCount = Math.floor((to.getTime() - start) / interval) + 1;

  const groupKey = CHART_GROUPS[chartGroup].key;
  const totals = new Map();
  for (const event of events) totals.set(groupKey(event), (totals.get(groupKey(event)) || 0) + 1);
  const top = [...totals.entries()].sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, COLORS.length)
    .map(function (entry) { return entry[0]; });
  const groups = totals.size > top.length ? [...top, 'other'] : top;
  /** @type {(event: LogEvent) => string} */
  function groupOf(event) {
    const key = groupKey(event);
    return top.includes(key) ? key : 'other';
  }
  /** @type {(group: string) => string} */
  function colorOf(group) {
    const index = top.indexOf(group);
    return index === -1 ? OTHER_COLOR : COLORS[index];
  }

  /** @type {Map<string, number>[]} */
  const buckets = Array.from({ length: bucketCount }, function () { return new Map(); });
  for (const event of events) {
    if (!event.time) continue;
    const bucket = buckets[Math.floor((event.time.getTime() - start) / interval)];
    const group = groupOf(event);
    bucket.set(group, (bucket.get(group) || 0) + 1);
  }
  const max = Math.max(1, ...buckets.map(function (bucket) { return sum([...bucket.values()]); }));

  const width = 1000;
  const height = 160;
  const left = 40;
  const barWidth = (width - left) / bucketCount;
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height + 20}`, class: 'chart' });
  svg.append(
    svgElement('line', { x1: left, y1: height, x2: width, y2: height, class: 'axis' }),
    svgElement('text', { x: 0, y: 10 }, formatNumber(max)),
    svgElement('text', { x: 0, y: height }, '0'),
    svgElement('text', { x: left, y: height + 15 }, formatDate(new Date(start))),
    svgElement('text', { x: width, y: height + 15, 'text-anchor': 'end' }, formatDate(new Date(start + bucketCount * interval))),
  );

  buckets.forEach(function (bucket, index) {
    let y = height;
    const time = formatDate(new Date(start + index * interval));
    for (const group of groups) {
      const count = bucket.get(group) || 0;
      if (count === 0) continue;
      const barHeight = (count / max) * height;
      y -= barHeight;
      const rect = svgElement('rect', {
        x: left + index * barWidth + 0.5,
        y,
        width: Math.max(1, barWidth - 1),
        height: barHeight,
        fill: colorOf(group),
      });
      rect.append(svgElement('title', {}, `${time}\n${group}: ${formatNumber(count)}`));
      svg.append(rect);
    }
  });

  const select = h('select', {
    onchange: function () {
      chartGroup = /** @type {ChartGroup} */ (select.value);
      render();
    },
  }, Object.entries(CHART_GROUPS).map(function ([key, value]) {
    return h('option', { value: key, selected: key === chartGroup }, value.label);
  }));

  return section('timeline',
    h('p', {}, `documents per ${formatMillis(interval)}, by `, select),
    svg,
    h('div', { class: 'legend' }, groups.map(function (group) {
      return h('span', {}, h('span', { class: 'legend-swatch', style: `background: ${colorOf(group)}` }), group);
    })),
  );
}

/** @type {(tag: string, attrs: Record<string, string | number>, text?: string) => SVGElement} */
function svgElement(tag, attrs, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  if (text != null) element.textContent = text;
  return element;
}

// ---------------------------------------------------------------------------
// analysis
// ---------------------------------------------------------------------------

/**
 * Notable things in the documents.  These use rules of thumb, which are
 * noted in the messages.
 * @type {() => Finding[]}
 */
function analyze() {
  /** @type {Finding[]} */
  const findings = [];

  if (!events.some(function (event) { return event.provider !== 'unknown'; })) {
    findings.push({ level: 'warn', message: 'none of the documents have event.provider; are they event log documents?' });
  }
  const untimed = events.filter(function (event) { return !event.time; }).length;
  if (untimed > 0) {
    findings.push({ level: 'info', message: `${formatNumber(untimed)} documents don't have @timestamp` });
  }

  for (const group of groupBy(events, function (event) { return `${event.provider} ${event.action}`; }).values()) {
    const count = failures(group);
    if (count === 0) continue;
    const percent = failurePercent(group) || 0;
    findings.push({
      level: percent >= 10 ? 'warn' : 'info',
      message: `${formatNumber(count)} of ${formatNumber(group.length)} ${group[0].provider} ${group[0].action} ` +
        `documents failed (${formatPercent(percent)})`,
    });
  }

  const timeouts = events.filter(function (event) { return event.provider === 'alerting' && event.action === 'execute-timeout'; });
  if (timeouts.length > 0) {
    const rules = distinct(timeouts.map(function (event) { return event.ruleName || event.ruleId; }));
    findings.push({ level: 'warn', message: `${formatNumber(timeouts.length)} rule executions timed out, for rules: ${list(rules)}` });
  }

  const gaps = events.filter(function (event) {
    return (toNumber(get(event.doc, 'kibana.alert.rule.execution.metrics.execution_gap_duration_s')) || 0) > 0;
  });
  if (gaps.length > 0) {
    const rules = distinct(gaps.map(function (event) { return event.ruleName || event.ruleId; }));
    findings.push({ level: 'warn', message: `${formatNumber(gaps.length)} rule executions had execution gaps, for rules: ${list(rules)}` });
  }

  const runs = events.filter(function (event) { return event.action === 'task-run'; });
  const late = [...groupBy(runs, function (event) { return event.taskType || 'unknown'; }).entries()]
    .map(function ([type, group]) {
      return { type, p99: stats(group.map(function (event) { return event.scheduleDelayMs; }))?.p99 };
    })
    .filter(function (entry) { return (entry.p99 || 0) > 60 * 1000; })
    .sort(function (a, b) { return (b.p99 || 0) - (a.p99 || 0); });
  if (late.length > 0) {
    findings.push({
      level: 'warn',
      message: `${late.length} task types have a schedule delay p99 over 1 minute (rule of thumb): ` +
        list(late.map(function (entry) { return `${entry.type} (${formatMillis(entry.p99)})`; })),
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} key
 * @returns {Map<string, T[]>}
 */
function groupBy(items, key) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    const group = groups.get(value);
    if (group) group.push(item);
    else groups.set(value, [item]);
  }
  return groups;
}

/** @type {(values: unknown[]) => string[]} */
function distinct(values) {
  return [...new Set(values.filter(function (value) { return value != null && value !== ''; }).map(String))].sort();
}

/** @type {(values: number[]) => number} */
function sum(values) {
  return values.reduce(function (total, value) { return total + value; }, 0);
}

/** @type {(events: LogEvent[]) => number} */
function failures(events) {
  return events.filter(function (event) { return event.outcome === 'failure'; }).length;
}

/** @type {(events: LogEvent[]) => number | undefined} */
function failurePercent(events) {
  return events.length === 0 ? undefined : (failures(events) / events.length) * 100;
}

/** @type {(items: string[]) => string} */
function list(items) {
  const shown = items.slice(0, 10);
  const more = items.length - shown.length;
  return shown.join(', ') + (more > 0 ? `, and ${more} more` : '');
}

/** @type {(text: string, length: number) => string} */
function truncate(text, length) {
  return text.length <= length ? text : `${text.slice(0, length)}...`;
}

/** @type {(text: string) => string} */
function kqlString(text) {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}

})();
