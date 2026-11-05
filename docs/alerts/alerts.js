// @ts-check

// Analyze alert documents, from the .alerts-* indices.  Uses the rules when
// they're loaded.

'use strict';

(function () {

const { h, section, card, table, listOf, statusBadge, countBy, formatNumber, formatMillis, formatDate } = Site;

// active alerts older than this are noted
const LONG_ACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
// rules with more alerts than this are noted
const MANY_ALERTS = 1000;

const output = /** @type {HTMLElement} */ (document.getElementById('output'));
const input = /** @type {HTMLElement} */ (document.getElementById('input'));

/** @type {KibanaDataSets | undefined} */
let data;

input.append(KibanaData.panel('alerts', function (loaded) {
  data = loaded;
  render();
}));
window.addEventListener('hashchange', render);
Site.onTagsChange(render);

function render() {
  if (!data) return;
  const loaded = data;
  const allAlerts = loaded.alerts?.records;
  if (!allAlerts) {
    output.replaceChildren(KibanaData.notLoaded('alerts'));
    return;
  }
  const selected = Site.selectedTags();
  const alerts = allAlerts.filter(function (alert) { return Site.hasSelectedTags(KibanaData.alertTags(loaded, alert), selected); });
  const tagFilter = Site.tagFilter(KibanaData.allTags(loaded),
    selected.length > 0 ? `showing ${formatNumber(alerts.length)} of ${formatNumber(allAlerts.length)} alerts` : undefined);

  const { id, q } = KibanaData.hashParams();
  const byRule = section('alerts by rule', renderByRule(data, alerts, q));
  output.replaceChildren(
    tagFilter ?? '',
    id ? renderDetail(data, id) : '',
    renderSummary(data, alerts),
    section('findings', Site.findingsList(analyze(data, alerts))),
    byRule,
    section('alerts', renderAlerts(data, alerts, q)),
  );
  if (id) window.scrollTo(0, output.offsetTop);
  else if (q) byRule.scrollIntoView();
}

/**
 * How long an alert has been active, at the time the data was collected.
 * @type {(data: KibanaDataSets, alert: Alert) => number | undefined}
 */
function activeMs(data, alert) {
  if (alert.status !== 'active') return undefined;
  const start = Site.toDate(alert.start)?.getTime();
  if (start === undefined) return alert.durationUs === undefined ? undefined : alert.durationUs / 1000;
  return data.asOf === undefined ? undefined : data.asOf - start;
}

/**
 * Whether the alert's rule is missing; only known if the rules are loaded and complete.
 * @type {(data: KibanaDataSets, alert: Alert) => boolean}
 */
function ruleMissing(data, alert) {
  return !!alert.ruleId && KibanaData.isComplete(data.rules) && !data.rulesById.has(alert.ruleId);
}

/** @type {(data: KibanaDataSets, alert: Alert) => Child} */
function ruleOf(data, alert) {
  return KibanaData.ruleLink(data, alert.ruleId, alert.ruleName);
}

// ---------------------------------------------------------------------------
// summary and tables
// ---------------------------------------------------------------------------

/** @type {(data: KibanaDataSets, alerts: Alert[]) => HTMLElement} */
function renderSummary(data, alerts) {
  const times = alerts.map(function (alert) { return Site.toDate(alert.time)?.getTime(); })
    .filter(function (time) { return time !== undefined; }).map(Number);
  return section('summary',
    h('div', { class: 'cards' },
      card('alerts', alerts.length === data.alerts?.records.length
        ? KibanaData.countText(data.alerts)
        : formatNumber(alerts.length)),
      card('rules', formatNumber(new Set(alerts.map(function (alert) { return alert.ruleId; })).size)),
      card('rule types', formatNumber(new Set(alerts.map(function (alert) { return alert.ruleType; })).size)),
      countBy(alerts.map(function (alert) { return alert.status; })).map(function ([status, count]) {
        return card(status, formatNumber(count));
      }),
      card('flapping', formatNumber(alerts.filter(function (alert) { return alert.flapping; }).length)),
      card('from', times.length ? formatDate(Math.min(...times)) : ''),
      card('to', times.length ? formatDate(Math.max(...times)) : ''),
    ),
  );
}

/** @type {(data: KibanaDataSets, alerts: Alert[], filterText: string | undefined) => HTMLElement} */
function renderByRule(data, alerts, filterText) {
  /** @type {Map<string, Alert[]>} */
  const byRule = new Map();
  for (const alert of alerts) {
    const key = alert.ruleId || 'unknown';
    byRule.set(key, [...(byRule.get(key) || []), alert]);
  }
  const rows = [...byRule].map(function ([ruleId, list]) {
    const rule = data.rulesById.get(ruleId);
    return {
      ruleId,
      name: rule?.name ?? list[0].ruleName ?? ruleId,
      type: list[0].ruleType,
      rule,
      alerts: list.length,
      active: list.filter(function (alert) { return alert.status === 'active'; }).length,
      recovered: list.filter(function (alert) { return alert.status === 'recovered'; }).length,
      untracked: list.filter(function (alert) { return alert.status === 'untracked'; }).length,
      flapping: list.filter(function (alert) { return alert.flapping; }).length,
      missing: ruleMissing(data, list[0]),
    };
  });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'rule', value: function (row) { return row.name; }, render: function (row) {
      return [KibanaData.ruleLink(data, row.ruleId, row.name), row.missing ? [' ', h('span', { class: 'status status-error' }, 'deleted')] : ''];
    } },
    { label: 'rule type', value: function (row) { return row.type; } },
    ...(data.rules ? [{ label: 'rule enabled', value: function (/** @type {Row} */ row) {
      return row.rule ? (row.rule.enabled ? 'yes' : 'no') : '';
    } }] : []),
    { label: 'alerts', value: function (row) { return row.alerts; }, numeric: true,
      render: function (row) { return KibanaData.filterLink('alerts', row.ruleId, formatNumber(row.alerts)); } },
    { label: 'active', value: function (row) { return row.active; }, numeric: true },
    { label: 'recovered', value: function (row) { return row.recovered; }, numeric: true },
    { label: 'untracked', value: function (row) { return row.untracked; }, numeric: true },
    { label: 'flapping', value: function (row) { return row.flapping; }, numeric: true,
      cellClass: function (row) { return row.flapping > 0 ? 'cell-warn' : undefined; } },
  ];
  return table(columns, rows, {
    sortBy: columns.findIndex(function (column) { return column.label === 'alerts'; }),
    descending: true,
    filter: true,
    filterText,
    search: function (row) { return row.ruleId; },
  });
}

/** @type {(data: KibanaDataSets, alerts: Alert[], filterText: string | undefined) => HTMLElement} */
function renderAlerts(data, alerts, filterText) {
  /** @type {Column<Alert>[]} */
  const columns = [
    { label: 'time', value: function (alert) { return formatDate(alert.time); }, render: function (alert) {
      return KibanaData.link('alerts', alert.uuid, formatDate(alert.time) || alert.uuid);
    } },
    { label: 'rule', value: function (alert) { return alert.ruleName; }, render: function (alert) { return ruleOf(data, alert); } },
    { label: 'status', value: function (alert) { return alert.status; }, render: function (alert) { return alertStatus(alert); } },
    { label: 'workflow status', value: function (alert) { return alert.workflowStatus; } },
    { label: 'alert id', value: function (alert) { return alert.instanceId; } },
    { label: 'action group', value: function (alert) { return alert.actionGroup; } },
    { label: 'active for', value: function (alert) { return activeMs(data, alert); }, numeric: true,
      render: function (alert) { return formatMillis(activeMs(data, alert)); },
      cellClass: function (alert) { return (activeMs(data, alert) || 0) > LONG_ACTIVE_MS ? 'cell-warn' : undefined; } },
    { label: 'flapping', value: function (alert) { return alert.flapping ? 'yes' : ''; } },
    { label: 'space', value: function (alert) { return alert.spaces.join(', '); } },
  ];
  return table(columns, alerts, {
    sortBy: 0,
    descending: true,
    filter: true,
    filterText,
    limit: 1000,
    search: function (alert) { return [alert.uuid, alert.ruleId, alert.ruleType, alert.reason].join(' '); },
  });
}

/** @type {(alert: Alert) => HTMLElement} */
function alertStatus(alert) {
  if (alert.status === 'active') return h('span', { class: 'status status-warn' }, 'active');
  if (alert.status === 'recovered') return h('span', { class: 'status status-ok' }, 'recovered');
  return statusBadge(alert.status);
}

// ---------------------------------------------------------------------------
// one alert
// ---------------------------------------------------------------------------

/** @type {(data: KibanaDataSets, id: string) => HTMLElement} */
function renderDetail(data, id) {
  const alert = data.alerts?.records.find(function (item) { return item.uuid === id; });
  if (!alert) {
    return Site.keyedSection('alert', `alert ${id}`, h('p', { class: 'muted' }, 'This alert isn\'t in the loaded alerts. ', h('a', { href: '#' }, 'show all alerts')));
  }
  return Site.keyedSection('alert', `alert: ${alert.instanceId || alert.uuid}`,
    h('p', {}, h('a', { href: '#' }, 'show all alerts')),
    h('div', { class: 'cards' },
      card('rule', ruleOf(data, alert)),
      card('status', alertStatus(alert)),
      card('workflow status', alert.workflowStatus || ''),
      card('start', formatDate(alert.start)),
      card('end', formatDate(alert.end)),
      card('active for', formatMillis(activeMs(data, alert))),
      card('flapping', alert.flapping ? 'yes' : 'no'),
    ),
    alert.reason && h('div', {}, h('h3', {}, 'reason'), h('pre', { class: 'wrap' }, alert.reason)),
    Site.keyValueTable({
      uuid: alert.uuid,
      index: alert.index,
      time: formatDate(alert.time),
      ruleId: alert.ruleId,
      ruleType: alert.ruleType,
      consumer: alert.consumer,
      actionGroup: alert.actionGroup,
      spaces: alert.spaces.join(', '),
    }),
    alert.ruleId ? h('p', {}, KibanaData.filterLink('alerts', alert.ruleId, 'all the alerts of this rule')) : '',
  );
}

// ---------------------------------------------------------------------------
// analysis
// ---------------------------------------------------------------------------

/** @type {(data: KibanaDataSets, alerts: Alert[]) => Finding[]} */
function analyze(data, alerts) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {(level: Finding['level'], ruleIds: string[], text: string) => void} */
  function addRules(level, ruleIds, text) {
    const counts = countBy(ruleIds);
    if (counts.length === 0) return;
    findings.push({
      level,
      message: h('span', {}, `${text}, by rule: `,
        listOf(counts.map(function ([ruleId, count]) {
          const name = alerts.find(function (alert) { return alert.ruleId === ruleId; })?.ruleName;
          return [KibanaData.ruleLink(data, ruleId, name), ` (${formatNumber(count)})`];
        }))),
    });
  }
  /** @type {(list: Alert[]) => string[]} */
  function ruleIdsOf(list) {
    return list.map(function (alert) { return alert.ruleId || 'unknown'; });
  }

  if (!KibanaData.isComplete(data.alerts)) {
    findings.push({ level: 'warn', message: 'the search response didn\'t return all the alerts, so the analysis is incomplete; use a larger search size, or a shorter time range' });
  }

  const flapping = alerts.filter(function (alert) { return alert.flapping; });
  if (flapping.length > 0) addRules('warn', ruleIdsOf(flapping), `flapping alerts: ${formatNumber(flapping.length)}`);

  const longActive = alerts.filter(function (alert) { return (activeMs(data, alert) || 0) > LONG_ACTIVE_MS; });
  if (longActive.length > 0) {
    addRules('info', ruleIdsOf(longActive), `alerts active for more than ${formatMillis(LONG_ACTIVE_MS)}: ${formatNumber(longActive.length)}`);
  }

  const many = countBy(ruleIdsOf(alerts)).filter(function ([, count]) { return count > MANY_ALERTS; });
  if (many.length > 0) {
    addRules('warn', ruleIdsOf(alerts.filter(function (alert) {
      return many.some(function ([ruleId]) { return ruleId === (alert.ruleId || 'unknown'); });
    })), `rules with more than ${formatNumber(MANY_ALERTS)} alerts: ${formatNumber(many.length)}`);
  }

  if (!data.rules) {
    findings.push({ level: 'info', message: h('span', {}, 'Load the rules on the ', h('a', { href: Site.pageUrl('rules') }, 'rules page'),
      ' to check the alerts against their rules.') });
    return findings;
  }

  const deleted = alerts.filter(function (alert) { return alert.status === 'active' && ruleMissing(data, alert); });
  if (deleted.length > 0) addRules('warn', ruleIdsOf(deleted), `active alerts of rules that don't exist: ${formatNumber(deleted.length)}`);

  const disabled = alerts.filter(function (alert) {
    return alert.status === 'active' && alert.ruleId && data.rulesById.get(alert.ruleId)?.enabled === false;
  });
  if (disabled.length > 0) addRules('info', ruleIdsOf(disabled), `active alerts of disabled rules: ${formatNumber(disabled.length)}`);
  return findings;
}

})();
