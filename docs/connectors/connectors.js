// @ts-check

// Analyze connectors, from the connectors API or the connector (`action`)
// saved objects.  Uses the rules when they're loaded.

'use strict';

(function () {

const { h, section, card, table, listOf, countBy, formatNumber, formatDate } = Site;

const output = /** @type {HTMLElement} */ (document.getElementById('output'));
const input = /** @type {HTMLElement} */ (document.getElementById('input'));

/** @type {KibanaDataSets | undefined} */
let data;

input.append(KibanaData.panel('connectors', function (loaded) {
  data = loaded;
  render();
}));
window.addEventListener('hashchange', render);
Site.onSettingsChange(render);
Site.onTagsChange(render);

/**
 * A connector referenced by the rules, which may or may not be loaded.
 * @typedef {{ id: string; type: string | undefined; preconfigured: boolean; system: boolean; rules: Rule[] }} Referenced
 */

function render() {
  if (!data) return;
  const loaded = data;
  const allConnectors = loaded.connectors?.records;
  const { id, q } = KibanaData.hashParams();

  // connectors have no tags; they match when a rule that uses them has all the selected tags
  const selected = Site.selectedTags();
  const filtering = selected.length > 0 && loaded.rules !== undefined;
  /** @type {(connectorId: string) => boolean} */
  function isTagged(connectorId) {
    return !filtering || rulesOf(loaded, connectorId).some(function (rule) { return Site.hasSelectedTags(rule.tags, selected); });
  }
  // connectors match the spaces by their own, or the rules' when they aren't loaded
  const spaces = Site.selectedSpaces();
  /** @type {(connectorId: string) => boolean} */
  function inSpaces(connectorId) {
    const connector = loaded.connectorsById.get(connectorId);
    if (connector) return Site.inSelectedSpaces(KibanaData.recordSpaces(connector), spaces);
    return rulesOf(loaded, connectorId).some(function (rule) { return Site.inSelectedSpaces(KibanaData.recordSpaces(rule), spaces); });
  }
  const refs = referenced(loaded).filter(function (ref) { return isTagged(ref.id) && inSpaces(ref.id); });

  if (!allConnectors) {
    // the rules alone show which connectors are used
    output.replaceChildren(
      renderTagFilter(loaded, selected, refs.length, referenced(loaded).length) ?? '',
      KibanaData.notLoaded('connectors'),
      id ? renderDetail(loaded, id) : '',
      loaded.rules ? section('connectors used by the rules', renderReferenced(loaded, refs, q)) : '',
    );
    return;
  }

  const connectors = allConnectors.filter(function (connector) { return isTagged(connector.id) && inSpaces(connector.id); });
  const unloaded = refs.filter(function (ref) { return !loaded.connectorsById.has(ref.id); });
  const list = section('connectors', renderConnectors(data, connectors, q));
  output.replaceChildren(
    renderTagFilter(loaded, selected, connectors.length, allConnectors.length) ?? '',
    id ? renderDetail(data, id) : '',
    renderSummary(data, connectors),
    section('findings', Site.findingsList(analyze(data, connectors))),
    section('connector types', renderTypes(data, connectors)),
    list,
    unloaded.length > 0 ? section('connectors used by the rules that aren\'t loaded', renderReferenced(data, unloaded, q)) : '',
  );
  if (id) window.scrollTo(0, output.offsetTop);
  else if (q) list.scrollIntoView();
}

/** @type {(data: KibanaDataSets, selected: string[], shown: number, total: number) => HTMLElement | undefined} */
function renderTagFilter(data, selected, shown, total) {
  let note;
  if (selected.length > 0 && !data.rules) {
    note = 'the rules aren\'t loaded, so the connectors aren\'t filtered by the rules\' tags';
  } else if (selected.length > 0) {
    note = `showing ${formatNumber(shown)} of ${formatNumber(total)} connectors, those used by rules with the tags`;
  } else if (Site.isFiltered()) {
    note = `showing ${formatNumber(shown)} of ${formatNumber(total)} connectors`;
  }
  return Site.tagFilter(KibanaData.allTags(data), note, KibanaData.allSpaces(data));
}

/** @type {(data: KibanaDataSets) => Referenced[]} */
function referenced(data) {
  /** @type {Map<string, Referenced>} */
  const byId = new Map();
  for (const rule of data.rules?.records || []) {
    for (const action of rule.actions) {
      if (!action.connectorId) continue;
      const ref = byId.get(action.connectorId) ||
        { id: action.connectorId, type: action.connectorType, preconfigured: action.preconfigured, system: action.system, rules: [] };
      if (!ref.rules.includes(rule)) ref.rules.push(rule);
      byId.set(action.connectorId, ref);
    }
  }
  return [...byId.values()];
}

/** @type {(connector: { preconfigured: boolean; system: boolean }) => string} */
function kindOf(connector) {
  return connector.preconfigured ? 'preconfigured' : connector.system ? 'system' : 'saved object';
}

/** @type {(data: KibanaDataSets, connectorId: string) => Rule[]} */
function rulesOf(data, connectorId) {
  return data.rulesByConnector.get(connectorId) || [];
}

/** @type {(data: KibanaDataSets, connectorId: string) => Child} */
function ruleCount(data, connectorId) {
  if (!data.rules) return h('span', { class: 'muted' }, 'rules not loaded');
  const count = rulesOf(data, connectorId).length;
  return count === 0 ? '0' : KibanaData.filterLink('rules', connectorId, formatNumber(count));
}

// ---------------------------------------------------------------------------
// summary and tables
// ---------------------------------------------------------------------------

/** @type {(data: KibanaDataSets, connectors: Connector[]) => HTMLElement} */
function renderSummary(data, connectors) {
  return section('summary',
    h('div', { class: 'cards' },
      card('connectors', connectors.length === data.connectors?.records.length
        ? KibanaData.countText(data.connectors)
        : formatNumber(connectors.length)),
      card('connector types', formatNumber(new Set(connectors.map(function (connector) { return connector.type; })).size)),
      card('spaces', spaceCount(connectors)),
      card('preconfigured', formatNumber(connectors.filter(function (connector) { return connector.preconfigured; }).length)),
      card('missing secrets', formatNumber(connectors.filter(function (connector) { return connector.isMissingSecrets; }).length)),
      data.rules ? card('used by rules', formatNumber(connectors.filter(function (connector) { return rulesOf(data, connector.id).length > 0; }).length)) : '',
    ),
  );
}

/** @type {(connectors: Connector[]) => string} */
function spaceCount(connectors) {
  const spaces = new Set(connectors.map(function (connector) { return connector.space; }).filter(function (space) { return space !== undefined; }));
  return spaces.size === 0 ? 'unknown' : formatNumber(spaces.size);
}

/** @type {(data: KibanaDataSets, connectors: Connector[]) => HTMLElement} */
function renderTypes(data, connectors) {
  /** @type {Map<string, Connector[]>} */
  const byType = new Map();
  for (const connector of connectors) byType.set(connector.type, [...(byType.get(connector.type) || []), connector]);
  const rows = [...byType].map(function ([type, list]) {
    return {
      type,
      connectors: list.length,
      missingSecrets: list.filter(function (connector) { return connector.isMissingSecrets; }).length,
      rules: new Set(list.flatMap(function (connector) { return rulesOf(data, connector.id); })).size,
    };
  });
  /** @typedef {(typeof rows)[number]} Row */

  /** @type {Column<Row>[]} */
  const columns = [
    { label: 'connector type', value: function (row) { return row.type; }, render: function (row) {
      return KibanaData.filterLink('connectors', row.type, h('span', { class: 'mono' }, row.type));
    } },
    { label: 'connectors', value: function (row) { return row.connectors; }, numeric: true },
    { label: 'missing secrets', value: function (row) { return row.missingSecrets; }, numeric: true,
      cellClass: function (row) { return row.missingSecrets > 0 ? 'cell-error' : undefined; } },
    ...(data.rules ? [{ label: 'rules', value: function (/** @type {Row} */ row) { return row.rules; }, numeric: true }] : []),
  ];
  return table(columns, rows, { sortBy: 1, descending: true });
}

/** @type {(data: KibanaDataSets, connectors: Connector[], filterText: string | undefined) => HTMLElement} */
function renderConnectors(data, connectors, filterText) {
  /** @type {Column<Connector>[]} */
  const columns = [
    { label: 'name', value: function (connector) { return connector.name; }, render: function (connector) {
      return KibanaData.link('connectors', connector.id, connector.name || h('span', { class: 'mono' }, connector.id));
    } },
    { label: 'connector type', value: function (connector) { return connector.type; },
      render: function (connector) { return h('span', { class: 'mono' }, connector.type); } },
    { label: 'kind', value: kindOf },
    { label: 'space', value: function (connector) { return connector.space ?? ''; } },
    { label: 'missing secrets', value: function (connector) { return connector.isMissingSecrets ? 'yes' : 'no'; },
      cellClass: function (connector) { return connector.isMissingSecrets ? 'cell-error' : undefined; } },
    { label: 'rules', value: function (connector) { return rulesOf(data, connector.id).length; }, numeric: true,
      render: function (connector) { return ruleCount(data, connector.id); } },
    ...(connectors.some(function (connector) { return connector.referencedBy !== undefined; }) ? [{
      label: 'references',
      value: function (/** @type {Connector} */ connector) { return connector.referencedBy; },
      numeric: true,
      title: 'saved objects that reference the connector, like rules and cases, in all spaces',
    }] : []),
    ...(connectors.some(function (connector) { return connector.updatedAt; }) ? [{
      label: 'updated', value: function (/** @type {Connector} */ connector) { return formatDate(connector.updatedAt); },
    }] : []),
  ];
  return table(columns, connectors, {
    sortBy: 0,
    filter: true,
    filterText,
    search: function (connector) { return connector.id; },
  });
}

/** @type {(data: KibanaDataSets, refs: Referenced[], filterText: string | undefined) => HTMLElement} */
function renderReferenced(data, refs, filterText) {
  /** @type {Column<Referenced>[]} */
  const columns = [
    { label: 'connector id', value: function (ref) { return ref.id; }, render: function (ref) {
      return KibanaData.link('connectors', ref.id, h('span', { class: 'mono' }, ref.id));
    } },
    { label: 'connector type', value: function (ref) { return ref.type; } },
    { label: 'kind', value: kindOf },
    { label: 'rules', value: function (ref) { return ref.rules.length; }, numeric: true,
      render: function (ref) { return ruleCount(data, ref.id); } },
  ];
  return table(columns, refs, { sortBy: 3, descending: true, filter: true, filterText });
}

// ---------------------------------------------------------------------------
// one connector
// ---------------------------------------------------------------------------

/** @type {(data: KibanaDataSets, id: string) => HTMLElement} */
function renderDetail(data, id) {
  const connector = data.connectorsById.get(id);
  const rules = rulesOf(data, id);
  const usedBy = h('div', {},
    h('h3', {}, 'rules'),
    !data.rules
      ? h('p', { class: 'muted' }, 'Rules aren\'t loaded; load them on the ', KibanaData.filterLink('rules', id, 'rules page'), '.')
      : rules.length === 0
        ? h('p', { class: 'muted' }, 'No loaded rules use this connector.')
        : h('p', {}, `${formatNumber(rules.length)} rules: `,
          listOf(rules.map(function (rule) { return KibanaData.ruleLink(data, rule.id); }), 50),
          ' - ', KibanaData.filterLink('rules', id, 'show them on the rules page')),
  );
  const discover = Site.discoverLink('event log executions in Discover', {
    tabLabel: `connector: ${connector?.name || id}`,
    from: 'now-24h',
    to: 'now',
    filters: [Site.isFilter('event.provider', 'actions'), Site.isFilter('kibana.action.id', id)],
    columns: ['event.action', 'event.outcome', 'event.duration', 'kibana.related_saved_objects', 'message', 'error.message'],
  });

  if (!connector) {
    const ref = referenced(data).find(function (item) { return item.id === id; });
    return Site.keyedSection('connector', `connector ${id}`,
      h('p', {}, h('a', { href: '#' }, 'show all connectors'), ' | ', discover),
      h('p', { class: 'muted' },
        ref?.preconfigured ? 'This is a preconfigured connector, defined in kibana.yml, so it isn\'t a saved object. '
          : ref?.system ? 'This is a system connector, built into Kibana. '
            : 'This connector isn\'t in the loaded connectors. '),
      usedBy,
    );
  }

  return Site.keyedSection('connector', `connector: ${connector.name || connector.id}`,
    h('p', {}, h('a', { href: '#' }, 'show all connectors'), ' | ', discover),
    h('div', { class: 'cards' },
      card('connector type', h('span', { class: 'mono' }, connector.type)),
      card('kind', kindOf(connector)),
      card('space', connector.space ?? (connector.preconfigured || connector.system ? 'all' : 'unknown')),
      card('missing secrets', connector.isMissingSecrets ? h('span', { class: 'status status-error' }, 'yes') : 'no'),
      card('rules', data.rules ? formatNumber(rules.length) : 'not loaded'),
    ),
    Site.keyValueTable({
      id: connector.id,
      referencedBy: connector.referencedBy,
      createdAt: formatDate(connector.createdAt),
      updatedAt: formatDate(connector.updatedAt),
    }),
    h('h3', {}, 'config'),
    Site.keyValueTable(connector.config),
    usedBy,
    h('details', {}, h('summary', {}, 'connector JSON, without the secrets'), h('pre', {}, JSON.stringify(connector.doc, null, 2))),
  );
}

// ---------------------------------------------------------------------------
// analysis
// ---------------------------------------------------------------------------

/** @type {(data: KibanaDataSets, connectors: Connector[]) => Finding[]} */
function analyze(data, connectors) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {(level: Finding['level'], list: Connector[], text: string) => void} */
  function addConnectors(level, list, text) {
    if (list.length === 0) return;
    findings.push({
      level,
      message: h('span', {}, `${text} (${formatNumber(list.length)}): `,
        listOf(list.map(function (connector) { return KibanaData.connectorLink(data, connector.id); }))),
    });
  }

  if (!KibanaData.isComplete(data.connectors)) {
    findings.push({ level: 'warn', message: 'the response didn\'t return all the connectors, so the analysis is incomplete; use a larger search size' });
  }
  addConnectors('error', connectors.filter(function (connector) { return connector.isMissingSecrets; }),
    'connectors missing their secrets, which can\'t run; usually the encryption key changed, or they were imported');

  if (!data.rules) {
    findings.push({ level: 'info', message: h('span', {}, 'Load the rules on the ', h('a', { href: Site.pageUrl('rules') }, 'rules page'),
      ' to see which rules use the connectors.') });
    return findings;
  }
  if (KibanaData.isComplete(data.rules)) {
    addConnectors('info', connectors.filter(function (connector) { return !connector.system && rulesOf(data, connector.id).length === 0; }),
      'connectors not used by any rules, which may be used by cases, or other apps');
  }

  const refs = referenced(data);
  if (KibanaData.isComplete(data.connectors)) {
    const missing = refs.filter(function (ref) { return !ref.preconfigured && !ref.system && !data.connectorsById.has(ref.id); });
    if (missing.length > 0) {
      findings.push({
        level: 'warn',
        message: h('span', {}, `connectors used by rules that aren't in the loaded connectors (${formatNumber(missing.length)}): `,
          listOf(missing.map(function (ref) { return KibanaData.link('connectors', ref.id, h('span', { class: 'mono' }, ref.id)); }))),
      });
    }
  }
  const preconfigured = refs.filter(function (ref) { return ref.preconfigured; });
  if (preconfigured.length > 0) {
    findings.push({ level: 'info', message: `preconfigured connectors used by rules: ${formatNumber(preconfigured.length)}` });
  }

  const types = countBy((data.rules.records).flatMap(function (rule) {
    return rule.actions.map(function (action) { return action.connectorType || 'unknown'; });
  }));
  if (types.length > 0) {
    findings.push({ level: 'info', message: `rule actions by connector type: ${types.map(function ([type, count]) { return `${type} (${count})`; }).join(', ')}` });
  }
  return findings;
}

})();
