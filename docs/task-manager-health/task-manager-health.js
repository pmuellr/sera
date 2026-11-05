// @ts-check

// Analyze Task Manager health reports, from GET /api/task_manager/_health.
// The report's durations (drift, claim and task run durations) are in ms.

'use strict';

(function () {

const { h, section, table, get, formatNumber, formatPercent, formatMillis, formatDate, toDate } = Site;

// task statuses in the workload's task_types, in display order
const TASK_STATUSES = ['idle', 'claiming', 'running', 'failed', 'should_delete', 'unrecognized', 'dead_letter'];
const PROBLEM_TASK_STATUSES = ['failed', 'unrecognized', 'dead_letter'];

const PERCENTILES = ['p50', 'p90', 'p95', 'p99'];

const output = /** @type {HTMLElement} */ (document.getElementById('output'));
const input = /** @type {HTMLElement} */ (document.getElementById('input'));
const logsFilter = /** @type {HTMLElement} */ (document.getElementById('logs-filter'));

const BACKGROUND_NODE_HEALTH_TAG = 'task-manager-background-node-health';

/** @type {any[]} */
let reports = [];
let selected = 0;

input.append(Site.inputPanel({
  storageKey: 'task-manager-health',
  placeholder: 'paste the Task Manager health API response here, drop a file on the page, or load a file',
  onData,
}));
Site.onSettingsChange(render);
renderLogsFilter();

function renderLogsFilter() {
  const filter = `tags : "${BACKGROUND_NODE_HEALTH_TAG}"`;
  const copy = h('button', {
    onclick: function () {
      navigator.clipboard.writeText(filter).then(function () { copy.textContent = 'copied'; });
    },
  }, 'copy');
  logsFilter.replaceChildren(
    'In Discover of the Kibana logs, this KQL filter finds the "Latest Monitored Stats" messages: ',
    h('code', {}, filter), ' ', copy,
    h('span', { class: 'muted' },
      '  Each Kibana instance with the background_tasks role logs its own; copy the newest message of each ',
      'instance, or the documents as JSON, and paste them here.'),
  );
}

/** @type {(text: string) => void} */
function onData(text) {
  reports = text.trim() === '' ? [] : findReports(parseInput(text));
  selected = 0;
  render();
  if (text.trim() !== '' && reports.length === 0) {
    throw new Error('no Task Manager health reports found; expected an object with a "stats" property');
  }
}

/** @type {(text: string) => unknown[]} */
function parseInput(text) {
  try {
    return Site.parseJsonValues(text);
  } catch (err) {
    // log messages, like "... Latest Monitored Stats: {...}", one per line
    const values = [];
    for (const line of text.split('\n')) {
      const json = jsonInMessage(line);
      if (json !== undefined) values.push(json);
    }
    if (values.length === 0) throw err;
    return values;
  }
}

/**
 * The JSON object in a log message, like "... Latest Monitored Stats: {...}".
 * @type {(message: string) => unknown}
 */
function jsonInMessage(message) {
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start === -1 || end < start) return undefined;
  try {
    return JSON.parse(message.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Find the health reports in the parsed values, which may be wrapped in
 * other objects or arrays, like in support diagnostics.
 * @type {(values: unknown[]) => any[]}
 */
function findReports(values) {
  /** @type {any[]} */
  const result = [];
  for (const value of values) walk(value, 0);
  return result;

  /** @type {(value: any, depth: number) => void} */
  function walk(value, depth) {
    if (typeof value === 'string' && value.includes('Latest Monitored Stats')) {
      const json = jsonInMessage(value);
      if (json !== undefined) walk(json, depth + 1);
      return;
    }
    if (value == null || typeof value !== 'object' || depth > 6) return;
    if (isReport(value)) {
      result.push(value);
    } else {
      for (const child of Object.values(value)) walk(child, depth + 1);
    }
  }
}

/** @type {(value: any) => boolean} */
function isReport(value) {
  const stats = value.stats;
  return stats != null && typeof stats === 'object' &&
    (stats.runtime != null || stats.workload != null || stats.configuration != null);
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function render() {
  if (reports.length === 0) {
    output.replaceChildren();
    return;
  }

  /** @type {HTMLElement[]} */
  const children = [];
  if (reports.length > 1) {
    children.push(Site.keyedSection('health reports', `${reports.length} health reports`,
      renderReportsTable(),
      h('p', {}, 'showing report ', renderReportSelector()),
    ));
  }
  children.push(...renderReport(reports[selected]));
  output.replaceChildren(...children);
}

function renderReportSelector() {
  return h('select', {
    onchange: function (/** @type {Event} */ event) {
      selected = Number(/** @type {HTMLSelectElement} */ (event.target).value);
      render();
    },
  }, reports.map(function (report, index) {
    return h('option', { value: index, selected: index === selected },
      `${index + 1}: ${report.id || 'unknown id'} ${formatDate(report.timestamp)} ${report.status || ''}`);
  }));
}

function renderReportsTable() {
  const rows = reports.map(function (report, index) { return { report, index }; });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {(name: string) => Column<Row>} */
  function sectionStatus(name) {
    return {
      label: name,
      value: function (row) { return row.report.stats?.[name]?.status; },
      render: function (row) { return Site.statusBadge(row.report.stats?.[name]?.status); },
    };
  }

  return table([
    { label: '#', value: function (row) { return row.index + 1; }, numeric: true },
    { label: 'id', value: function (row) { return row.report.id; }, render: function (row) {
      return h('a', { href: '#', onclick: function (/** @type {Event} */ event) {
        event.preventDefault();
        selected = row.index;
        render();
      } }, row.report.id || 'unknown id');
    } },
    { label: 'timestamp', value: function (row) { return formatDate(row.report.timestamp); } },
    { label: 'status', value: function (row) { return row.report.status; }, render: function (row) { return Site.statusBadge(row.report.status); } },
    sectionStatus('configuration'),
    sectionStatus('workload'),
    sectionStatus('runtime'),
    sectionStatus('capacity_estimation'),
    { label: 'tasks', value: function (row) { return get(row.report, 'stats.workload.value.count'); }, numeric: true },
    { label: 'overdue', value: function (row) { return get(row.report, 'stats.workload.value.overdue'); }, numeric: true },
    { label: 'drift p99', value: function (row) { return get(row.report, 'stats.runtime.value.drift.p99'); }, numeric: true,
      render: function (row) { return formatMillis(get(row.report, 'stats.runtime.value.drift.p99')); } },
    { label: 'load p90', value: function (row) { return get(row.report, 'stats.runtime.value.load.p90'); }, numeric: true,
      render: function (row) { return formatPercent(get(row.report, 'stats.runtime.value.load.p90')); } },
  ], rows);
}

/** @type {(report: any) => HTMLElement[]} */
function renderReport(report) {
  const stats = report.stats || {};
  return [
    renderSummary(report),
    section('findings', Site.findingsList(analyze(report))),
    section('task types', renderTaskTypes(report)),
    renderCapacity(stats.capacity_estimation),
    renderWorkload(stats.workload, stats),
    renderRuntime(stats.runtime),
    section('configuration', statusLine(stats.configuration), Site.keyValueTable(stats.configuration?.value)),
    h('details', {},
      h('summary', {}, 'raw JSON'),
      h('pre', {}, JSON.stringify(report, null, 2)),
    ),
  ];
}

/** @type {(report: any) => HTMLElement} */
function renderSummary(report) {
  const stats = report.stats || {};
  return section('summary',
    h('div', { class: 'cards' },
      card('status', Site.statusBadge(report.status)),
      card('timestamp', formatDate(report.timestamp)),
      card('last update', formatDate(report.last_update)),
      card('Kibana instance id', h('span', { class: 'mono' }, report.id || 'unknown')),
      Object.entries(stats).map(function ([name, value]) {
        return card(name, Site.statusBadge(/** @type {any} */ (value)?.status));
      }),
    ),
  );
}

/** @type {(label: string, value: Child) => HTMLElement} */
function card(label, value) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-label' }, label),
    h('div', { class: 'card-value' }, value),
  );
}

/** @type {(stat: any) => HTMLElement | undefined} */
function statusLine(stat) {
  if (!stat) return h('p', { class: 'muted' }, 'not in the report');
  return h('p', {}, 'status ', Site.statusBadge(stat.status),
    stat.reason ? ` - ${stat.reason}` : '',
    stat.timestamp ? h('span', { class: 'muted' }, ` as of ${formatDate(stat.timestamp)}`) : '');
}

/**
 * One row per task type, combining the workload and runtime stats.
 * @type {(report: any) => HTMLElement}
 */
function renderTaskTypes(report) {
  const workloadTypes = get(report, 'stats.workload.value.task_types') || {};
  const runtime = get(report, 'stats.runtime.value') || {};
  const driftByType = runtime.drift_by_type || {};
  const durations = runtime.execution?.duration || {};
  const results = runtime.execution?.result_frequency_percent_as_number || {};

  const types = new Set([
    ...Object.keys(workloadTypes),
    ...Object.keys(driftByType),
    ...Object.keys(durations),
    ...Object.keys(results),
  ]);
  if (types.size === 0) return h('p', { class: 'muted' }, 'no task types in the report');

  const rows = [...types].map(function (type) {
    return {
      type,
      workload: workloadTypes[type] || {},
      drift: driftByType[type] || {},
      duration: durations[type] || {},
      results: results[type] || {},
    };
  });
  /** @typedef {(typeof rows)[number]} Row */

  const statuses = new Set();
  for (const row of rows) for (const status of Object.keys(row.workload.status || {})) statuses.add(status);
  const statusColumns = [...statuses].sort(function (a, b) {
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  /** @type {(status: string) => number} */
  function rank(status) {
    const index = TASK_STATUSES.indexOf(status);
    return index === -1 ? TASK_STATUSES.length : index;
  }

  /** @type {(label: string, value: (row: Row) => unknown, title?: string) => Column<Row>} */
  function millis(label, value, title) {
    return { label, value, numeric: true, title, render: function (row) { return formatMillis(value(row)); } };
  }

  /** @type {(label: string, key: string, warnWhenPositive: boolean) => Column<Row>} */
  function percent(label, key, warnWhenPositive) {
    return {
      label,
      value: function (row) { return row.results[key]; },
      numeric: true,
      render: function (row) { return formatPercent(row.results[key]); },
      cellClass: function (row) {
        if (!warnWhenPositive || !(row.results[key] > 0)) return undefined;
        const level = Site.statusLevel(String(row.results.status || ''));
        return level === 'error' ? 'cell-error' : 'cell-warn';
      },
    };
  }

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'task type', value: function (row) { return row.type; }, render: function (row) {
      return Site.discoverLink(h('span', { class: 'mono' }, row.type), taskRunsParams(report, row.type));
    } },
    { label: 'count', value: function (row) { return row.workload.count; }, numeric: true, title: 'number of tasks of this type' },
    ...statusColumns.map(function (status) {
      return {
        label: status,
        value: function (/** @type {Row} */ row) { return row.workload.status?.[status]; },
        numeric: true,
        title: `number of tasks with status ${status}`,
        cellClass: function (/** @type {Row} */ row) {
          return PROBLEM_TASK_STATUSES.includes(status) && row.workload.status?.[status] > 0 ? 'cell-warn' : undefined;
        },
      };
    }),
    millis('drift p50', function (row) { return row.drift.p50; }, 'how late tasks started, compared to when they were scheduled'),
    millis('drift p99', function (row) { return row.drift.p99; }),
    millis('duration p50', function (row) { return row.duration.p50; }, 'task run duration'),
    millis('duration p99', function (row) { return row.duration.p99; }),
    percent('success %', 'Success', false),
    percent('retry %', 'RetryScheduled', false),
    percent('failed %', 'Failed', true),
    { label: 'result status', value: function (row) { return row.results.status; }, render: function (row) {
      return row.results.status ? Site.statusBadge(row.results.status) : '';
    } },
    { label: 'cost', value: function (row) { return row.workload.cost; }, numeric: true, title: 'total cost of the tasks of this type' },
  ];

  return h('div', {},
    h('p', { class: 'muted' },
      'Drift is how late tasks started; durations are how long they ran.  The success, retry, and failed ',
      'percentages are of the recent runs of each task type.  Each task type links to Discover, showing its ',
      'event log task runs for the hour before the report, using the Kibana URL and data view in the settings.'),
    table(columns, rows, { sortBy: 1, descending: true, filter: true }),
  );
}

/** @type {(report: any, type: string) => DiscoverUrlParams} */
function taskRunsParams(report, type) {
  const to = toDate(report.timestamp);
  const from = to && new Date(to.getTime() - 60 * 60 * 1000);
  return {
    tabLabel: `task runs: ${type}`,
    ...Site.timeRange(from, to),
    filters: [
      Site.isFilter('event.provider', 'taskManager'),
      Site.isFilter('event.action', 'task-run'),
      Site.isFilter('kibana.task.type', type),
    ],
    columns: ['kibana.task.id', 'event.outcome', 'kibana.task.schedule_delay', 'event.duration', 'error.message'],
    breakdown: 'event.outcome',
  };
}

/** @type {(capacity: any) => HTMLElement} */
function renderCapacity(capacity) {
  const value = capacity?.value || {};
  return section('capacity estimation',
    statusLine(capacity),
    h('div', { class: 'cards' },
      card('observed Kibana instances', formatNumber(value.observed?.observed_kibana_instances)),
      card('provisioned Kibana instances', formatNumber(value.proposed?.provisioned_kibana)),
      card('minimum required Kibana instances', formatNumber(value.proposed?.min_required_kibana)),
      card('minutes to drain overdue', formatNumber(value.observed?.minutes_to_drain_overdue, 1)),
    ),
    capacity && Site.keyValueTable(value),
  );
}

/** @type {(workload: any, stats: any) => HTMLElement} */
function renderWorkload(workload, stats) {
  const value = workload?.value || {};
  const schedule = Array.isArray(value.schedule) ? value.schedule : [];
  const density = Array.isArray(value.estimated_schedule_density) ? value.estimated_schedule_density.map(Number) : [];

  return section('workload',
    statusLine(workload),
    h('div', { class: 'cards' },
      card('tasks', formatNumber(value.count)),
      card('cost', formatNumber(value.cost)),
      card('non-recurring', formatNumber(value.non_recurring)),
      card('overdue', formatNumber(value.overdue)),
      card('overdue non-recurring', formatNumber(value.overdue_non_recurring)),
      card('owner ids', formatNumber(value.owner_ids)),
    ),
    value.capacity_requirements && h('div', {},
      h('h3', {}, 'capacity requirements'),
      Site.keyValueTable(value.capacity_requirements),
    ),
    density.length > 0 && renderScheduleDensity(density, stats),
    schedule.length > 0 && renderSchedules(schedule),
  );
}

/** @type {(density: number[], stats: any) => HTMLElement} */
function renderScheduleDensity(density, stats) {
  const config = get(stats, 'configuration.value') || {};
  const pollMs = Number(config.poll_interval) || 3000;
  const workers = Number(config.capacity?.as_workers ?? config.capacity?.config ?? config.max_workers) || undefined;
  const instances = Number(get(stats, 'capacity_estimation.value.observed.observed_kibana_instances')) || 1;
  const limit = workers && workers * instances;
  const busiest = Math.max(...density);
  const total = density.reduce(function (sum, count) { return sum + count; }, 0);

  return h('div', {},
    h('h3', {}, 'estimated schedule density'),
    h('p', { class: 'muted' },
      `The number of tasks scheduled to run in each ${formatMillis(pollMs)} polling cycle, for the `,
      `${formatMillis(density.length * pollMs)} after the report: ${formatNumber(total)} tasks, `,
      `with at most ${formatNumber(busiest)} in one cycle.  Bursts of tasks in a cycle can start late, `,
      'if there are more than the Kibana instances can claim.',
      limit ? `  The dashed line, at ${formatNumber(limit)} tasks, is the capacity of ${formatNumber(workers)} workers ` +
        `times ${formatNumber(instances)} observed Kibana ${instances === 1 ? 'instance' : 'instances'}; ` +
        'tasks that run longer than a cycle use capacity in later cycles too.' : ''),
    barChart(density, {
      binMs: pollMs,
      xTitle: 'seconds after the report',
      yTitle: 'tasks',
      limit,
    }),
  );
}

/** @type {(schedule: any[]) => HTMLElement} */
function renderSchedules(schedule) {
  /** @type {Map<string, { ms: number | undefined; interval: string; tasks: number; strings: string[] }>} */
  const byInterval = new Map();
  for (const [text, count] of schedule) {
    const ms = parseInterval(String(text));
    const interval = ms === undefined ? String(text) : formatInterval(ms);
    const row = byInterval.get(interval) ?? { ms, interval, tasks: 0, strings: [] };
    row.tasks += Number(count) || 0;
    if (!row.strings.includes(String(text))) row.strings.push(String(text));
    byInterval.set(interval, row);
  }
  return h('div', {},
    h('h3', {}, 'schedules'),
    h('p', { class: 'muted' },
      'The number of recurring tasks with each interval.  Intervals that are the same, like 60s and 1m, are combined.'),
    table([
      { label: 'interval', value: function (row) { return row.ms ?? Infinity; }, render: function (row) { return row.interval; } },
      { label: 'tasks', value: function (row) { return row.tasks; }, numeric: true },
      { label: 'specified as', value: function (row) { return row.strings.join(', '); } },
    ], [...byInterval.values()], { sortBy: 1, descending: true }),
  );
}

const INTERVAL_UNITS = /** @type {[string, number][]} */ ([['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]]);

/**
 * A Task Manager interval like 30s, 5m, 1h, or 1d, in ms.
 * @type {(text: string) => number | undefined}
 */
function parseInterval(text) {
  const match = /^\s*(\d+)\s*([smhd])\s*$/.exec(text);
  if (!match) return undefined;
  const unit = INTERVAL_UNITS.find(function (entry) { return entry[0] === match[2]; });
  return unit && Number(match[1]) * unit[1];
}

/**
 * The shortest way to write an interval: the largest unit it's a whole number of.
 * @type {(ms: number) => string}
 */
function formatInterval(ms) {
  const unit = INTERVAL_UNITS.find(function (entry) { return ms > 0 && ms % entry[1] === 0; });
  return unit ? `${ms / unit[1]}${unit[0]}` : `${ms}ms`;
}

/** @type {(runtime: any) => HTMLElement} */
function renderRuntime(runtime) {
  const value = runtime?.value || {};
  const polling = value.polling || {};

  /** @type {[string, any, (value: unknown) => string][]} */
  const metrics = [
    ['drift', value.drift, formatMillis],
    ['load (worker utilization)', value.load, formatPercent],
    ['claim duration', polling.claim_duration, formatMillis],
    ['polling duration', polling.duration, formatMillis],
    ['claim conflicts', polling.claim_conflicts, formatNumber],
    ['claim mismatches', polling.claim_mismatches, formatNumber],
  ];
  const rows = metrics.filter(function (metric) { return metric[1] != null; });

  return section('runtime',
    statusLine(runtime),
    h('div', { class: 'cards' },
      card('last successful poll', formatDate(polling.last_successful_poll)),
      card('last polling delay', formatDate(polling.last_polling_delay)),
    ),
    h('h3', {}, 'percentiles'),
    table([
      { label: 'metric', value: function (row) { return row[0]; } },
      ...PERCENTILES.map(function (percentile) {
        return {
          label: percentile,
          value: function (/** @type {(typeof rows)[number]} */ row) { return row[1][percentile]; },
          render: function (/** @type {(typeof rows)[number]} */ row) { return row[2](row[1][percentile]); },
          numeric: true,
        };
      }),
    ], rows),
    polling.result_frequency_percent_as_number && h('div', {},
      h('h3', {}, 'polling cycle results'),
      percentTable(polling.result_frequency_percent_as_number),
    ),
    polling.persistence && h('div', {},
      h('h3', {}, 'claimed task persistence'),
      percentTable(polling.persistence),
    ),
    value.execution?.persistence && h('div', {},
      h('h3', {}, 'task run persistence'),
      percentTable(value.execution.persistence),
    ),
  );
}

/** @type {(object: Record<string, unknown>) => HTMLElement} */
function percentTable(object) {
  return table([
    { label: 'result', value: function (row) { return row[0]; } },
    { label: 'percent', value: function (row) { return row[1]; }, numeric: true, render: function (row) { return formatPercent(row[1]); } },
  ], Object.entries(object), { sortBy: 1, descending: true });
}

/**
 * A bar chart of counts in consecutive time bins, with axes.  `limit` draws a
 * dashed line at that count.
 * @type {(values: number[], options: { binMs: number; xTitle: string; yTitle: string; limit?: number }) => SVGSVGElement}
 */
function barChart(values, { binMs, xTitle, yTitle, limit }) {
  const left = 40;
  const top = 8;
  const plotWidth = 560;
  const plotHeight = 180;
  const bottom = top + plotHeight;
  const yMax = niceCeiling(Math.max(1, ...values, limit ?? 0));
  const barWidth = plotWidth / Math.max(1, values.length);
  /** @type {(value: number) => number} */
  function y(value) { return bottom - (value / yMax) * plotHeight; }

  const svg = svgElement('svg', { viewBox: `0 0 ${left + plotWidth + 10} ${bottom + 36}`, class: 'chart', style: 'max-width: 640px' });

  for (const tick of [0, yMax / 2, yMax]) {
    svg.append(svgElement('line', { x1: left - 4, x2: left + plotWidth, y1: y(tick), y2: y(tick), class: 'axis' }));
    svg.append(svgElement('text', { x: left - 6, y: y(tick) + 4, 'text-anchor': 'end' }, formatNumber(tick)));
  }
  svg.append(svgElement('text', {
    x: 10, y: top + plotHeight / 2, 'text-anchor': 'middle', transform: `rotate(-90 10 ${top + plotHeight / 2})`,
  }, yTitle));

  const hoverLabel = svgElement('text', { class: 'chart-hover-label', 'text-anchor': 'middle', visibility: 'hidden' });
  values.forEach(function (value, index) {
    const x = left + index * barWidth;
    const from = (index * binMs) / 1000;
    const to = ((index + 1) * binMs) / 1000;
    const bar = svgElement('rect', {
      x: x + 1,
      y: y(value),
      width: Math.max(1, barWidth - 2),
      height: bottom - y(value),
      fill: 'var(--accent)',
      class: 'bar',
    });
    // covers the full height of the bin, so short bars are easy to hover
    const target = svgElement('rect', { x, y: top, width: barWidth, height: plotHeight, fill: 'transparent' });
    target.append(svgElement('title', {}, `${formatNumber(from, 1)}s to ${formatNumber(to, 1)}s: ${formatNumber(value)} tasks`));
    target.addEventListener('mouseenter', function () {
      svg.classList.add('hovering');
      bar.classList.add('active');
      hoverLabel.textContent = formatNumber(value);
      hoverLabel.setAttribute('x', String(x + barWidth / 2));
      hoverLabel.setAttribute('y', String(Math.max(top + 10, y(value) - 4)));
      hoverLabel.setAttribute('visibility', 'visible');
    });
    target.addEventListener('mouseleave', function () {
      svg.classList.remove('hovering');
      bar.classList.remove('active');
      hoverLabel.setAttribute('visibility', 'hidden');
    });
    svg.append(bar, target);
  });

  const labelEvery = Math.max(1, Math.ceil(values.length / 10));
  for (let index = 0; index <= values.length; index += labelEvery) {
    const x = left + index * barWidth;
    svg.append(svgElement('line', { x1: x, x2: x, y1: bottom, y2: bottom + 4, class: 'axis' }));
    svg.append(svgElement('text', { x, y: bottom + 15, 'text-anchor': 'middle' }, formatNumber((index * binMs) / 1000, 1)));
  }
  svg.append(svgElement('text', { x: left + plotWidth / 2, y: bottom + 31, 'text-anchor': 'middle' }, xTitle));

  if (limit) {
    svg.append(svgElement('line', {
      x1: left, x2: left + plotWidth, y1: y(limit), y2: y(limit),
      stroke: 'var(--warn)', 'stroke-dasharray': '4 3', 'pointer-events': 'none',
    }));
  }
  svg.append(hoverLabel);
  return /** @type {SVGSVGElement} */ (svg);
}

/**
 * The value rounded up to a round number for an axis, like 300 for 260.
 * @type {(value: number) => number}
 */
function niceCeiling(value) {
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(function (multiple) { return multiple * power >= value; }) ?? 10;
  return Math.round(step * power * 1e6) / 1e6;
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
 * Notable things in the report.  Besides the statuses Task Manager reports,
 * these use rules of thumb, which are noted in the messages.
 * @type {(report: any) => Finding[]}
 */
function analyze(report) {
  /** @type {Finding[]} */
  const findings = [];
  const stats = report.stats || {};
  const config = stats.configuration?.value || {};
  const workload = stats.workload?.value;
  const runtime = stats.runtime?.value;
  const capacity = stats.capacity_estimation?.value;
  const timestamp = toDate(report.timestamp);

  /** @type {(level: 'error' | 'warn' | 'info', message: Child) => void} */
  function add(level, message) {
    findings.push({ level, message });
  }

  /** @type {(status: unknown) => 'error' | 'warn' | 'info'} */
  function levelOf(status) {
    const level = Site.statusLevel(String(status));
    return level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
  }

  if (report.status != null && Site.statusLevel(String(report.status)) !== 'ok') {
    add(levelOf(report.status), `the overall status is ${report.status}`);
  }
  for (const [name, stat] of Object.entries(stats)) {
    const status = /** @type {any} */ (stat)?.status;
    if (status != null && Site.statusLevel(String(status)) !== 'ok') {
      const reason = /** @type {any} */ (stat).reason;
      add(levelOf(status), `the ${name} status is ${status}${reason ? `: ${reason}` : ''}`);
    }
  }

  if (runtime) analyzeRuntime(runtime, config, timestamp, add);
  if (workload) analyzeWorkload(workload, capacity, add);
  if (capacity) analyzeCapacity(capacity, add);
  return findings;
}

/**
 * @typedef {(level: 'error' | 'warn' | 'info', message: Child) => void} AddFinding
 */

/** @type {(runtime: any, config: any, timestamp: Date | undefined, add: AddFinding) => void} */
function analyzeRuntime(runtime, config, timestamp, add) {
  const polling = runtime.polling || {};

  const lastPoll = toDate(polling.last_successful_poll);
  const pollInterval = typeof config.poll_interval === 'number' ? config.poll_interval : 3000;
  if (timestamp && lastPoll) {
    const age = timestamp.getTime() - lastPoll.getTime();
    if (age > Math.max(60 * 1000, 20 * pollInterval)) {
      add('error', `the last successful poll was ${formatMillis(age)} before the report, with a poll interval of ` +
        `${formatMillis(pollInterval)}; polling may have stopped`);
    }
  }

  const pollResults = polling.result_frequency_percent_as_number || {};
  if (pollResults.Failed > 0) {
    add('warn', `${formatPercent(pollResults.Failed)} of polling cycles failed; check the Kibana logs for Task Manager errors`);
  }
  if (pollResults.NoAvailableWorkers > 0) {
    add('warn', `${formatPercent(pollResults.NoAvailableWorkers)} of polling cycles had no available workers, ` +
      'as all capacity was in use');
  }
  const atCapacity = (pollResults.RanOutOfCapacity || 0) + (pollResults.RunningAtCapacity || 0);
  if (atCapacity >= 50) {
    add('warn', `${formatPercent(atCapacity)} of polling cycles ran out of capacity or ran at capacity`);
  }

  if (runtime.load?.p90 >= 90) {
    add('warn', `worker utilization (load) p90 is ${formatPercent(runtime.load.p90)}, so Kibana is close to its task capacity`);
  }

  const drift = runtime.drift || {};
  if (drift.p50 > 5 * 60 * 1000) {
    add('error', `drift p50 is ${formatMillis(drift.p50)}, so half the tasks start more than 5 minutes late (rule of thumb)`);
  } else if (drift.p50 > 30 * 1000 || drift.p99 > 5 * 60 * 1000) {
    add('warn', `drift p50 is ${formatMillis(drift.p50)} and p99 is ${formatMillis(drift.p99)}; tasks are starting late ` +
      '(rule of thumb: p50 over 30 seconds or p99 over 5 minutes)');
  }

  const lateTypes = Object.entries(runtime.drift_by_type || {})
    .map(function ([type, value]) { return { type, p99: /** @type {any} */ (value)?.p99 }; })
    .filter(function (entry) { return entry.p99 > 60 * 1000; })
    .sort(function (a, b) { return b.p99 - a.p99; });
  if (lateTypes.length > 0) {
    add('info', h('span', {},
      `${lateTypes.length} task types have a drift p99 over 1 minute: `,
      typeList(lateTypes.map(function (entry) { return `${entry.type} (${formatMillis(entry.p99)})`; }))));
  }

  if (polling.claim_conflicts?.p90 > 0) {
    add('info', `claim conflicts p90 is ${formatNumber(polling.claim_conflicts.p90)}; ` +
      'Kibana instances are competing to claim the same tasks');
  }
  if (polling.claim_mismatches?.p90 > 0) {
    add('info', `claim mismatches p90 is ${formatNumber(polling.claim_mismatches.p90)}`);
  }

  const results = runtime.execution?.result_frequency_percent_as_number || {};
  for (const [type, value] of Object.entries(results)) {
    const result = /** @type {any} */ (value) || {};
    if (result.status != null && Site.statusLevel(String(result.status)) !== 'ok') {
      const level = Site.statusLevel(String(result.status)) === 'error' ? 'error' : 'warn';
      add(level, h('span', {}, h('span', { class: 'mono' }, type),
        ` has a result status of ${result.status}: ${formatPercent(result.Failed)} failed, ` +
        `${formatPercent(result.RetryScheduled)} retried`));
    }
  }
}

/** @type {(workload: any, capacity: any, add: AddFinding) => void} */
function analyzeWorkload(workload, capacity, add) {
  if (workload.overdue > 0) {
    const drain = capacity?.observed?.minutes_to_drain_overdue;
    add('warn', `${formatNumber(workload.overdue)} tasks are overdue` +
      (workload.overdue_non_recurring > 0 ? `, ${formatNumber(workload.overdue_non_recurring)} of them non-recurring` : '') +
      (typeof drain === 'number' ? `; estimated ${formatNumber(drain, 1)} minutes to drain` : ''));
  }

  for (const status of PROBLEM_TASK_STATUSES) {
    const types = Object.entries(workload.task_types || {})
      .map(function ([type, value]) { return { type, count: /** @type {any} */ (value)?.status?.[status] }; })
      .filter(function (entry) { return entry.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });
    if (types.length === 0) continue;
    const total = types.reduce(function (sum, entry) { return sum + entry.count; }, 0);
    add(status === 'failed' ? 'warn' : 'info', h('span', {},
      `${formatNumber(total)} tasks have status ${status}: `,
      typeList(types.map(function (entry) { return `${entry.type} (${formatNumber(entry.count)})`; }))));
  }

  const instances = capacity?.observed?.observed_kibana_instances;
  if (typeof workload.owner_ids === 'number' && typeof instances === 'number' && workload.owner_ids !== instances) {
    add('info', `tasks are owned by ${workload.owner_ids} Kibana instances, but ${instances} were observed`);
  }
}

/** @type {(capacity: any, add: AddFinding) => void} */
function analyzeCapacity(capacity, add) {
  const proposed = capacity.proposed || {};
  const observed = capacity.observed || {};
  if (proposed.min_required_kibana > proposed.provisioned_kibana) {
    add('error', `an estimated ${formatNumber(proposed.min_required_kibana)} Kibana instances are needed ` +
      `for the workload, but ${formatNumber(proposed.provisioned_kibana)} are provisioned`);
  }
  if (observed.avg_required_throughput_per_minute > observed.max_throughput_per_minute) {
    add('warn', `the average required throughput of ${formatNumber(observed.avg_required_throughput_per_minute)} tasks ` +
      `per minute is more than the maximum throughput of ${formatNumber(observed.max_throughput_per_minute)}`);
  }
}

/** @type {(items: string[]) => HTMLElement} */
function typeList(items) {
  const shown = items.slice(0, 10);
  const more = items.length - shown.length;
  return h('span', { class: 'mono' }, shown.join(', '), more > 0 ? `, and ${more} more` : '');
}

})();
