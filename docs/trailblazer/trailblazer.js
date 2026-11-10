// @ts-check

// TrailBlazer: browse the loaded data by following the links between its
// records.  Each selection opens a pane to the right of the pane it was made
// in, replacing the panes after it.  The trail is kept in the URL hash, so
// it's restored when the page is reloaded.
//
// Searches are lists of conditions, run over the loaded records rather than
// Elasticsearch, so they only find what was loaded.

'use strict';

(function () {

const { h } = Site;

const HEALTH_KEY = 'task-manager-health';
// rows shown in a list before its "show more" button
const LIST_LIMIT = 200;
const VALUE_LIMIT = 100;
const HISTOGRAM_BARS = 40;
const MAX_STEPS = 50;

/** @typedef {'rules' | 'connectors' | 'alerts' | 'events' | 'health'} Collection */
/** @typedef {string | number | boolean | null} Primitive */
/** @typedef {{ path: string; value: Primitive }} FlatField */

/**
 * A loaded record.  doc is what's browsed: the document or API response.
 * tags and spaces are the rule tags and spaces, for the records the filters
 * apply to.
 * @typedef {{
 *   collection: Collection;
 *   key: string;
 *   title: string;
 *   subtitle: string;
 *   time: string | undefined;
 *   tags: string[] | undefined;
 *   spaces: string[] | undefined;
 *   doc: any;
 *   record: any;
 * }} Item
 */

/**
 * A condition of a search.  The ones besides equals, missing, and range are
 * for links that a field's value can't express.
 * @typedef {{ kind: 'equals'; field: string; value: Primitive }
 *   | { kind: 'missing'; field: string }
 *   | { kind: 'range'; field: string; from: string; to: string }
 *   | { kind: 'savedObject'; type: string; id: string }
 *   | { kind: 'connector'; id: string }
 *   | { kind: 'ruleType'; type: string }} Condition
 */

/** @typedef {{ collection: Collection; conditions: Condition[] }} Search */

/**
 * A pane of the trail, as saved in the URL hash.
 * @typedef {{ pane: 'search'; search: Search }
 *   | { pane: 'record'; collection: Collection; key: string; search: Search | undefined }
 *   | { pane: 'field'; search: Search; field: string }} Step
 */

/**
 * @typedef {{
 *   element: HTMLElement;
 *   title: () => string;
 *   step: Step | undefined;
 *   focus: () => void;
 * }} Pane
 */

/**
 * A row of a list.  text is what the list's filter matches.
 * @typedef {{
 *   key: string;
 *   label: Child;
 *   meta?: Child;
 *   count?: string;
 *   badge?: string;
 *   group?: string;
 *   text?: string;
 *   disabled?: boolean;
 *   onSelect?: () => void;
 * }} Row
 */

/**
 * The loaded records.  items and byKey have the ones with the selected rule
 * tags, and all has every one.
 * @typedef {{
 *   data: KibanaDataSets;
 *   items: Record<Collection, Item[]>;
 *   byKey: Record<Collection, Map<string, Item>>;
 *   all: Record<Collection, Item[]>;
 *   allByKey: Record<Collection, Map<string, Item>>;
 * }} Loaded
 */

/** @type {Record<Collection, { title: string; one: string; many: string; kind: DataKind | undefined }>} */
const COLLECTIONS = {
  rules: { title: 'rules', one: 'rule', many: 'rules', kind: 'rules' },
  connectors: { title: 'connectors', one: 'connector', many: 'connectors', kind: 'connectors' },
  alerts: { title: 'alerts', one: 'alert', many: 'alerts', kind: 'alerts' },
  events: { title: 'event log', one: 'event log document', many: 'event log documents', kind: 'events' },
  health: { title: 'Task Manager health', one: 'health report', many: 'Task Manager health report', kind: undefined },
};
/** @type {Collection[]} */
const COLLECTION_NAMES = ['rules', 'connectors', 'alerts', 'events', 'health'];

// ---------------------------------------------------------------------------
// the loaded data
// ---------------------------------------------------------------------------

/** @type {() => Promise<Loaded>} */
async function loadData() {
  const data = await KibanaData.load();
  /** @type {Record<Collection, Item[]>} */
  const all = {
    rules: (data.rules?.records ?? []).map(ruleItem),
    connectors: (data.connectors?.records ?? []).map(connectorItem),
    alerts: (data.alerts?.records ?? []).map(function (alert) { return alertItem(alert, KibanaData.alertTags(data, alert)); }),
    events: (data.events?.records ?? []).map(function (doc, index) { return eventItem(doc, index, eventTags(data, doc)); }),
    health: healthItems(),
  };
  const selected = Site.selectedTags();
  const spaces = Site.selectedSpaces();
  /** @type {any} */
  const items = {};
  /** @type {any} */
  const byKey = {};
  /** @type {any} */
  const allByKey = {};
  for (const collection of COLLECTION_NAMES) {
    items[collection] = all[collection].filter(function (item) {
      return (!item.tags || Site.hasSelectedTags(item.tags, selected)) && (!item.spaces || Site.inSelectedSpaces(item.spaces, spaces));
    });
    byKey[collection] = keyed(items[collection]);
    allByKey[collection] = keyed(all[collection]);
  }
  return { data, items, byKey, all, allByKey };

  /** @type {(items: Item[]) => Map<string, Item>} */
  function keyed(items) {
    return new Map(items.map(function (item) { return [item.key, item]; }));
  }
}

/**
 * An event log document's rule tags: its own, and those of the rules it's for.
 * @type {(data: KibanaDataSets, doc: any) => string[]}
 */
function eventTags(data, doc) {
  const tags = Site.get(doc, 'kibana.alert.rule.tags');
  const savedObjects = Site.get(doc, 'kibana.saved_objects');
  const ruleIds = [
    Site.get(doc, 'rule.id'),
    ...(Array.isArray(savedObjects) ? savedObjects : [])
      .filter(function (so) { return so?.type === 'alert'; })
      .map(function (so) { return so.id; }),
  ];
  return [...new Set([
    ...(Array.isArray(tags) ? tags : tags == null ? [] : [tags]).map(String),
    ...ruleIds.flatMap(function (id) { return typeof id === 'string' ? data.rulesById.get(id)?.tags ?? [] : []; }),
  ])];
}

/** @type {(...parts: unknown[]) => string} */
function joined(...parts) {
  return parts.filter(function (part) { return part != null && part !== '' && part !== false; }).join(' · ');
}

/** @type {(text: unknown, length: number) => string} */
function truncate(text, length) {
  const value = String(text ?? '');
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

/** @type {(rule: Rule) => Item} */
function ruleItem(rule) {
  return {
    collection: 'rules',
    key: rule.id,
    title: rule.name || rule.id,
    subtitle: joined(rule.type, rule.space && `space ${rule.space}`, rule.enabled ? undefined : 'disabled'),
    time: rule.lastRunAt,
    tags: rule.tags,
    spaces: KibanaData.recordSpaces(rule),
    doc: rule.doc ?? rule,
    record: rule,
  };
}

/** @type {(connector: Connector) => Item} */
function connectorItem(connector) {
  return {
    collection: 'connectors',
    key: connector.id,
    title: connector.name || connector.id,
    subtitle: joined(connector.type, connector.preconfigured && 'preconfigured', connector.system && 'system',
      connector.space && `space ${connector.space}`),
    time: connector.updatedAt,
    tags: undefined,
    spaces: KibanaData.recordSpaces(connector),
    doc: connector.doc ?? connector,
    record: connector,
  };
}

/** @type {(alert: Alert, tags: string[]) => Item} */
function alertItem(alert, tags) {
  return {
    collection: 'alerts',
    key: alert.uuid,
    title: `${alert.ruleName ?? alert.ruleId ?? 'unknown rule'}: ${alert.instanceId ?? alert.uuid}`,
    subtitle: joined(alert.status, Site.formatDate(alert.time)),
    time: alert.time,
    tags,
    spaces: alert.spaces,
    doc: alert.doc ?? alert,
    record: alert,
  };
}

/** @type {(doc: any, index: number, tags: string[]) => Item} */
function eventItem(doc, index, tags) {
  const time = Site.get(doc, '@timestamp');
  return {
    collection: 'events',
    key: String(index),
    title: joined(Site.get(doc, 'event.provider'), Site.get(doc, 'event.action'), Site.get(doc, 'event.outcome')) || 'event',
    subtitle: joined(Site.formatDate(time), truncate(Site.get(doc, 'message'), 100)),
    time: typeof time === 'string' ? time : undefined,
    tags,
    spaces: KibanaData.eventSpaces(doc),
    doc,
    record: doc,
  };
}

/** @type {() => Item[]} */
function healthItems() {
  const input = Site.loadInput(HEALTH_KEY);
  if (!input) return [];
  /** @type {any} */
  const report = Site.parseJsonValues(input.text).find(function (value) {
    return value != null && typeof value === 'object' && 'stats' in value;
  });
  if (!report) return [];
  return [{
    collection: 'health',
    key: 'report',
    title: 'health report',
    subtitle: joined(report.status, Site.formatDate(report.last_update)),
    time: report.last_update,
    tags: undefined,
    spaces: undefined,
    doc: report,
    record: report,
  }];
}

// ---------------------------------------------------------------------------
// fields and searches
// ---------------------------------------------------------------------------

/** @type {WeakMap<object, FlatField[]>} */
const flattened = new WeakMap();
/** @type {WeakMap<object, Map<string, Primitive[]>>} */
const fieldValues = new WeakMap();

/**
 * A document's fields, with dotted paths; the elements of arrays share their
 * array's path.
 * @type {(doc: any) => FlatField[]}
 */
function flatten(doc) {
  let fields = flattened.get(doc);
  if (fields) return fields;
  /** @type {FlatField[]} */
  const result = [];
  visit(doc, '');
  fields = result.sort(function (a, b) { return a.path.localeCompare(b.path); });
  flattened.set(doc, fields);
  return fields;

  /** @type {(value: unknown, path: string) => void} */
  function visit(value, path) {
    if (Array.isArray(value)) {
      for (const element of value) visit(element, path);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
    } else if (path && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
      result.push({ path, value: /** @type {Primitive} */ (value) });
    }
  }
}

/** @type {(doc: any, field: string) => Primitive[]} */
function valuesOf(doc, field) {
  let byField = fieldValues.get(doc);
  if (!byField) {
    byField = new Map();
    for (const { path, value } of flatten(doc)) {
      const values = byField.get(path);
      if (values) values.push(value);
      else byField.set(path, [value]);
    }
    fieldValues.set(doc, byField);
  }
  return byField.get(field) ?? [];
}

/** @type {(item: Item, condition: Condition) => boolean} */
function matches(item, condition) {
  switch (condition.kind) {
    case 'equals':
      return valuesOf(item.doc, condition.field).includes(condition.value);
    case 'missing':
      return valuesOf(item.doc, condition.field).every(function (value) { return value === null; });
    case 'range': {
      const from = Date.parse(condition.from);
      const to = Date.parse(condition.to);
      return valuesOf(item.doc, condition.field).some(function (value) {
        const time = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : NaN;
        return time >= from && time < to;
      });
    }
    case 'savedObject': {
      const { type, id } = condition;
      const savedObjects = Site.get(item.doc, 'kibana.saved_objects');
      return Array.isArray(savedObjects) && savedObjects.some(function (so) { return so?.type === type && so?.id === id; });
    }
    case 'connector': {
      const { id } = condition;
      return item.collection === 'rules' && item.record.actions.some(function (/** @type {RuleAction} */ action) {
        return action.connectorId === id;
      });
    }
    case 'ruleType':
      return item.collection === 'rules' && item.record.type === condition.type;
  }
}

/** @type {(loaded: Loaded, search: Search) => Item[]} */
function run(loaded, search) {
  return loaded.items[search.collection].filter(function (item) {
    return search.conditions.every(function (condition) { return matches(item, condition); });
  });
}

/** @type {(search: Search, condition: Condition) => Search} */
function refine(search, condition) {
  const key = JSON.stringify(condition);
  if (search.conditions.some(function (c) { return JSON.stringify(c) === key; })) return search;
  return { collection: search.collection, conditions: [...search.conditions, condition] };
}

/** @type {(condition: Condition) => string} */
function conditionText(condition) {
  switch (condition.kind) {
    case 'equals': return `${condition.field}: ${JSON.stringify(condition.value)}`;
    case 'missing': return `not ${condition.field}: *`;
    case 'range': return `${condition.field} >= "${condition.from}" and ${condition.field} < "${condition.to}"`;
    case 'savedObject': return `kibana.saved_objects: { type: "${condition.type}" and id: "${condition.id}" }`;
    case 'connector': return `actions use connector "${condition.id}"`;
    case 'ruleType': return `rule type "${condition.type}"`;
  }
}

/** @type {(search: Search) => string} */
function searchText(search) {
  return search.conditions.length === 0 ? `all ${COLLECTIONS[search.collection].title}` : search.conditions.map(conditionText).join(' and ');
}

/** @type {(value: Primitive) => string} */
function esqlValue(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * A link to the search's documents in Discover: event log searches use the
 * event log data view and KQL, and alert searches use ES|QL.
 * @type {(search: Search, items: Item[]) => HTMLElement | undefined}
 */
function discoverLink(search, items) {
  const times = items.map(function (item) { return Site.toDate(item.time); }).filter(function (time) { return time !== undefined; });
  const range = Site.timeRange(
    times.length ? new Date(Math.min(...times.map(Number))) : undefined,
    times.length ? new Date(Math.max(...times.map(Number))) : undefined);
  const tabLabel = `TrailBlazer: ${truncate(searchText(search), 60)}`;

  if (search.collection === 'events') {
    if (search.conditions.some(function (c) { return c.kind === 'connector' || c.kind === 'ruleType'; })) return undefined;
    return Site.discoverLink('open in Discover', {
      tabLabel,
      ...range,
      kql: search.conditions.map(conditionText).join(' and ') || undefined,
      columns: ['event.provider', 'event.action', 'event.outcome', 'message'],
    });
  }

  if (search.collection === 'alerts') {
    /** @type {string[]} */
    const where = [];
    for (const condition of search.conditions) {
      if (condition.kind === 'equals') where.push(`\`${condition.field}\` == ${esqlValue(condition.value)}`);
      else if (condition.kind === 'missing') where.push(`\`${condition.field}\` IS NULL`);
      else if (condition.kind === 'range') {
        where.push(`\`${condition.field}\` >= TO_DATETIME("${condition.from}") AND \`${condition.field}\` < TO_DATETIME("${condition.to}")`);
      } else return undefined;
    }
    const esql = ['FROM .alerts-*', ...where.map(function (clause) { return `| WHERE ${clause}`; }),
      '| KEEP @timestamp, kibana.alert.rule.name, kibana.alert.instance.id, kibana.alert.status, kibana.alert.reason',
      '| SORT @timestamp DESC'].join('\n');
    return Site.discoverLink('open in Discover', { tabLabel, ...range, esql });
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// the links between records
// ---------------------------------------------------------------------------

/**
 * The rows for the records and searches related to an item.
 * @type {(ctx: Context, pane: Pane, item: Item) => Row[]}
 */
function related(ctx, pane, item) {
  const { loaded } = ctx;
  /** @type {Row[]} */
  const rows = [];
  const doc = item.doc;

  /** @type {(group: string, collection: Collection, key: string | undefined, label: string) => void} */
  function recordRow(group, collection, key, label) {
    if (key === undefined) return;
    const target = loaded.byKey[collection].get(key);
    if (rows.some(function (row) { return row.key === `${collection}:${key}`; })) return;
    rows.push(target
      ? {
        key: `${collection}:${key}`, group, label: target.title, meta: target.subtitle, badge: COLLECTIONS[collection].one,
        text: `${target.title} ${target.subtitle}`,
        onSelect: function () { ctx.openRecord(pane, target, undefined); },
      }
      : {
        key: `${collection}:${key}`, group, label: loaded.allByKey[collection].get(key)?.title ?? label,
        meta: loaded.allByKey[collection].has(key) ? 'hidden by the rule tags or spaces filter' : 'not in the loaded data',
        badge: COLLECTIONS[collection].one, disabled: true,
      });
  }

  /** @type {(group: string, label: string, search: Search) => void} */
  function searchRow(group, label, search) {
    const count = run(loaded, search).length;
    if (count === 0) return;
    rows.push({
      key: JSON.stringify(search), group, label, meta: searchText(search), count: Site.formatNumber(count),
      badge: COLLECTIONS[search.collection].title, text: `${label} ${searchText(search)}`,
      onSelect: function () { ctx.openSearch(pane, search); },
    });
  }

  /** @type {(field: string) => string | undefined} */
  function field(name) {
    const value = Site.get(doc, name);
    const first = Array.isArray(value) ? value[0] : value;
    return first == null ? undefined : String(first);
  }

  const executionUuid = field('kibana.alert.rule.execution.uuid');

  switch (item.collection) {
    case 'rules': {
      /** @type {Rule} */
      const rule = item.record;
      for (const action of rule.actions) {
        recordRow('connectors', 'connectors', action.connectorId, `${action.connectorType ?? 'connector'} ${action.connectorId}`);
      }
      searchRow('alerts', 'alerts of this rule', { collection: 'alerts', conditions: [{ kind: 'equals', field: 'kibana.alert.rule.uuid', value: rule.id }] });
      searchRow('event log', 'event log documents for this rule', { collection: 'events', conditions: [{ kind: 'savedObject', type: 'alert', id: rule.id }] });
      if (rule.scheduledTaskId) {
        searchRow('event log', 'runs of this rule\'s task', { collection: 'events', conditions: [{ kind: 'equals', field: 'kibana.task.id', value: rule.scheduledTaskId }] });
      }
      searchRow('rules', 'rules of the same type', { collection: 'rules', conditions: [{ kind: 'ruleType', type: rule.type }] });
      break;
    }
    case 'connectors': {
      /** @type {Connector} */
      const connector = item.record;
      for (const rule of loaded.data.rulesByConnector.get(connector.id) ?? []) recordRow('rules using it', 'rules', rule.id, rule.name);
      searchRow('event log', 'event log documents for this connector', { collection: 'events', conditions: [{ kind: 'savedObject', type: 'action', id: connector.id }] });
      break;
    }
    case 'alerts': {
      /** @type {Alert} */
      const alert = item.record;
      if (alert.ruleId) {
        recordRow('rule', 'rules', alert.ruleId, alert.ruleName ?? `rule ${alert.ruleId}`);
        searchRow('alerts', 'alerts of this rule', { collection: 'alerts', conditions: [{ kind: 'equals', field: 'kibana.alert.rule.uuid', value: alert.ruleId }] });
      }
      if (alert.instanceId && alert.ruleId) {
        searchRow('alerts', 'alerts of this rule with this alert id', {
          collection: 'alerts',
          conditions: [{ kind: 'equals', field: 'kibana.alert.rule.uuid', value: alert.ruleId }, { kind: 'equals', field: 'kibana.alert.instance.id', value: alert.instanceId }],
        });
      }
      if (executionUuid) {
        searchRow('alerts', 'alerts from the same rule run', { collection: 'alerts', conditions: [{ kind: 'equals', field: 'kibana.alert.rule.execution.uuid', value: executionUuid }] });
        searchRow('event log', 'event log documents for the rule run', { collection: 'events', conditions: [{ kind: 'equals', field: 'kibana.alert.rule.execution.uuid', value: executionUuid }] });
      }
      searchRow('event log', 'event log documents for this alert', { collection: 'events', conditions: [{ kind: 'equals', field: 'kibana.alert.uuid', value: alert.uuid }] });
      if (alert.ruleId) {
        searchRow('event log', 'event log documents for this rule', { collection: 'events', conditions: [{ kind: 'savedObject', type: 'alert', id: alert.ruleId }] });
      }
      break;
    }
    case 'events': {
      const savedObjects = Site.get(doc, 'kibana.saved_objects');
      for (const so of Array.isArray(savedObjects) ? savedObjects : []) {
        const id = so?.id == null ? undefined : String(so.id);
        const group = 'saved objects';
        if (so?.type === 'alert') recordRow(group, 'rules', id, `rule ${id}`);
        else if (so?.type === 'action') recordRow(group, 'connectors', id, `connector ${id}`);
        else if (id !== undefined) {
          rows.push({ key: `so:${so?.type}:${id}`, group, label: `${so?.type} ${id}`, meta: 'not in the loaded data', badge: String(so?.type), disabled: true });
        }
      }
      recordRow('alerts', 'alerts', field('kibana.alert.uuid'), `alert ${field('kibana.alert.uuid')}`);
      if (executionUuid) {
        searchRow('alerts', 'alerts from the rule run', { collection: 'alerts', conditions: [{ kind: 'equals', field: 'kibana.alert.rule.execution.uuid', value: executionUuid }] });
        searchRow('event log', 'event log documents for the rule run', { collection: 'events', conditions: [{ kind: 'equals', field: 'kibana.alert.rule.execution.uuid', value: executionUuid }] });
      }
      const taskId = field('kibana.task.id');
      if (taskId) {
        searchRow('event log', 'event log documents for the task', { collection: 'events', conditions: [{ kind: 'equals', field: 'kibana.task.id', value: taskId }] });
      }
      for (const so of Array.isArray(savedObjects) ? savedObjects : []) {
        if (so?.type == null || so?.id == null) continue;
        const type = so.type === 'alert' ? 'rule' : so.type === 'action' ? 'connector' : so.type;
        searchRow('event log', `event log documents for the ${type} ${so.id}`, {
          collection: 'events', conditions: [{ kind: 'savedObject', type: String(so.type), id: String(so.id) }],
        });
      }
      break;
    }
    case 'health': {
      const taskTypes = new Set([
        ...Object.keys(Site.get(doc, 'stats.workload.value.task_types') ?? {}),
        ...Object.keys(Site.get(doc, 'stats.runtime.value.execution.duration') ?? {}),
      ]);
      for (const taskType of [...taskTypes].sort()) {
        if (!taskType.startsWith('alerting:')) continue;
        const type = taskType.slice('alerting:'.length);
        searchRow('rules by task type', `rules of type ${type}`, { collection: 'rules', conditions: [{ kind: 'ruleType', type }] });
      }
      break;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// lists, tabs, and panes
// ---------------------------------------------------------------------------

/**
 * A keyboard-navigable list, with one selected row.  Up and down select the
 * previous and next rows, which opens them; left and right move between the
 * panes.
 * @type {(options: { rows: Row[]; empty: string; onMove: (delta: number) => void; selected?: string }) =>
 *   { element: HTMLElement; focus: () => void; setRows: (rows: Row[]) => void }}
 */
function selectList({ rows, empty, onMove, selected }) {
  const element = h('div', { class: 'tb-list', tabindex: '0', role: 'listbox', onkeydown: keydown });
  /** @type {Row[]} */
  let shown = [];
  let limit = LIST_LIMIT;
  /** @type {string | undefined} */
  let selectedKey = selected;
  setRows(rows);
  return { element, focus: function () { element.focus({ preventScroll: true }); }, setRows };

  /** @type {(rows: Row[]) => void} */
  function setRows(newRows) {
    rows = newRows;
    limit = LIST_LIMIT;
    render();
  }

  function render() {
    element.replaceChildren();
    if (rows.length === 0) {
      element.append(h('div', { class: 'tb-message' }, empty));
      return;
    }
    shown = rows.slice(0, limit);
    /** @type {string | undefined} */
    let group;
    for (const row of shown) {
      if (row.group !== undefined && row.group !== group) {
        group = row.group;
        element.append(h('div', { class: 'tb-group' }, group));
      }
      element.append(h('div', {
        class: `tb-row${row.disabled ? ' disabled' : ''}${row.key === selectedKey ? ' selected' : ''}`,
        role: 'option',
        'aria-selected': row.key === selectedKey ? 'true' : 'false',
        'data-key': row.key,
        onclick: function () { choose(row); },
      },
      h('div', { class: 'tb-row-main' },
        h('span', { class: 'tb-row-label' }, row.label),
        row.badge && h('span', { class: 'tb-badge' }, row.badge),
        row.count && h('span', { class: 'tb-count' }, row.count)),
      row.meta && h('div', { class: 'tb-row-meta' }, row.meta)));
    }
    if (rows.length > shown.length) {
      element.append(h('button', {
        class: 'tb-more',
        onclick: function () { limit += LIST_LIMIT; render(); },
      }, `show ${Site.formatNumber(Math.min(LIST_LIMIT, rows.length - shown.length))} more of ${Site.formatNumber(rows.length - shown.length)}`));
    }
  }

  /** @type {(row: Row) => void} */
  function choose(row) {
    if (row.disabled) return;
    selectedKey = row.key;
    for (const child of element.querySelectorAll('.tb-row')) {
      const isSelected = /** @type {HTMLElement} */ (child).dataset.key === row.key;
      child.classList.toggle('selected', isSelected);
      child.setAttribute('aria-selected', String(isSelected));
      if (isSelected) child.scrollIntoView({ block: 'nearest' });
    }
    element.focus({ preventScroll: true });
    if (row.onSelect) row.onSelect();
  }

  /** @type {(event: KeyboardEvent) => void} */
  function keydown(event) {
    const enabled = shown.filter(function (row) { return !row.disabled; });
    const index = enabled.findIndex(function (row) { return row.key === selectedKey; });
    /** @type {Row | undefined} */
    let next;
    if (event.key === 'ArrowDown') next = enabled[Math.min(index + 1, enabled.length - 1)];
    else if (event.key === 'ArrowUp') next = enabled[Math.max(index - 1, 0)];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    else if (event.key === 'Enter') next = enabled[index];
    else if (event.key === 'ArrowRight') onMove(1);
    else if (event.key === 'ArrowLeft') onMove(-1);
    else return;
    event.preventDefault();
    if (next && (next.key !== selectedKey || event.key === 'Enter')) choose(next);
  }
}

/**
 * A list with a filter above it.
 * @type {(options: { rows: Row[]; empty: string; placeholder: string; onMove: (delta: number) => void }) =>
 *   { element: HTMLElement; focus: () => void }}
 */
function filteredList({ rows, empty, placeholder, onMove }) {
  const list = selectList({ rows, empty, onMove });
  const input = h('input', {
    type: 'search',
    class: 'tb-filter',
    placeholder,
    oninput: function () {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      list.setRows(words.length === 0 ? rows : rows.filter(function (row) {
        const text = (row.text ?? String(row.label)).toLowerCase();
        return words.every(function (word) { return text.includes(word); });
      }));
    },
    onkeydown: function (/** @type {KeyboardEvent} */ event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        list.focus();
      }
    },
  });
  return { element: h('div', { class: 'tb-filtered' }, input, list.element), focus: list.focus };
}

/**
 * Tabs, whose contents are created when they're first shown.
 * @type {(tabs: { label: string; render: () => { element: HTMLElement; focus: () => void } }[], initial: number) =>
 *   { element: HTMLElement; focus: () => void }}
 */
function tabbed(tabs, initial) {
  /** @type {({ element: HTMLElement; focus: () => void } | undefined)[]} */
  const contents = tabs.map(function () { return undefined; });
  const body = h('div', { class: 'tb-tab-body' });
  const buttons = tabs.map(function (tab, index) {
    return h('button', { class: 'tb-tab', role: 'tab', onclick: function () { show(index); contents[index]?.focus(); } }, tab.label);
  });
  let current = initial;
  show(initial);
  return {
    element: h('div', { class: 'tb-tabs' }, h('div', { class: 'tb-tab-bar', role: 'tablist' }, buttons), body),
    focus: function () { contents[current]?.focus(); },
  };

  /** @type {(index: number) => void} */
  function show(index) {
    current = index;
    const content = contents[index] ?? tabs[index].render();
    contents[index] = content;
    body.replaceChildren(content.element);
    buttons.forEach(function (button, i) {
      button.classList.toggle('selected', i === index);
      button.setAttribute('aria-selected', String(i === index));
    });
  }
}

/**
 * @type {(options: { kind: string; title: string; subtitle?: Child; wide?: boolean; onClose?: () => void }) =>
 *   { element: HTMLElement; body: HTMLElement }}
 */
function paneShell({ kind, title, subtitle, wide, onClose }) {
  const body = h('div', { class: 'tb-pane-body' });
  const element = h('section', { class: `tb-pane${wide ? ' wide' : ''}` },
    h('header', { class: 'tb-pane-header' },
      h('div', { class: 'tb-heading' },
        h('div', { class: 'tb-kind' }, kind),
        h('div', { class: 'tb-title', title }, title),
        subtitle && h('div', { class: 'tb-subtitle' }, subtitle)),
      onClose && h('button', { class: 'tb-close', title: 'close this pane and the ones after it', onclick: onClose }, '✕')),
    body);
  return { element, body };
}

/**
 * @typedef {{
 *   loaded: Loaded;
 *   move: (from: Pane, delta: number) => void;
 *   close: (pane: Pane) => void;
 *   openSearch: (parent: Pane, search: Search) => Pane;
 *   openRecord: (parent: Pane, item: Item, search: Search | undefined) => Pane;
 *   openField: (parent: Pane, search: Search, field: string) => Pane;
 * }} Context
 */

/** @type {(ctx: Context) => Pane} */
function rootPane(ctx) {
  const { loaded } = ctx;
  const shell = paneShell({ kind: 'data', title: 'loaded data', subtitle: sourceText(loaded) });
  /** @type {Pane} */
  const pane = { element: shell.element, title: function () { return 'data'; }, step: undefined, focus: function () { list.focus(); } };
  const list = selectList({
    empty: 'nothing is loaded',
    onMove: function (delta) { ctx.move(pane, delta); },
    rows: COLLECTION_NAMES.map(function (collection) {
      const count = loaded.items[collection].length;
      const allCount = loaded.all[collection].length;
      const kind = COLLECTIONS[collection].kind;
      const dataSet = kind && loaded.data[kind];
      return {
        key: collection,
        label: COLLECTIONS[collection].title,
        count: count < allCount ? `${Site.formatNumber(count)} of ${Site.formatNumber(allCount)}`
          : dataSet ? KibanaData.countText(dataSet) : Site.formatNumber(count),
        meta: allCount === 0 ? 'not loaded' : count === 0 ? 'none have the selected rule tags and spaces' : dataSet?.source,
        disabled: count === 0,
        onSelect: function () {
          if (collection === 'health') ctx.openRecord(pane, loaded.items.health[0], undefined);
          else ctx.openSearch(pane, { collection, conditions: [] });
        },
      };
    }),
  });
  shell.body.append(list.element);
  return pane;
}

/** @type {(loaded: Loaded) => string} */
function sourceText(loaded) {
  const sources = new Set(COLLECTION_NAMES.map(function (collection) {
    const kind = COLLECTIONS[collection].kind;
    return kind && loaded.data[kind]?.source;
  }).filter(Boolean));
  return [...sources].join(', ');
}

/** @type {(ctx: Context, search: Search) => Pane} */
function searchPane(ctx, search) {
  const items = run(ctx.loaded, search);
  const total = ctx.loaded.items[search.collection].length;
  const { title } = COLLECTIONS[search.collection];
  /** @type {Pane} */
  const pane = {
    element: h('div'),
    title: function () {
      const last = search.conditions[search.conditions.length - 1];
      return last ? truncate(conditionText(last), 40) : title;
    },
    step: { pane: 'search', search },
    focus: function () { tabs.focus(); },
  };
  const shell = paneShell({
    kind: `${title} search`,
    title: search.conditions.length === 0 ? `all ${title}` : `${title} where`,
    subtitle: `${Site.formatNumber(items.length)} of ${Site.formatNumber(total)} ${title}`,
    wide: true,
    onClose: function () { ctx.close(pane); },
  });
  pane.element = shell.element;

  const fields = new Map();
  for (const item of items) {
    for (const path of new Set(flatten(item.doc).map(function (f) { return f.path; }))) fields.set(path, (fields.get(path) ?? 0) + 1);
  }
  const tabs = tabbed([
    {
      label: `${title} (${Site.formatNumber(items.length)})`,
      render: function () {
        return filteredList({
          placeholder: `filter these ${title}`,
          empty: `no ${title} match`,
          onMove: function (delta) { ctx.move(pane, delta); },
          rows: items.map(function (item) {
            return {
              key: item.key, label: item.title, meta: item.subtitle, text: `${item.title} ${item.subtitle}`,
              onSelect: function () { ctx.openRecord(pane, item, search); },
            };
          }),
        });
      },
    },
    {
      label: `fields (${Site.formatNumber(fields.size)})`,
      render: function () {
        return filteredList({
          placeholder: 'filter the fields',
          empty: 'no fields',
          onMove: function (delta) { ctx.move(pane, delta); },
          rows: [...fields.keys()].sort().map(function (path) {
            return {
              key: path, label: path, count: Site.formatNumber(fields.get(path)), text: path,
              onSelect: function () { ctx.openField(pane, search, path); },
            };
          }),
        });
      },
    },
  ], 0);

  Site.append(shell.body, [
    search.conditions.length > 0 && h('div', { class: 'tb-conditions' }, search.conditions.map(function (condition) {
      return h('code', { class: 'tb-condition' }, conditionText(condition));
    })),
    histogram(ctx, pane, search, items),
    h('div', { class: 'tb-links' }, discoverLink(search, items)),
    tabs.element,
  ]);
  return pane;
}

/**
 * A histogram of the items' times; clicking a bar searches its time range.
 * @type {(ctx: Context, pane: Pane, search: Search, items: Item[]) => HTMLElement | undefined}
 */
function histogram(ctx, pane, search, items) {
  if (search.collection !== 'alerts' && search.collection !== 'events') return undefined;
  const times = items.map(function (item) { return Site.toDate(item.time)?.getTime(); })
    .filter(function (time) { return time !== undefined; });
  if (times.length < 2) return undefined;
  const min = Math.min(...times);
  const max = Math.max(...times);
  if (max === min) return undefined;
  const width = (max - min) / HISTOGRAM_BARS;
  const counts = new Array(HISTOGRAM_BARS).fill(0);
  for (const time of times) counts[Math.min(HISTOGRAM_BARS - 1, Math.floor((time - min) / width))]++;
  const ticks = axisTicks(Math.max(...counts));
  const top = ticks[ticks.length - 1];
  return h('div', { class: 'tb-histogram', title: 'click a bar to search its time range' },
    h('div', { class: 'tb-axis' }, ticks.map(function (tick) {
      return h('span', { class: 'tb-axis-label', style: `bottom: ${(tick / top) * 100}%` }, Site.formatNumber(tick));
    })),
    h('div', { class: 'tb-bars' },
      ticks.slice(1).map(function (tick) {
        return h('div', { class: 'tb-gridline', style: `bottom: ${(tick / top) * 100}%` });
      }),
      counts.map(function (count, index) {
        const start = min + index * width;
        const from = new Date(start).toISOString();
        const to = new Date(index === HISTOGRAM_BARS - 1 ? max + 1 : start + width).toISOString();
        return h('div', {
          class: 'tb-bar',
          title: `${Site.formatNumber(count)} at ${toSeconds(start + width / 2)}`,
          onclick: count === 0 ? undefined : function () {
            ctx.openSearch(pane, refine(search, { kind: 'range', field: '@timestamp', from, to }));
          },
        }, h('div', { class: 'tb-bar-fill', style: `height: ${(count / top) * 100}%` }));
      })),
    h('div', { class: 'tb-histogram-range' }, h('span', {}, toSeconds(min)), h('span', {}, toSeconds(max))));
}

/**
 * The values for a count axis up to at least max: multiples of 1, 2, or 5
 * times a power of 10, from 0, with a few ticks.
 * @type {(max: number) => number[]}
 */
function axisTicks(max) {
  const rough = Math.max(1, max / 3);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map(function (m) { return m * magnitude; }).find(function (s) { return s >= rough; }) ?? 10 * magnitude;
  const ticks = [0];
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks.length === 1 ? [0, step] : ticks;
}

/** @type {(ms: number) => string} */
function toSeconds(ms) {
  return Site.formatDate(Math.round(ms / 1000) * 1000).replace(/\.000$/, '');
}

/** @type {(ctx: Context, search: Search, field: string) => Pane} */
function fieldPane(ctx, search, field) {
  const items = run(ctx.loaded, search);
  /** @type {Map<string, { value: Primitive; count: number }>} */
  const counts = new Map();
  let missing = 0;
  for (const item of items) {
    const values = valuesOf(item.doc, field).filter(function (value) { return value !== null; });
    if (values.length === 0) missing++;
    for (const value of new Set(values)) {
      const key = JSON.stringify(value);
      const entry = counts.get(key) ?? { value, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  const entries = [...counts.values()].sort(function (a, b) { return b.count - a.count; });
  /** @type {Pane} */
  const pane = {
    element: h('div'),
    title: function () { return field; },
    step: { pane: 'field', search, field },
    focus: function () { list.focus(); },
  };
  const shell = paneShell({
    kind: 'field',
    title: field,
    subtitle: `${Site.formatNumber(counts.size)} values in ${Site.formatNumber(items.length)} ${COLLECTIONS[search.collection].title}`,
    onClose: function () { ctx.close(pane); },
  });
  pane.element = shell.element;

  /** @type {(label: Child, count: number, condition: Condition, key: string) => Row} */
  function valueRow(label, count, condition, key) {
    const percent = items.length === 0 ? 0 : count / items.length;
    return {
      key,
      label,
      text: String(label),
      count: `${Site.formatNumber(count)} · ${Site.formatPercent(percent * 100)}`,
      meta: h('div', { class: 'tb-meter' }, h('span', { style: `width: ${percent * 100}%` })),
      onSelect: function () { ctx.openSearch(pane, refine(search, condition)); },
    };
  }
  const rows = entries.slice(0, VALUE_LIMIT).map(function ({ value, count }) {
    return valueRow(value === '' ? '(empty)' : String(value), count, { kind: 'equals', field, value }, JSON.stringify(value));
  });
  if (missing > 0) rows.push(valueRow(h('i', {}, '(missing)'), missing, { kind: 'missing', field }, '(missing)'));
  const list = selectList({ rows, empty: 'no values', onMove: function (delta) { ctx.move(pane, delta); } });
  Site.append(shell.body, [
    entries.length > VALUE_LIMIT && h('div', { class: 'tb-links' }, `the ${VALUE_LIMIT} most common of ${Site.formatNumber(entries.length)} values`),
    list.element,
  ]);
  return pane;
}

/** @type {(ctx: Context, item: Item, search: Search | undefined) => Pane} */
function recordPane(ctx, item, search) {
  const { one } = COLLECTIONS[item.collection];
  /** @type {Pane} */
  const pane = {
    element: h('div'),
    title: function () { return truncate(item.title, 40); },
    step: { pane: 'record', collection: item.collection, key: item.key, search },
    focus: function () { tabs.focus(); },
  };
  const shell = paneShell({ kind: one, title: item.title, subtitle: item.subtitle, wide: true, onClose: function () { ctx.close(pane); } });
  pane.element = shell.element;

  const relatedRows = related(ctx, pane, item);
  const fields = flatten(item.doc);
  const base = search ?? { collection: item.collection, conditions: [] };
  const tabs = tabbed([
    {
      label: `related (${relatedRows.length})`,
      render: function () {
        return selectList({ rows: relatedRows, empty: 'nothing related is loaded', onMove: function (delta) { ctx.move(pane, delta); } });
      },
    },
    {
      label: `fields (${Site.formatNumber(fields.length)})`,
      render: function () {
        return filteredList({
          placeholder: 'filter the fields',
          empty: 'no fields',
          onMove: function (delta) { ctx.move(pane, delta); },
          rows: fields.map(function ({ path, value }, index) {
            const text = value === null ? 'null' : String(value);
            return {
              key: `${index}`,
              label: path,
              meta: truncate(text, 200),
              text: `${path} ${text}`,
              disabled: item.collection === 'health',
              onSelect: function () { ctx.openSearch(pane, refine(base, value === null ? { kind: 'missing', field: path } : { kind: 'equals', field: path, value })); },
            };
          }),
        });
      },
    },
    {
      label: 'JSON',
      render: function () {
        const pre = h('pre', { class: 'tb-json', tabindex: '0' }, JSON.stringify(item.doc, null, 2));
        return { element: pre, focus: function () { pre.focus({ preventScroll: true }); } };
      },
    },
  ], relatedRows.length > 0 ? 0 : 1);

  shell.body.append(h('div', { class: 'tb-links' }, pageLink(item)), tabs.element);
  return pane;
}

/** @type {(item: Item) => HTMLElement | undefined} */
function pageLink(item) {
  const kind = COLLECTIONS[item.collection].kind;
  if (item.collection === 'health') return h('a', { href: Site.pageUrl('task-manager-health') }, 'open on the Task Manager health page');
  if (!kind || kind === 'events') return undefined;
  const page = SITE_PAGES.find(function (p) { return p.id === KibanaData.KINDS[kind].page; });
  return KibanaData.link(kind, item.key, `open on the ${page?.title ?? kind} page`);
}

// ---------------------------------------------------------------------------
// the trail
// ---------------------------------------------------------------------------

/**
 * Show the trail of panes for the loaded data, starting with the ones in the
 * URL hash.  With focus, the first pane is focused, for the arrow keys.
 * @type {(loaded: Loaded, output: HTMLElement, focus: boolean) => void}
 */
function renderTrail(loaded, output, focus) {
  const crumbs = h('nav', { class: 'tb-crumbs', 'aria-label': 'trail' });
  const trail = h('div', { class: 'tb-trail' });
  /** @type {Pane[]} */
  const panes = [];

  /** @type {Context} */
  const ctx = {
    loaded,
    move: function (from, delta) { panes[panes.indexOf(from) + delta]?.focus(); },
    close: function (pane) {
      const index = panes.indexOf(pane);
      if (index < 1) return;
      for (const removed of panes.splice(index)) removed.element.remove();
      changed();
      panes[index - 1].focus();
    },
    openSearch: function (parent, search) { return open(parent, searchPane(ctx, search)); },
    openRecord: function (parent, item, search) { return open(parent, recordPane(ctx, item, search)); },
    openField: function (parent, search, field) { return open(parent, fieldPane(ctx, search, field)); },
  };

  output.replaceChildren(crumbs, trail);
  const root = rootPane(ctx);
  panes.push(root);
  trail.append(root.element);
  restore(root);
  if (focus) root.focus();

  /** @type {(parent: Pane | undefined, child: Pane) => Pane} */
  function open(parent, child) {
    const index = parent ? panes.indexOf(parent) : panes.length - 1;
    for (const removed of panes.splice(index + 1)) removed.element.remove();
    panes.push(child);
    trail.append(child.element);
    child.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    changed();
    return child;
  }

  function changed() {
    crumbs.replaceChildren(...panes.flatMap(function (pane, index) {
      const crumb = index === panes.length - 1
        ? h('span', { class: 'tb-crumb current' }, pane.title())
        : h('button', { class: 'tb-crumb', onclick: function () { pane.focus(); pane.element.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } }, pane.title());
      return index === 0 ? [crumb] : [h('span', { class: 'tb-crumb-separator' }, '›'), crumb];
    }));
    const steps = panes.map(function (pane) { return pane.step; }).filter(function (step) { return step !== undefined; });
    const hash = steps.length === 0 ? '' : `#trail=${encodeURIComponent(JSON.stringify(steps))}`;
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }

  /** @type {(root: Pane) => void} */
  function restore(root) {
    let parent = root;
    for (const step of hashSteps()) {
      const child = paneFor(step);
      if (!child) break;
      parent = open(parent, child);
    }
    changed();
  }

  /** @type {(step: Step) => Pane | undefined} */
  function paneFor(step) {
    if (step.pane === 'search' && isSearch(step.search)) return searchPane(ctx, step.search);
    if (step.pane === 'field' && isSearch(step.search) && typeof step.field === 'string') return fieldPane(ctx, step.search, step.field);
    if (step.pane === 'record' && COLLECTION_NAMES.includes(step.collection)) {
      const item = loaded.byKey[step.collection].get(String(step.key));
      if (item) return recordPane(ctx, item, isSearch(step.search) ? step.search : undefined);
    }
    return undefined;
  }
}

/** @type {() => Step[]} */
function hashSteps() {
  const text = new URLSearchParams(location.hash.slice(1)).get('trail');
  if (!text) return [];
  try {
    const steps = JSON.parse(text);
    return Array.isArray(steps) ? steps.slice(0, MAX_STEPS) : [];
  } catch {
    return [];
  }
}

/** @type {(value: any) => value is Search} */
function isSearch(value) {
  return value != null && COLLECTION_NAMES.includes(value.collection) && Array.isArray(value.conditions);
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const output = /** @type {HTMLElement} */ (document.getElementById('output'));
const picker = KibanaData.sessionPicker({ onChange: show });
const panel = Site.dataPanel(KibanaData.dataFileLoader({
  hint: [
    'or drop it on this page; or load the data on the other pages.  ',
    h('code', {}, 'sera-download'), ' is described on the ', h('a', { href: new URL('index.html', Site.ROOT_URL).href }, 'home page'), '.',
  ],
  onLoaded: function () {
    picker.refresh();
    show();
  },
}), picker.element);
/** @type {HTMLElement} */ (document.getElementById('input')).append(picker.notice, panel.element);
let shown = false;

async function show() {
  try {
    const loaded = await loadData();
    const counts = COLLECTION_NAMES
      .filter(function (collection) { return loaded.all[collection].length > 0; })
      .map(function (collection) { return `${Site.formatNumber(loaded.all[collection].length)} ${COLLECTIONS[collection].many}`; });
    panel.update(counts.length === 0 ? 'nothing loaded' : counts.join(', '), counts.length > 0);
    if (counts.length === 0) {
      output.replaceChildren(h('p', { class: 'muted' }, 'Load a sera data file above, or load data on the other pages, to browse it here.'));
      return;
    }
    const filtered = COLLECTION_NAMES
      .filter(function (collection) { return loaded.items[collection].length < loaded.all[collection].length; })
      .map(function (collection) {
        return `${Site.formatNumber(loaded.items[collection].length)} of ${Site.formatNumber(loaded.all[collection].length)} ${COLLECTIONS[collection].many}`;
      });
    const tagFilter = Site.tagFilter(KibanaData.allTags(loaded.data),
      Site.isFiltered() ? `showing ${filtered.length === 0 ? 'everything' : filtered.join(', ')}` : undefined,
      KibanaData.allSpaces(loaded.data));
    const trail = h('div');
    output.replaceChildren(tagFilter ?? '', trail);
    renderTrail(loaded, trail, !shown);
    shown = true;
  } catch (err) {
    console.error(err);
    output.replaceChildren(h('p', { class: 'error' }, `error loading the data: ${Site.errorMessage(err)}`));
  }
}

Site.onTagsChange(show);
show();

})();
