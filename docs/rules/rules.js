// @ts-check

// Analyze alerting rules, from the rules API or the rule (`alert`) saved
// objects.  Uses the connectors and alerts when they're loaded.

'use strict';

(function () {

const { h, section, card, table, listOf, statusBadge, countBy, formatNumber, formatPercent, formatMillis, formatDate } = Site;

const MINUTE_MS = 60 * 1000;
// the default minimum rule interval, xpack.alerting.rules.minimumScheduleInterval.value
const MINIMUM_INTERVAL_MS = MINUTE_MS;

const output = /** @type {HTMLElement} */ (document.getElementById('output'));
const input = /** @type {HTMLElement} */ (document.getElementById('input'));

/** @type {KibanaDataSets | undefined} */
let data;

input.append(KibanaData.panel('rules', function (loaded) {
  data = loaded;
  render();
}));
window.addEventListener('hashchange', render);
Site.onSettingsChange(render);
Site.onTagsChange(render);

function render() {
  if (!data) return;
  const allRules = data.rules?.records;
  if (!allRules) {
    output.replaceChildren(KibanaData.notLoaded('rules'));
    return;
  }
  const selected = Site.selectedTags();
  const rules = allRules.filter(function (rule) { return Site.hasSelectedTags(rule.tags, selected); });
  const tagFilter = Site.tagFilter(KibanaData.allTags(data),
    selected.length > 0 ? `showing ${formatNumber(rules.length)} of ${formatNumber(allRules.length)} rules` : undefined);

  const { id, q } = KibanaData.hashParams();
  const list = section('rules', renderRules(data, rules, q));
  output.replaceChildren(
    tagFilter ?? '',
    id ? renderDetail(data, id) : '',
    renderSummary(data, rules),
    section('findings', Site.findingsList(analyze(data, rules))),
    section('rule types', renderTypes(rules)),
    list,
  );
  if (id) window.scrollTo(0, output.offsetTop);
  else if (q) list.scrollIntoView();
}

/**
 * Whether any of the rules have their run durations, which the rules API
 * doesn't return, but the saved objects have.
 * @type {(rules: Rule[]) => boolean}
 */
function hasMonitoring(rules) {
  return rules.some(function (rule) { return rule.p95 !== undefined || rule.successRatio !== undefined; });
}

/** @type {(rules: Rule[]) => string} */
function spaceCount(rules) {
  const spaces = new Set(rules.map(function (rule) { return rule.space; }).filter(function (space) { return space !== undefined; }));
  return spaces.size === 0 ? 'unknown' : formatNumber(spaces.size);
}

/** @type {(rules: Rule[]) => number} */
function executionsPerMinute(rules) {
  return rules
    .filter(function (rule) { return rule.enabled && rule.intervalMs; })
    .reduce(function (total, rule) { return total + MINUTE_MS / /** @type {number} */ (rule.intervalMs); }, 0);
}

// ---------------------------------------------------------------------------
// summary and tables
// ---------------------------------------------------------------------------

/** @type {(data: KibanaDataSets, rules: Rule[]) => HTMLElement} */
function renderSummary(data, rules) {
  const enabled = rules.filter(function (rule) { return rule.enabled; });
  return section('summary',
    h('div', { class: 'cards' },
      card('rules', rules.length === data.rules?.records.length
        ? KibanaData.countText(data.rules)
        : formatNumber(rules.length)),
      card('enabled', formatNumber(enabled.length)),
      card('disabled', formatNumber(rules.length - enabled.length)),
      card('rule types', formatNumber(new Set(rules.map(function (rule) { return rule.type; })).size)),
      card('spaces', spaceCount(rules)),
      card('executions per minute', formatNumber(executionsPerMinute(rules), 1)),
      card('failed', formatNumber(enabled.filter(function (rule) { return rule.outcome === 'failed'; }).length)),
      card('warnings', formatNumber(enabled.filter(function (rule) { return rule.outcome === 'warning'; }).length)),
      card('with actions', formatNumber(rules.filter(function (rule) { return rule.actions.length > 0; }).length)),
    ),
    h('p', { class: 'muted' }, 'Executions per minute is estimated from the intervals of the enabled rules.'),
    hasMonitoring(rules) ? '' : h('p', { class: 'muted' },
      'The rules API doesn\'t return the rules\' run durations or success ratios; see the ',
      h('a', { href: Site.pageUrl('event-log') }, 'Event Log page'), ' for them.'),
  );
}

/** @type {(rules: Rule[]) => HTMLElement} */
function renderTypes(rules) {
  /** @type {Map<string, Rule[]>} */
  const byType = new Map();
  for (const rule of rules) byType.set(rule.type, [...(byType.get(rule.type) || []), rule]);
  const rows = [...byType].map(function ([type, list]) {
    const enabled = list.filter(function (rule) { return rule.enabled; });
    const p95s = enabled.map(function (rule) { return rule.p95; }).filter(function (value) { return value !== undefined; });
    return {
      type,
      rules: list.length,
      enabled: enabled.length,
      perMinute: executionsPerMinute(list),
      maxP95: p95s.length ? Math.max(.../** @type {number[]} */ (p95s)) : undefined,
      failed: enabled.filter(function (rule) { return rule.outcome === 'failed'; }).length,
      warnings: enabled.filter(function (rule) { return rule.outcome === 'warning'; }).length,
      intervals: [...new Set(list.map(function (rule) { return rule.interval; }))].join(', '),
    };
  });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'rule type', value: function (row) { return row.type; }, render: function (row) {
      return KibanaData.filterLink('rules', row.type, h('span', { class: 'mono' }, row.type));
    } },
    { label: 'rules', value: function (row) { return row.rules; }, numeric: true },
    { label: 'enabled', value: function (row) { return row.enabled; }, numeric: true },
    { label: 'executions per minute', value: function (row) { return row.perMinute; }, numeric: true,
      render: function (row) { return formatNumber(row.perMinute, 1); } },
    ...(hasMonitoring(rules) ? [{ label: 'max p95 duration', value: function (/** @type {Row} */ row) { return row.maxP95; }, numeric: true,
      render: function (/** @type {Row} */ row) { return formatMillis(row.maxP95); } }] : []),
    { label: 'failed', value: function (row) { return row.failed; }, numeric: true,
      cellClass: function (row) { return row.failed > 0 ? 'cell-error' : undefined; } },
    { label: 'warnings', value: function (row) { return row.warnings; }, numeric: true,
      cellClass: function (row) { return row.warnings > 0 ? 'cell-warn' : undefined; } },
    { label: 'intervals', value: function (row) { return row.intervals; } },
  ];
  return table(columns, rows, { sortBy: 1, descending: true });
}

/** @type {(data: KibanaDataSets, rules: Rule[], filterText: string | undefined) => HTMLElement} */
function renderRules(data, rules, filterText) {
  /** @type {Column<Rule>[]} */
  const columns = [
    { label: 'name', value: function (rule) { return rule.name; }, render: function (rule) {
      return KibanaData.link('rules', rule.id, rule.name || h('span', { class: 'mono' }, rule.id));
    } },
    { label: 'rule type', value: function (rule) { return rule.type; }, render: function (rule) { return h('span', { class: 'mono' }, rule.type); } },
    { label: 'space', value: function (rule) { return rule.space ?? ''; } },
    { label: 'enabled', value: function (rule) { return rule.enabled ? 'yes' : 'no'; } },
    { label: 'interval', value: function (rule) { return rule.intervalMs; }, numeric: true, render: function (rule) { return rule.interval; },
      cellClass: function (rule) { return rule.intervalMs !== undefined && rule.intervalMs < MINIMUM_INTERVAL_MS ? 'cell-warn' : undefined; } },
    { label: 'last outcome', value: function (rule) { return rule.outcome; }, render: function (rule) {
      return rule.outcome ? statusBadge(rule.outcome) : '';
    } },
    { label: 'last run', value: function (rule) { return formatDate(rule.lastRunAt); } },
    ...(hasMonitoring(rules) ? monitoringColumns() : []),
    { label: 'actions', value: function (rule) { return rule.actions.length; }, numeric: true },
    { label: 'active alerts', value: function (rule) { return activeAlerts(data, rule); }, numeric: true,
      title: data.alerts ? 'active alerts in the loaded alerts' : 'active alerts in the last run' },
    { label: 'tags', value: function (rule) { return rule.tags.join(', '); } },
  ];

  return table(columns, rules, {
    sortBy: 0,
    filter: true,
    filterText,
    limit: 2000,
    search: function (rule) {
      return [rule.id, rule.consumer, ...rule.actions.map(function (action) { return action.connectorId; })].join(' ');
    },
  });
}

/** @type {() => Column<Rule>[]} */
function monitoringColumns() {
  return [
    { label: 'p50', value: function (rule) { return rule.p50; }, numeric: true, render: function (rule) { return formatMillis(rule.p50); },
      title: 'p50 run duration of the recent runs' },
    { label: 'p95', value: function (rule) { return rule.p95; }, numeric: true, render: function (rule) { return formatMillis(rule.p95); },
      cellClass: function (rule) { return slowerThanInterval(rule) ? 'cell-warn' : undefined; } },
    { label: 'success', value: function (rule) { return rule.successRatio; }, numeric: true,
      render: function (rule) { return rule.successRatio === undefined ? '' : formatPercent(rule.successRatio * 100); },
      title: 'success ratio of the recent runs' },
  ];
}

/** @type {(data: KibanaDataSets, rule: Rule) => number | undefined} */
function activeAlerts(data, rule) {
  if (!data.alerts) return rule.alertsActive;
  return (data.alertsByRule.get(rule.id) || []).filter(function (alert) { return alert.status === 'active'; }).length;
}

/** @type {(rule: Rule) => boolean} */
function slowerThanInterval(rule) {
  return rule.enabled && rule.p95 !== undefined && rule.intervalMs !== undefined && rule.p95 > rule.intervalMs;
}

// ---------------------------------------------------------------------------
// one rule
// ---------------------------------------------------------------------------

/** @type {(data: KibanaDataSets, id: string) => HTMLElement} */
function renderDetail(data, id) {
  const rule = data.rulesById.get(id);
  if (!rule) {
    return Site.keyedSection('rule', `rule ${id}`, h('p', { class: 'muted' }, 'This rule isn\'t in the loaded rules. ', h('a', { href: '#' }, 'show all rules')));
  }

  const alerts = data.alertsByRule.get(rule.id) || [];
  const message = rule.statusMessage || rule.outcomeMessage;

  return Site.keyedSection('rule', `rule: ${rule.name || rule.id}`,
    h('p', {}, h('a', { href: '#' }, 'show all rules'), ' | ',
      Site.discoverLink('event log executions in Discover', {
        tabLabel: `rule: ${rule.name || rule.id}`,
        from: 'now-24h',
        to: 'now',
        filters: [Site.isFilter('event.provider', 'alerting'), Site.isFilter('rule.id', rule.id)],
        columns: ['event.action', 'event.outcome', 'event.duration', 'message', 'error.message'],
        breakdown: 'event.action',
      })),
    h('div', { class: 'cards' },
      card('rule type', h('span', { class: 'mono' }, rule.type)),
      card('enabled', rule.enabled ? 'yes' : 'no'),
      card('interval', rule.interval || ''),
      card('last outcome', rule.outcome ? statusBadge(rule.outcome) : ''),
      card('execution status', rule.status ? statusBadge(rule.status) : ''),
      card('last run', formatDate(rule.lastRunAt)),
      card('next run', formatDate(rule.nextRun)),
      card('last duration', formatMillis(rule.lastDurationMs)),
      rule.p50 === undefined ? '' : card('duration p50 / p95 / p99', `${formatMillis(rule.p50)} / ${formatMillis(rule.p95)} / ${formatMillis(rule.p99)}`),
      rule.successRatio === undefined ? '' : card('success ratio', formatPercent(rule.successRatio * 100)),
      rule.searchMs === undefined ? '' : card('last search duration', formatMillis(rule.searchMs)),
    ),
    message && h('div', {}, h('h3', {}, 'message'), h('pre', { class: 'wrap' }, message)),
    Site.keyValueTable({
      id: rule.id,
      name: rule.name,
      consumer: rule.consumer,
      space: rule.space,
      tags: rule.tags.join(', '),
      scheduledTaskId: rule.scheduledTaskId,
      statusReason: rule.statusReason,
      gap: rule.gapS ? formatMillis(rule.gapS * 1000) : undefined,
      recentRuns: rule.historyRuns ? `${rule.historyRuns}, ${rule.historyFailures} failed` : undefined,
      lastRunAlerts: `${rule.alertsActive ?? 0} active, ${rule.alertsNew ?? 0} new, ${rule.alertsRecovered ?? 0} recovered`,
      muteAll: rule.muteAll,
      mutedAlerts: rule.mutedAlerts,
      snoozedUntil: rule.snoozedUntil,
      snoozeSchedules: rule.snoozeSchedules,
      running: rule.running,
      createdAt: formatDate(rule.createdAt),
      updatedAt: formatDate(rule.updatedAt),
    }),

    h('h3', {}, 'actions'),
    rule.actions.length === 0
      ? h('p', { class: 'muted' }, 'no actions')
      : table([
        { label: 'connector', value: function (action) { return action.connectorId; }, render: function (action) {
          return [KibanaData.connectorLink(data, action.connectorId), action.preconfigured ? ' (preconfigured)' : '', action.system ? ' (system)' : ''];
        } },
        { label: 'connector type', value: function (action) { return action.connectorType; } },
        { label: 'action group', value: function (action) { return action.group; } },
        { label: 'summary', value: function (action) { return action.summary ? 'yes' : 'no'; } },
        { label: 'notify when', value: function (action) { return action.notifyWhen; } },
        { label: 'throttle', value: function (action) { return action.throttle; } },
      ], rule.actions),

    h('h3', {}, 'alerts'),
    data.alerts
      ? h('p', {}, `${alerts.length} alerts in the loaded alerts: `,
        listOf(countBy(alerts.map(function (alert) { return alert.status; })).map(function ([status, count]) { return `${count} ${status}`; })),
        alerts.length ? [' - ', KibanaData.filterLink('alerts', rule.id, 'show them')] : '')
      : h('p', { class: 'muted' }, 'Alerts aren\'t loaded; load them on the ', KibanaData.filterLink('alerts', rule.id, 'alerts page'), '.'),

    h('details', {}, h('summary', {}, 'rule JSON'), h('pre', {}, JSON.stringify(rule.doc, null, 2))),
  );
}

// ---------------------------------------------------------------------------
// analysis
// ---------------------------------------------------------------------------

/**
 * Notable things about the rules.  These use rules of thumb, which are noted
 * in the messages.
 * @type {(data: KibanaDataSets, rules: Rule[]) => Finding[]}
 */
function analyze(data, rules) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {(level: Finding['level'], message: Child) => void} */
  function add(level, message) {
    findings.push({ level, message });
  }
  /** @type {(level: Finding['level'], list: Rule[], text: string) => void} */
  function addRules(level, list, text) {
    if (list.length === 0) return;
    add(level, h('span', {}, `${text} (${formatNumber(list.length)}): `, listOf(list.map(ruleLink))));
  }

  if (!KibanaData.isComplete(data.rules)) {
    add('warn', 'the response didn\'t return all the rules, so the analysis is incomplete; use a larger per_page or search size');
  }

  const enabled = rules.filter(function (rule) { return rule.enabled; });
  if (enabled.length < rules.length) add('info', `disabled rules: ${formatNumber(rules.length - enabled.length)}`);

  addRules('error', enabled.filter(function (rule) { return rule.outcome === 'failed'; }), 'enabled rules that failed in their last run');
  addRules('warn', enabled.filter(function (rule) { return rule.outcome === 'warning'; }), 'enabled rules with warnings in their last run');

  const reasons = countBy(enabled
    .filter(function (rule) { return rule.statusReason; })
    .map(function (rule) { return /** @type {string} */ (rule.statusReason); }));
  if (reasons.length > 0) {
    add('warn', `execution status reasons: ${reasons.map(function ([reason, count]) { return `${reason} (${count})`; }).join(', ')}`);
  }

  const frequent = enabled.filter(function (rule) { return rule.intervalMs !== undefined && rule.intervalMs < MINIMUM_INTERVAL_MS; });
  if (frequent.length > 0) {
    const intervals = countBy(frequent.map(function (rule) { return /** @type {string} */ (rule.interval); }));
    add('warn', `enabled rules that run more often than once a minute, the default minimum interval: ${formatNumber(frequent.length)} ` +
      `(${intervals.map(function ([interval, count]) { return `${interval}: ${count}`; }).join(', ')}); ` +
      `together they run about ${formatNumber(executionsPerMinute(frequent))} times a minute`);
  }

  addRules('warn', enabled.filter(slowerThanInterval), 'enabled rules with a p95 run duration longer than their interval');
  addRules('warn', enabled.filter(function (rule) { return rule.successRatio !== undefined && rule.successRatio < 0.9; }),
    'enabled rules that succeeded in less than 90% of their recent runs (rule of thumb)');
  addRules('warn', enabled.filter(function (rule) { return (rule.gapS || 0) > 0; }), 'enabled rules with a gap in their last run');
  addRules('info', rules.filter(function (rule) { return rule.running; }), 'rules marked as running');
  addRules('info', rules.filter(function (rule) { return rule.muteAll || rule.snoozedUntil || rule.snoozeSchedules > 0; }),
    'rules that are muted or snoozed');

  const noActions = enabled.filter(function (rule) { return rule.actions.length === 0; });
  if (noActions.length > 0) add('info', `enabled rules without actions: ${formatNumber(noActions.length)}`);
  addRules('error', rules.filter(function (rule) {
    return rule.actions.some(function (action) { return !action.connectorId; });
  }), 'rules with actions that have no connector reference');

  if (data.connectors) analyzeConnectors(data, rules, addRules);
  return findings;
}

/** @type {(data: KibanaDataSets, rules: Rule[], addRules: (level: Finding['level'], list: Rule[], text: string) => void) => void} */
function analyzeConnectors(data, rules, addRules) {
  if (!KibanaData.isComplete(data.connectors)) return;
  addRules('warn', rules.filter(function (rule) {
    return rule.actions.some(function (action) {
      return action.connectorId && !action.preconfigured && !action.system && !data.connectorsById.has(action.connectorId);
    });
  }), 'rules using connectors that aren\'t in the loaded connectors');
}

/** @type {(rule: Rule) => HTMLElement} */
function ruleLink(rule) {
  return KibanaData.link('rules', rule.id, rule.name || rule.id);
}

})();
