#!/usr/bin/env node
// @ts-check

// Build Kibana Discover URLs (ES|QL / KQL / Lucene, time range, filters, layout).
//
// Command line:  discover-url.js --help
//                discover-url.js --parse '<discover url>' [--output args|json]
// Node module:   import { buildDiscoverUrl, phraseFilter } from 'discover-url';
//                const { buildDiscoverUrl } = require('discover-url');
// Browser:       <script src="discover-url.js"></script>
//                <script> discoverUrl.buildDiscoverUrl({ ... }) </script>
//
// No npm dependencies. Node built-ins are only loaded (dynamically) when run from the command line.
// This is a CommonJS file rather than an ES module, so browsers can load it with <script src> from
// file: URLs, where they refuse to load ES modules.

'use strict';

// keeps the helpers out of the page's global scope when loaded with <script src>
(function () {

const DEFAULT_KIBANA_URL = 'http://localhost:5601';

/** The tab id that makes Discover open the URL in a new tab. */
const NEW_TAB_ID = 'new';

// ---------------------------------------------------------------------------
// exported functions
// ---------------------------------------------------------------------------

/**
 * Build a Discover URL from the given parameters (the command-line options, in camelCase).
 * @type {(params?: DiscoverUrlParams) => string}
 */
function buildDiscoverUrl(params = {}) {
  return urlFromState(stateFromParams(params));
}

/**
 * Parse a Discover URL, `#/...` fragment, or `_a=...&_g=...` query string into DiscoverUrlParams.
 * @type {(url: string) => ParsedDiscoverUrl}
 */
function parseDiscoverUrl(url) {
  const { state, warnings } = parseUrlState(url);
  return { params: paramsFromState(state), warnings };
}

/**
 * Convert DiscoverUrlParams into discover-url.js command-line arguments.
 * @type {(params: DiscoverUrlParams) => string[]}
 */
function paramsToArgs(params) {
  return paramsToArgGroups(params).flat();
}

/**
 * Filter matching documents where `field` is `value` ("is" pill).
 * @type {(field: string, value: string | number | boolean, options?: FilterOptions) => Filter}
 */
function phraseFilter(field, value, options = {}) {
  return createFilter(
    { key: field, type: 'phrase', params: { query: value } },
    { match_phrase: { [field]: value } },
    options
  );
}

/**
 * Filter matching documents where `field` is any of `values` ("is one of" pill).
 * @type {(field: string, values: Array<string | number | boolean>, options?: FilterOptions) => Filter}
 */
function phrasesFilter(field, values, options = {}) {
  return createFilter(
    { key: field, type: 'phrases', params: values },
    {
      bool: {
        minimum_should_match: 1,
        should: values.map((value) => ({ match_phrase: { [field]: value } })),
      },
    },
    options
  );
}

/**
 * Filter matching documents where `field` is within `range` ("is between" pill).
 * @type {(field: string, range: RangeParams, options?: FilterOptions) => Filter}
 */
function rangeFilter(field, range, options = {}) {
  /** @type {RisonObject} */
  const params = { ...range };
  return createFilter(
    { key: field, type: 'range', params },
    { range: { [field]: params } },
    options
  );
}

/**
 * Filter matching documents where `field` exists ("exists" pill).
 * @type {(field: string, options?: FilterOptions) => Filter}
 */
function existsFilter(field, options = {}) {
  return createFilter({ key: field, type: 'exists', value: 'exists' }, { exists: { field } }, options);
}

/**
 * Filter using arbitrary Elasticsearch query DSL ("custom" pill).
 * @type {(query: RisonObject, options?: FilterOptions) => Filter}
 */
function customFilter(query, options = {}) {
  return createFilter({ key: 'query', type: 'custom', value: JSON.stringify(query) }, query, options);
}

/**
 * Rison-encode a value; returns undefined for values that can't be encoded (like JSON.stringify).
 * @type {(input: unknown) => string | undefined}
 */
function risonEncode(input) {
  let value = input;
  if (value !== null && typeof value === 'object' && 'toJSON' in value) {
    const { toJSON } = value;
    if (typeof toJSON === 'function') value = toJSON.call(value);
  }

  if (value === null) return '!n';

  switch (typeof value) {
    case 'boolean':
      return value ? '!t' : '!f';
    case 'number':
      return risonNumber(value);
    case 'bigint':
      return String(value);
    case 'string':
      return risonString(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items = value.map(risonEncode).filter((item) => item !== undefined);
        return `!(${items.join(',')})`;
      }
      const record = /** @type {Record<string, unknown>} */ (value);
      /** @type {string[]} */
      const entries = [];
      for (const key of Object.keys(record).sort()) {
        const encoded = risonEncode(record[key]);
        if (encoded !== undefined) entries.push(`${risonKey(key)}:${encoded}`);
      }
      return `(${entries.join(',')})`;
    }
    default:
      return undefined;
  }
}

/**
 * Decode a rison string (the format of Discover's `_a` / `_g` URL parameters).
 * @type {(text: string) => RisonValue}
 */
function risonDecode(text) {
  /** @type {RisonParser} */
  const parser = { text, index: 0 };
  const value = risonParseValue(parser);
  if (parser.index < text.length) throw risonError(parser, 'unexpected trailing characters');
  return value;
}

/**
 * URL-encode a query-string value the same way Kibana does for `_a` / `_g`.
 * @type {(value: string) => string}
 */
function encodeUriQuery(value) {
  return encodeURIComponent(value)
    .replace(/%40/gi, '@')
    .replace(/%3A/gi, ':')
    .replace(/%24/g, '$')
    .replace(/%2C/gi, ',')
    .replace(/%3B/gi, ';');
}

/**
 * Convert command-line arguments into DiscoverUrlParams (Node only).
 * @type {(args: string[]) => Promise<CliParams>}
 */
async function paramsFromArgs(args) {
  const { values, tokens } = await parseCliArgs(args);
  if (values.help) return { help: true };
  if (values.parse !== undefined) throw new Error('--parse is only supported by main()');
  return paramsFromValues(values, tokens);
}

/**
 * Run the command-line interface (Node only); resolves to the process exit code.
 * @type {(args?: string[]) => Promise<number>}
 */
async function main(args = process.argv.slice(2)) {
  try {
    const { values, tokens } = await parseCliArgs(args);
    if (values.help) {
      process.stdout.write(helpText());
      return 0;
    }
    if (values.parse !== undefined) {
      await runParse(values);
      return 0;
    }
    const { open, ...params } = await paramsFromValues(values, tokens);
    const url = buildDiscoverUrl(params);
    process.stdout.write(`${url}\n`);
    if (open) await openUrl(url);
    return 0;
  } catch (error) {
    process.stderr.write(`discover-url: ${/** @type {Error} */ (error).message}\n`);
    process.stderr.write(`run \`${commandName()} --help\` for usage\n`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// url builder helpers
// ---------------------------------------------------------------------------

const ESQL_FILTERS_ERROR =
  'filters can not be used with an ES|QL query (Discover ignores them); use a WHERE command in the query instead';

/** @type {(state: UrlState) => string} */
function urlFromState(state) {
  const {
    kibanaUrl = defaultKibanaUrl(),
    spaceId,
    savedSearchId,
    searchSessionId,
    tab,
    dataViewId,
    timeRange,
    refreshInterval,
    filters = [],
    columns,
    sort,
    grid,
    savedQuery,
    interval,
    viewMode,
    hideAggregatedPreview,
    breakdownField,
    hideChart,
    hideTable,
    hideSidebar,
    sampleSize,
    rowHeight,
    headerRowHeight,
    rowsPerPage,
    density,
    documentsDisplayMode,
    esqlApproximation,
    expandedDoc,
    profileState,
  } = state;

  const query = resolveQuery(state);
  const isEsql = query !== undefined && 'esql' in query;
  if (isEsql && filters.length) throw new Error(ESQL_FILTERS_ERROR);

  /** @type {RisonValue} */
  let dataSource;
  if (isEsql) dataSource = { type: 'esql' };
  else if (dataViewId) dataSource = { type: 'dataView', dataViewId };

  const appFilters = filters.filter((filter) => !isPinned(filter));
  const globalFilters = filters.filter(isPinned);

  const globalState = compact({
    time: timeRange ? { ...timeRange } : undefined,
    refreshInterval: refreshInterval ? { ...refreshInterval } : undefined,
    filters: globalFilters.length ? globalFilters : undefined,
  });

  const appState = compact({
    query: query ? { ...query } : undefined,
    dataSource,
    filters: appFilters.length ? appFilters : undefined,
    columns,
    sort,
    grid,
    savedQuery,
    interval,
    viewMode,
    hideAggregatedPreview,
    breakdownField,
    hideChart,
    hideTable,
    hideSidebar,
    sampleSize: sampleSize && sampleSize > 0 ? sampleSize : undefined,
    rowHeight,
    headerRowHeight,
    rowsPerPage,
    density,
    documentsDisplayMode,
    esqlApproximation,
    expandedDoc: expandedDoc ? compact({ ...expandedDoc }) : undefined,
  });

  /** @type {string[]} */
  const queryParts = [];
  if (searchSessionId) queryParts.push(`searchSessionId=${encodeUriQuery(searchSessionId)}`);

  /** @type {Array<[string, RisonObject | undefined]>} */
  const states = [
    ['_tab', tab ? compact({ tabId: tab.id ?? NEW_TAB_ID, tabLabel: tab.label }) : undefined],
    ['_g', globalState],
    ['_a', appState],
    ['_p', profileState],
  ];
  for (const [key, state] of states) {
    if (!state || !Object.keys(state).length) continue;
    const encoded = risonEncode(state);
    if (encoded !== undefined) queryParts.push(`${key}=${encodeUriQuery(encoded)}`);
  }

  const base = kibanaUrl.replace(/\/+$/, '');
  const spacePath = spaceId && spaceId !== 'default' ? `/s/${encodeURIComponent(spaceId)}` : '';
  const viewPath = savedSearchId ? `view/${encodeURIComponent(savedSearchId)}` : '';
  const search = queryParts.length ? `?${queryParts.join('&')}` : '';

  return `${base}${spacePath}/app/discover#/${viewPath}${search}`;
}

/** @type {(params: UrlState) => DiscoverQuery | undefined} */
function resolveQuery(params) {
  const { esql, kql, lucene } = params;
  const provided = [esql, kql, lucene].filter((value) => value !== undefined);
  if (provided.length > 1) throw new Error('only one of esql, kql, or lucene may be specified');
  if (esql !== undefined) return { esql };
  if (kql !== undefined) return { language: 'kuery', query: kql };
  if (lucene !== undefined) return { language: 'lucene', query: lucene };
  return undefined;
}

/** @type {(record: RisonObject) => RisonObject} */
function compact(record) {
  /** @type {RisonObject} */
  const result = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** @type {() => string} */
function defaultKibanaUrl() {
  return globalThis.process?.env?.KIBANA_URL ?? DEFAULT_KIBANA_URL;
}

// ---------------------------------------------------------------------------
// url parser helpers
// ---------------------------------------------------------------------------

/** @type {(url: string) => { state: UrlState; warnings: string[] }} */
function parseUrlState(url) {
  /** @type {UrlState} */
  const state = {};
  /** @type {string[]} */
  const warnings = [];

  const input = url.trim();
  const hashIndex = input.indexOf('#');
  let pathPart = '';
  let hash = input;
  if (hashIndex >= 0) {
    pathPart = input.slice(0, hashIndex);
    hash = input.slice(hashIndex + 1);
  } else if (/\/app\/discover\/?$/.test(input)) {
    pathPart = input;
    hash = '';
  }

  if (pathPart) {
    const match = /^(.*?)(?:\/s\/([^/]+))?\/app\/discover\/?$/.exec(pathPart);
    if (match) {
      const [, base, space] = match;
      if (base) state.kibanaUrl = base;
      if (space && space !== 'default') state.spaceId = decodeURIComponent(space);
    } else {
      warnings.push(`unrecognized URL path "${pathPart}"`);
    }
  }

  let route = hash.replace(/^\/+/, '');
  let search = '';
  const questionIndex = route.indexOf('?');
  if (questionIndex >= 0) {
    search = route.slice(questionIndex + 1);
    route = route.slice(0, questionIndex);
  } else if (route.includes('=')) {
    search = route;
    route = '';
  }

  const viewMatch = /^view\/([^/]+)\/?$/.exec(route);
  if (viewMatch) state.savedSearchId = decodeURIComponent(viewMatch[1]);
  else if (route) warnings.push(`unrecognized Discover route "${route}"`);

  for (const part of search.split('&')) {
    if (!part) continue;
    const equalsIndex = part.indexOf('=');
    const key = equalsIndex < 0 ? part : part.slice(0, equalsIndex);
    const value = decodeQueryValue(equalsIndex < 0 ? '' : part.slice(equalsIndex + 1));
    switch (key) {
      case 'searchSessionId':
        state.searchSessionId = value;
        break;
      case '_g':
        applyGlobalState(state, decodeUrlState(key, value, warnings), warnings);
        break;
      case '_a':
        applyAppState(state, decodeUrlState(key, value, warnings), warnings);
        break;
      case '_p': {
        const profileState = decodeUrlState(key, value, warnings);
        if (Object.keys(profileState).length) state.profileState = profileState;
        break;
      }
      case '_tab':
        applyTabState(state, decodeUrlState(key, value, warnings), warnings);
        break;
      default:
        warnings.push(`ignored URL parameter "${key}"`);
    }
  }

  if (state.esql !== undefined && state.filters) {
    warnings.push('ignored filters (Discover ignores them in ES|QL mode)');
    delete state.filters;
  }

  return { state, warnings };
}

const VIEW_MODES = /** @type {const} */ (['documents', 'patterns', 'aggregated']);
const DENSITIES = /** @type {const} */ (['compact', 'normal', 'expanded']);
const DISPLAY_MODES = /** @type {const} */ (['table', 'json']);

/** @type {(value: string) => string} */
function decodeQueryValue(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** @type {(key: string, text: string, warnings: string[]) => RisonObject} */
function decodeUrlState(key, text, warnings) {
  try {
    const value = risonDecode(text);
    if (isRisonObject(value)) return value;
    warnings.push(`ignored ${key}: expected a rison object`);
  } catch (error) {
    warnings.push(`ignored ${key}: ${/** @type {Error} */ (error).message}`);
  }
  return {};
}

/** @type {(value: RisonValue) => value is RisonObject} */
function isRisonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @type {(value: RisonValue) => value is Filter} */
function isFilter(value) {
  return isRisonObject(value) && isRisonObject(value.meta);
}

/** @type {(value: RisonValue) => string[] | undefined} */
function asStringArray(value) {
  if (!Array.isArray(value)) return undefined;
  /** @type {string[]} */
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    result.push(item);
  }
  return result;
}

/** @type {(warnings: string[], label: string, value: RisonValue) => void} */
function warnInvalid(warnings, label, value) {
  warnings.push(`ignored ${label}: unexpected value ${risonEncode(value)}`);
}

/** @type {(label: string, value: RisonValue, store: FilterStore, warnings: string[]) => Filter[]} */
function decodeFilters(label, value, store, warnings) {
  if (!Array.isArray(value)) {
    warnInvalid(warnings, label, value);
    return [];
  }
  /** @type {Filter[]} */
  const filters = [];
  for (const item of value) {
    if (!isFilter(item)) {
      warnInvalid(warnings, label, item);
      continue;
    }
    filters.push(store === 'globalState' && !item.$state ? { ...item, $state: { store } } : item);
  }
  return filters;
}

/** @type {(value: RisonValue) => Array<[string, SortDirection]> | undefined} */
function decodeSort(value) {
  if (!Array.isArray(value)) return undefined;
  const pairs = typeof value[0] === 'string' ? [value] : value;
  /** @type {Array<[string, SortDirection]>} */
  const sort = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair)) return undefined;
    const [field, direction] = pair;
    if (typeof field !== 'string' || (direction !== 'asc' && direction !== 'desc')) return undefined;
    sort.push([field, direction]);
  }
  return sort;
}

/** @type {(params: UrlState, state: RisonObject, warnings: string[]) => void} */
function applyGlobalState(params, state, warnings) {
  for (const [key, value] of Object.entries(state)) {
    const label = `_g.${key}`;
    switch (key) {
      case 'time': {
        const from = isRisonObject(value) ? value.from : undefined;
        const to = isRisonObject(value) ? value.to : undefined;
        if (typeof from === 'string' && typeof to === 'string') params.timeRange = { from, to };
        else warnInvalid(warnings, label, value);
        break;
      }
      case 'refreshInterval': {
        const pause = isRisonObject(value) ? value.pause : undefined;
        const interval = isRisonObject(value) ? value.value : undefined;
        if (typeof pause === 'boolean' && typeof interval === 'number') {
          params.refreshInterval = { pause, value: interval };
        } else {
          warnInvalid(warnings, label, value);
        }
        break;
      }
      case 'filters':
        params.filters = [
          ...(params.filters ?? []),
          ...decodeFilters(label, value, 'globalState', warnings),
        ];
        break;
      default:
        warnings.push(`ignored ${label} (not supported by discover-url)`);
    }
  }
}

/** @type {(params: UrlState, state: RisonObject, warnings: string[]) => void} */
function applyAppState(params, state, warnings) {
  for (const [key, value] of Object.entries(state)) {
    const label = `_a.${key}`;
    switch (key) {
      case 'query': {
        const { esql, language, query } = isRisonObject(value) ? value : {};
        if (typeof esql === 'string') params.esql = esql;
        else if (language === 'kuery' && typeof query === 'string') params.kql = query;
        else if (language === 'lucene' && typeof query === 'string') params.lucene = query;
        else warnInvalid(warnings, label, value);
        break;
      }
      case 'dataSource': {
        const { type, dataViewId } = isRisonObject(value) ? value : {};
        if (type === 'dataView' && typeof dataViewId === 'string') params.dataViewId = dataViewId;
        else if (type !== 'esql') warnInvalid(warnings, label, value);
        break;
      }
      case 'index':
        if (typeof value === 'string') params.dataViewId ??= value;
        else warnInvalid(warnings, label, value);
        break;
      case 'filters':
        params.filters = [...(params.filters ?? []), ...decodeFilters(label, value, 'appState', warnings)];
        break;
      case 'columns': {
        const columns = asStringArray(value);
        if (columns) params.columns = columns;
        else warnInvalid(warnings, label, value);
        break;
      }
      case 'sort': {
        const sort = decodeSort(value);
        if (sort) params.sort = sort;
        else warnInvalid(warnings, label, value);
        break;
      }
      case 'grid':
        if (isRisonObject(value)) params.grid = value;
        else warnInvalid(warnings, label, value);
        break;
      case 'savedQuery':
      case 'interval':
      case 'breakdownField':
        if (typeof value === 'string') params[key] = value;
        else warnInvalid(warnings, label, value);
        break;
      case 'hideAggregatedPreview':
      case 'hideChart':
      case 'hideTable':
      case 'hideSidebar':
      case 'esqlApproximation':
        if (typeof value === 'boolean') params[key] = value;
        else warnInvalid(warnings, label, value);
        break;
      case 'sampleSize':
      case 'rowHeight':
      case 'headerRowHeight':
      case 'rowsPerPage':
        if (typeof value === 'number') params[key] = value;
        else warnInvalid(warnings, label, value);
        break;
      case 'viewMode': {
        const viewMode = VIEW_MODES.find((mode) => mode === value);
        if (viewMode) params.viewMode = viewMode;
        else warnInvalid(warnings, label, value);
        break;
      }
      case 'density': {
        const density = DENSITIES.find((mode) => mode === value);
        if (density) params.density = density;
        else warnInvalid(warnings, label, value);
        break;
      }
      case 'documentsDisplayMode': {
        const displayMode = DISPLAY_MODES.find((mode) => mode === value);
        if (displayMode) params.documentsDisplayMode = displayMode;
        else warnInvalid(warnings, label, value);
        break;
      }
      case 'expandedDoc': {
        const { id, index, routing } = isRisonObject(value) ? value : {};
        if (typeof id === 'string' && typeof index === 'string') {
          params.expandedDoc = typeof routing === 'string' ? { id, index, routing } : { id, index };
        } else {
          warnInvalid(warnings, label, value);
        }
        break;
      }
      default:
        warnings.push(`ignored ${label} (not supported by discover-url)`);
    }
  }
}

/** @type {(params: UrlState, state: RisonObject, warnings: string[]) => void} */
function applyTabState(params, state, warnings) {
  const { tabId, tabLabel } = state;
  if (typeof tabId !== 'string') {
    warnInvalid(warnings, '_tab', state);
    return;
  }
  params.tab = typeof tabLabel === 'string' ? { id: tabId, label: tabLabel } : { id: tabId };
}

// ---------------------------------------------------------------------------
// params: conversions between DiscoverUrlParams, URL state, and command-line arguments
// ---------------------------------------------------------------------------

const DEFAULT_REFRESH_INTERVAL = 60000;

/**
 * The command-line options that are DiscoverUrlParams (as camelCase keys), in command-line order.
 * `filters` follows `pin-filters`.
 */
const PARAM_OPTIONS = /** @type {const} */ ({
  kibana: 'string',
  space: 'string',
  'saved-search': 'string',
  session: 'string',
  'tab-id': 'string',
  'tab-label': 'string',
  esql: 'string',
  kql: 'string',
  lucene: 'string',
  'data-view': 'string',
  'saved-query': 'string',
  from: 'string',
  to: 'string',
  refresh: 'integer',
  'refresh-paused': 'boolean',
  'pin-filters': 'boolean',
  columns: 'list',
  sort: 'strings',
  grid: 'json',
  interval: 'string',
  breakdown: 'string',
  'view-mode': 'string',
  'hide-aggregated-preview': 'boolean',
  'hide-chart': 'boolean',
  'hide-table': 'boolean',
  'hide-sidebar': 'boolean',
  'sample-size': 'integer',
  'rows-per-page': 'integer',
  'row-height': 'integer',
  'header-row-height': 'integer',
  density: 'string',
  'display-mode': 'string',
  'esql-approximation': 'boolean',
  'doc-id': 'string',
  'doc-index': 'string',
  'doc-routing': 'string',
  'profile-state': 'json',
});

const PARAM_KEYS = [...Object.keys(PARAM_OPTIONS).map(camelCase), 'filters'];

/** @type {(name: string) => string} */
function camelCase(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

/** @type {(key: string) => string} */
function kebabCase(key) {
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/** @type {(params: DiscoverUrlParams) => UrlState} */
function stateFromParams(params) {
  const unknown = Object.keys(params).filter((key) => !PARAM_KEYS.includes(key));
  if (unknown.length) throw new Error(`unknown parameter "${unknown.join('", "')}"`);

  const {
    kibana,
    space,
    savedSearch,
    session,
    tabId,
    tabLabel,
    esql,
    kql,
    lucene,
    dataView,
    savedQuery,
    from,
    to,
    refresh,
    refreshPaused,
    pinFilters = false,
    filters = [],
    columns,
    sort,
    grid,
    interval,
    breakdown,
    viewMode,
    hideAggregatedPreview,
    hideChart,
    hideTable,
    hideSidebar,
    sampleSize,
    rowsPerPage,
    rowHeight,
    headerRowHeight,
    density,
    displayMode,
    esqlApproximation,
    docId,
    docIndex,
    docRouting,
    profileState,
  } = params;

  if ((docId === undefined) !== (docIndex === undefined)) {
    throw new Error('--doc-id and --doc-index must be used together');
  }

  /** @type {FilterOptions} */
  const common = { pinned: pinFilters, index: dataView };
  const noTime = from === undefined && to === undefined;
  const noRefresh = refresh === undefined && refreshPaused === undefined;

  return {
    kibanaUrl: kibana,
    spaceId: space,
    savedSearchId: savedSearch,
    searchSessionId: session,
    tab:
      tabId === undefined && tabLabel === undefined ? undefined : { id: tabId ?? NEW_TAB_ID, label: tabLabel },
    esql,
    kql,
    lucene,
    dataViewId: dataView,
    savedQuery,
    timeRange: noTime ? undefined : { from: from ?? 'now-15m', to: to ?? 'now' },
    refreshInterval: noRefresh
      ? undefined
      : { pause: refreshPaused ?? false, value: refresh ?? DEFAULT_REFRESH_INTERVAL },
    filters: filters.flatMap((entry) => filtersFromParam(entry, common)),
    columns,
    sort: sort?.map(parseSort),
    grid,
    interval,
    breakdownField: breakdown,
    viewMode: parseChoice('view-mode', viewMode, VIEW_MODES),
    hideAggregatedPreview,
    hideChart,
    hideTable,
    hideSidebar,
    sampleSize,
    rowsPerPage,
    rowHeight,
    headerRowHeight,
    density: parseChoice('density', density, DENSITIES),
    documentsDisplayMode: parseChoice('display-mode', displayMode, DISPLAY_MODES),
    esqlApproximation,
    expandedDoc:
      docId === undefined || docIndex === undefined
        ? undefined
        : { id: docId, index: docIndex, routing: docRouting },
    profileState,
  };
}

/** @type {(state: UrlState) => DiscoverUrlParams} */
function paramsFromState(state) {
  const {
    kibanaUrl,
    spaceId,
    savedSearchId,
    searchSessionId,
    tab,
    dataViewId,
    savedQuery,
    timeRange,
    refreshInterval,
    filters = [],
    columns,
    sort,
    grid,
    interval,
    breakdownField,
    viewMode,
    hideAggregatedPreview,
    hideChart,
    hideTable,
    hideSidebar,
    sampleSize,
    rowsPerPage,
    rowHeight,
    headerRowHeight,
    density,
    documentsDisplayMode,
    esqlApproximation,
    expandedDoc,
    profileState,
  } = state;

  const query = resolveQuery(state);
  const pinFilters = filters.length > 0 && filters.every(isPinned);
  /** @type {FilterOptions} */
  const common = { pinned: pinFilters, index: dataViewId };
  const { pause, value: refreshValue } = refreshInterval ?? {};

  /** @type {DiscoverUrlParams} */
  const params = {
    kibana: kibanaUrl === DEFAULT_KIBANA_URL ? undefined : kibanaUrl,
    space: spaceId,
    savedSearch: savedSearchId,
    session: searchSessionId,
    tabId: tab?.label !== undefined && tab.id === NEW_TAB_ID ? undefined : tab?.id,
    tabLabel: tab?.label,
    esql: query && 'esql' in query ? query.esql : undefined,
    kql: query && 'language' in query && query.language === 'kuery' ? query.query : undefined,
    lucene: query && 'language' in query && query.language === 'lucene' ? query.query : undefined,
    dataView: dataViewId,
    savedQuery,
    from: timeRange?.from,
    to: timeRange?.to,
    refresh: refreshInterval && (!pause || refreshValue !== DEFAULT_REFRESH_INTERVAL) ? refreshValue : undefined,
    refreshPaused: pause || undefined,
    pinFilters: pinFilters || undefined,
    filters: filters.length ? filters.map((filter) => filterToParam(filter, common)) : undefined,
    columns: columns?.length ? columns : undefined,
    sort: sort?.length ? sort.map(([field, direction]) => `${field}:${direction}`) : undefined,
    grid,
    interval,
    breakdown: breakdownField,
    viewMode,
    hideAggregatedPreview,
    hideChart,
    hideTable,
    hideSidebar,
    sampleSize,
    rowsPerPage,
    rowHeight,
    headerRowHeight,
    density,
    displayMode: documentsDisplayMode,
    esqlApproximation,
    docId: expandedDoc?.id,
    docIndex: expandedDoc?.index,
    docRouting: expandedDoc?.routing,
    profileState: profileState && Object.keys(profileState).length ? profileState : undefined,
  };
  return withoutUndefined(params);
}

/** @type {<T extends object>(record: T) => T} */
function withoutUndefined(record) {
  return /** @type {typeof record} */ (
    Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
  );
}

/** @type {(params: DiscoverUrlParams) => string[][]} */
function paramsToArgGroups(params) {
  const record = /** @type {Record<string, unknown>} */ (params);
  /** @type {string[][]} */
  const groups = [];
  for (const [name, kind] of Object.entries(PARAM_OPTIONS)) {
    groups.push(...paramToArgGroups(name, kind, record[camelCase(name)]));
    if (name === 'pin-filters') groups.push(...(params.filters ?? []).map(filterParamToArgGroup));
  }
  return groups;
}

/** @type {(name: string, kind: ParamKind, value: unknown) => string[][]} */
function paramToArgGroups(name, kind, value) {
  if (value === undefined) return [];
  switch (kind) {
    case 'boolean':
      return [[value ? `--${name}` : `--no-${name}`]];
    case 'list':
      return Array.isArray(value) && value.length ? [optionGroup(name, value.join(','))] : [];
    case 'strings':
      return Array.isArray(value) ? value.map((item) => optionGroup(name, String(item))) : [];
    case 'json':
      return [optionGroup(name, JSON.stringify(value))];
    default:
      return [optionGroup(name, String(value))];
  }
}

/** @type {(name: string, value: string) => string[]} */
function optionGroup(name, value) {
  // parseArgs rejects a separate option value that starts with "-"
  return value.startsWith('-') ? [`--${name}=${value}`] : [`--${name}`, value];
}

/** @type {(entry: FilterParam) => string[]} */
function filterParamToArgGroup(entry) {
  const { label, ...rest } = /** @type {FilterParam & { label?: string }} */ (entry);
  const [[key, value]] = Object.entries(rest);
  const name = kebabCase(key);
  const filterGroup = typeof value === 'string' ? optionGroup(name, value) : [`--${name}`, JSON.stringify(value)];
  return label === undefined ? filterGroup : [...optionGroup('filter-label', label), ...filterGroup];
}

/** @type {(filter: Filter, common: FilterOptions) => FilterParam} */
function filterToParam(filter, common) {
  const jsonParam = { filterJson: filter };
  const candidate = filterArgCandidate(filter);
  if (!candidate) return jsonParam;

  const [name, text] = candidate;
  const { alias } = filter.meta;
  const label = typeof alias === 'string' ? alias : undefined;
  /** @type {Filter[]} */
  let rebuilt;
  try {
    rebuilt = filterFromArg(name, text, { ...common, alias: label });
  } catch {
    return jsonParam;
  }
  if (rebuilt.length !== 1 || filterIdentity(rebuilt[0]) !== filterIdentity(filter)) return jsonParam;
  return /** @type {FilterParam} */ (withoutUndefined({ [camelCase(name)]: text, label }));
}

/**
 * The rison of a filter without the meta fields Kibana derives when it loads one
 * (mapFilter() recomputes meta.value, and the filter editor adds meta.field = meta.key).
 * @type {(filter: Filter) => string | undefined}
 */
function filterIdentity(filter) {
  const { value, field, ...meta } = filter.meta;
  return risonEncode({ ...filter, meta: field === undefined || field === meta.key ? meta : { ...meta, field } });
}

/** @type {(entry: FilterParam, common: FilterOptions) => Filter[]} */
function filtersFromParam(entry, common) {
  const record = isRisonObject(/** @type {RisonValue} */ (entry)) ? entry : {};
  const { label, ...rest } = /** @type {Record<string, unknown>} */ (record);
  const entries = Object.entries(rest);
  const flag = FILTER_FLAGS.find((name) => entries.length === 1 && camelCase(name) === entries[0][0]);
  if (!flag) {
    const keys = FILTER_FLAGS.map(camelCase).join(', ');
    throw new Error(`filters: expected an object with one of ${keys} (and an optional label), got ${JSON.stringify(entry)}`);
  }
  if (label !== undefined && typeof label !== 'string') throw new Error('filters: expected a string for label');
  const [[, value]] = entries;
  if (flag === 'filter-json') {
    if (label !== undefined) throw new Error('filters: label can not be used with filterJson; set meta.alias instead');
    return filtersFromJson(value);
  }
  if (typeof value !== 'string') throw new Error(`filters: expected a string for ${camelCase(flag)}`);
  return filterFromArg(flag, value, { ...common, alias: label });
}

/** @type {(filter: Filter) => [FilterFlag, string] | undefined} */
function filterArgCandidate(filter) {
  const { meta, query } = filter;
  const { key, type, params, negate, disabled } = meta;
  const prefix = disabled ? '%' : '';
  const operator = negate ? '!=' : '=';

  if (type === 'custom' && query) {
    return ['filter-dsl', `${prefix}${negate ? '^' : ''}${JSON.stringify(query)}`];
  }
  if (typeof key !== 'string') return undefined;
  if (type === 'exists') return ['filter-exists', `${prefix}${negate ? '^' : ''}${key}`];
  if (type === 'phrase' && isRisonObject(params)) {
    const { query: value } = params;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return ['filter', `${prefix}${key}${operator}${value}`];
    }
  }
  if (type === 'phrases') {
    const values = asStringArray(params);
    if (values) return ['filter-in', `${prefix}${key}${operator}${values.join(',')}`];
  }
  if (type === 'range' && isRisonObject(params)) {
    const { gte, lt } = params;
    if ((gte === undefined || typeof gte === 'string' || typeof gte === 'number') &&
        (lt === undefined || typeof lt === 'string' || typeof lt === 'number')) {
      return ['filter-range', `${prefix}${key}${operator}${gte ?? ''}..${lt ?? ''}`];
    }
  }
  return undefined;
}

/** @type {(text: string) => [string, SortDirection]} */
function parseSort(text) {
  const colonIndex = text.lastIndexOf(':');
  const direction = colonIndex > 0 ? text.slice(colonIndex + 1).toLowerCase() : '';
  if (direction === 'asc' || direction === 'desc') return [text.slice(0, colonIndex), direction];
  return [text, 'desc'];
}

/** @type {(command: string, groups: string[][]) => string} */
function formatCommandLine(command, groups) {
  const lines = [command, ...groups.map((group) => `  ${group.map(shellQuote).join(' ')}`)];
  return `${lines.join(' \\\n')}\n`;
}

/** @type {(text: string) => string} */
function shellQuote(text) {
  if (text === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./^-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// cli: params from command-line values
// ---------------------------------------------------------------------------

/** @type {(values: CliValues, tokens: CliTokens) => Promise<CliParams>} */
async function paramsFromValues(values, tokens) {
  if (values.output !== undefined) throw new Error('--output requires --parse');

  /** @type {DiscoverUrlParams} */
  const base = values.params ? await readParamsFile(values.params) : {};
  const cliValues = /** @type {Record<string, string | boolean | string[] | undefined>} */ (values);

  /** @type {Record<string, unknown>} */
  const merged = { ...base };
  for (const [name, kind] of Object.entries(PARAM_OPTIONS)) {
    const value = cliValues[name];
    if (value !== undefined) merged[camelCase(name)] = paramFromCli(name, kind, value);
  }
  if ([values.esql, values.kql, values.lucene].some((value) => value !== undefined)) {
    for (const key of ['esql', 'kql', 'lucene']) if (cliValues[key] === undefined) delete merged[key];
  }
  const filters = [...(base.filters ?? []), ...filtersFromCli(tokens)];
  if (filters.length) merged.filters = filters;
  if (values.open) merged.open = true;
  return /** @type {CliParams} */ (merged);
}

/** @type {(name: string, kind: ParamKind, value: string | boolean | string[]) => unknown} */
function paramFromCli(name, kind, value) {
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (kind !== 'list') return value;
    return value.flatMap((text) => text.split(',').map((item) => item.trim()).filter(Boolean));
  }
  if (kind === 'integer') return parseInteger(name, value);
  if (kind === 'json') return parseJsonObject(name, value);
  return value;
}

/** @type {(values: CliValues) => Promise<void>} */
async function runParse(values) {
  const extra = Object.keys(values).filter((key) => key !== 'parse' && key !== 'output');
  if (extra.length) {
    throw new Error(`--parse can only be combined with --output (got --${extra.join(', --')})`);
  }
  const { parse = '' } = values;
  const input = parse === '-' ? await readTextFile('-') : parse;
  const output = parseChoice('output', values.output, OUTPUT_FORMATS) ?? 'args';
  const { params, warnings } = parseDiscoverUrl(input);
  for (const warning of warnings) process.stderr.write(`discover-url: warning: ${warning}\n`);
  if (output === 'json') process.stdout.write(formatParamsJson(params));
  else process.stdout.write(formatCommandLine(commandName(), paramsToArgGroups(params)));
}

/** @type {(params: DiscoverUrlParams) => string} */
function formatParamsJson(params) {
  const lines = Object.entries(params).map(([key, value]) => {
    if (key !== 'filters' || !Array.isArray(value)) return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    const filters = value.map((filter) => `    ${JSON.stringify(filter)}`);
    return `  "filters": [\n${filters.join(',\n')}\n  ]`;
  });
  return lines.length ? `{\n${lines.join(',\n')}\n}\n` : '{}\n';
}

// ---------------------------------------------------------------------------
// filter helpers
// ---------------------------------------------------------------------------

/** @type {(meta: FilterMetaFields, query: RisonObject, options: FilterOptions) => Filter} */
function createFilter(meta, query, options) {
  const { negate = false, disabled = false, pinned = false, alias, index } = options;
  return {
    meta: {
      alias: alias ?? null,
      disabled,
      negate,
      ...(index ? { index } : {}),
      ...meta,
    },
    query,
    $state: { store: pinned ? 'globalState' : 'appState' },
  };
}

/** @type {(filter: Filter) => boolean} */
function isPinned(filter) {
  return filter.$state?.store === 'globalState';
}

// ---------------------------------------------------------------------------
// rison helpers (mirrors rison-node)
// ---------------------------------------------------------------------------

const RISON_ID_OK = /^[^-0-9 '!:(),*@$][^ '!:(),*@$]*$/;

/** @type {(value: string) => string} */
function risonString(value) {
  if (value === '') return "''";
  if (RISON_ID_OK.test(value)) return value;
  return `'${value.replace(/['!]/g, (char) => `!${char}`)}'`;
}

/** @type {(value: number) => string} */
function risonNumber(value) {
  if (!Number.isFinite(value)) return '!n';
  return String(value).replace(/\+/, '');
}

/** @type {(key: string) => string} */
function risonKey(key) {
  const isNumeric = Number.isFinite(Number(key)) && !Number.isNaN(parseInt(key, 10));
  return isNumeric ? risonNumber(Number(key)) : risonString(key);
}

const RISON_NOT_ID_CHARS = " '!:(),*@$";
const RISON_NUMBER = /^-?\d+(?:\.\d+)?(?:e-?\d+)?/i;

/** @type {(parser: RisonParser, message: string) => Error} */
function risonError(parser, message) {
  return new Error(`rison: ${message} at position ${parser.index}`);
}

/** @type {(parser: RisonParser) => RisonValue} */
function risonParseValue(parser) {
  const { text, index } = parser;
  const char = text[index];
  if (char === undefined) throw risonError(parser, 'unexpected end of input');

  if (char === '!') {
    const next = text[index + 1];
    parser.index += 2;
    if (next === 't') return true;
    if (next === 'f') return false;
    if (next === 'n') return null;
    if (next === '(') return risonParseList(parser, ')', risonParseValue);
    parser.index = index;
    throw risonError(parser, `unknown literal "!${next ?? ''}"`);
  }
  if (char === '(') {
    parser.index += 1;
    return Object.fromEntries(risonParseList(parser, ')', risonParseEntry));
  }
  if (char === "'") {
    parser.index += 1;
    return risonParseQuoted(parser);
  }
  if (char === '-' || (char >= '0' && char <= '9')) return risonParseNumber(parser);
  return risonParseId(parser);
}

/** @type {<T>(parser: RisonParser, close: string, parseItem: (parser: RisonParser) => T) => T[]} */
function risonParseList(parser, close, parseItem) {
  /** @type {Array<ReturnType<typeof parseItem>>} */
  const items = [];
  if (parser.text[parser.index] === close) {
    parser.index += 1;
    return items;
  }
  for (;;) {
    items.push(parseItem(parser));
    const char = parser.text[parser.index];
    if (char === close) {
      parser.index += 1;
      return items;
    }
    if (char !== ',') throw risonError(parser, `expected "," or "${close}"`);
    parser.index += 1;
  }
}

/** @type {(parser: RisonParser) => [string, RisonValue]} */
function risonParseEntry(parser) {
  const key = risonParseValue(parser);
  if (typeof key !== 'string' && typeof key !== 'number') {
    throw risonError(parser, 'expected an object key');
  }
  if (parser.text[parser.index] !== ':') throw risonError(parser, 'expected ":"');
  parser.index += 1;
  return [String(key), risonParseValue(parser)];
}

/** @type {(parser: RisonParser) => string} */
function risonParseQuoted(parser) {
  const { text } = parser;
  let result = '';
  for (;;) {
    const char = text[parser.index];
    if (char === undefined) throw risonError(parser, 'unterminated string');
    parser.index += 1;
    if (char === "'") return result;
    if (char !== '!') {
      result += char;
      continue;
    }
    const escaped = text[parser.index];
    if (escaped !== '!' && escaped !== "'") throw risonError(parser, 'invalid string escape');
    parser.index += 1;
    result += escaped;
  }
}

/** @type {(parser: RisonParser) => number} */
function risonParseNumber(parser) {
  const match = RISON_NUMBER.exec(parser.text.slice(parser.index));
  if (!match) throw risonError(parser, 'invalid number');
  parser.index += match[0].length;
  return Number(match[0]);
}

/** @type {(parser: RisonParser) => string} */
function risonParseId(parser) {
  const { text } = parser;
  const start = parser.index;
  while (parser.index < text.length && !RISON_NOT_ID_CHARS.includes(text[parser.index])) {
    parser.index += 1;
  }
  if (parser.index === start) throw risonError(parser, `unexpected "${text[start]}"`);
  return text.slice(start, parser.index);
}

// ---------------------------------------------------------------------------
// cli helpers (node only)
// ---------------------------------------------------------------------------

const CLI_OPTIONS = /** @type {const} */ ({
  kibana: { type: 'string' },
  space: { type: 'string' },
  params: { type: 'string' },
  open: { type: 'boolean' },
  esql: { type: 'string' },
  kql: { type: 'string' },
  lucene: { type: 'string' },
  'data-view': { type: 'string' },
  'saved-query': { type: 'string' },
  'saved-search': { type: 'string' },
  session: { type: 'string' },
  'tab-id': { type: 'string' },
  'tab-label': { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  refresh: { type: 'string' },
  'refresh-paused': { type: 'boolean' },
  filter: { type: 'string', multiple: true },
  'filter-in': { type: 'string', multiple: true },
  'filter-range': { type: 'string', multiple: true },
  'filter-exists': { type: 'string', multiple: true },
  'filter-dsl': { type: 'string', multiple: true },
  'filter-json': { type: 'string', multiple: true },
  'filter-label': { type: 'string', multiple: true },
  'pin-filters': { type: 'boolean' },
  columns: { type: 'string', multiple: true },
  sort: { type: 'string', multiple: true },
  grid: { type: 'string' },
  interval: { type: 'string' },
  breakdown: { type: 'string' },
  'view-mode': { type: 'string' },
  'hide-aggregated-preview': { type: 'boolean' },
  'hide-chart': { type: 'boolean' },
  'hide-table': { type: 'boolean' },
  'hide-sidebar': { type: 'boolean' },
  'sample-size': { type: 'string' },
  'rows-per-page': { type: 'string' },
  'row-height': { type: 'string' },
  'header-row-height': { type: 'string' },
  density: { type: 'string' },
  'display-mode': { type: 'string' },
  'esql-approximation': { type: 'boolean' },
  'doc-id': { type: 'string' },
  'doc-index': { type: 'string' },
  'doc-routing': { type: 'string' },
  'profile-state': { type: 'string' },
  parse: { type: 'string' },
  output: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
});

const FILTER_FLAGS = /** @type {const} */ ([
  'filter',
  'filter-in',
  'filter-range',
  'filter-exists',
  'filter-dsl',
  'filter-json',
]);
const OUTPUT_FORMATS = /** @type {const} */ (['args', 'json']);
const FILTER_LABEL_ERROR = '--filter-label must be followed by a filter option';

/** @type {(args: string[]) => Promise<ReturnType<typeof import('node:util').parseArgs<CliConfig>>>} */
async function parseCliArgs(args) {
  const { parseArgs } = await import('node:util');
  return parseArgs({
    args,
    options: CLI_OPTIONS,
    strict: true,
    allowPositionals: false,
    allowNegative: true,
    tokens: true,
  });
}

/** @type {(name: string, text: string) => RisonValue} */
function parseJson(name, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`--${name}: invalid JSON: ${/** @type {Error} */ (error).message}`);
  }
}

/** @type {(name: string, text: string) => RisonObject} */
function parseJsonObject(name, text) {
  const value = parseJson(name, text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`--${name}: expected a JSON object`);
  }
  return value;
}

/** @type {(name: string, text: string | undefined) => number | undefined} */
function parseInteger(name, text) {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value)) throw new Error(`--${name}: expected an integer, got "${text}"`);
  return value;
}

/** @type {<T extends string>(name: string, text: string | undefined, choices: readonly T[]) => T | undefined} */
function parseChoice(name, text, choices) {
  if (text === undefined) return undefined;
  const choice = choices.find((candidate) => candidate === text);
  if (!choice) throw new Error(`--${name}: expected one of ${choices.join(', ')}, got "${text}"`);
  return choice;
}

/** @type {(name: string, text: string) => { field: string; value: string; negate: boolean }} */
function parseFieldAssignment(name, text) {
  const equalsIndex = text.indexOf('=');
  if (equalsIndex <= 0) throw new Error(`--${name}: expected FIELD=VALUE, got "${text}"`);
  const negate = text[equalsIndex - 1] === '!';
  const field = text.slice(0, negate ? equalsIndex - 1 : equalsIndex).trim();
  if (!field) throw new Error(`--${name}: missing field name in "${text}"`);
  return { field, value: text.slice(equalsIndex + 1), negate };
}

/** @type {(text: string) => string | number | undefined} */
function parseRangeBound(text) {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const asNumber = Number(trimmed);
  return Number.isFinite(asNumber) ? asNumber : trimmed;
}

/** @type {(file: string) => Promise<string>} */
async function readTextFile(file) {
  const { readFileSync } = await import('node:fs');
  return file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
}

/** @type {(file: string) => Promise<DiscoverUrlParams>} */
async function readParamsFile(file) {
  const text = await readTextFile(file);
  return /** @type {DiscoverUrlParams} */ (parseJsonObject('params', text));
}

/** @type {(text: string) => { rest: string; disabled: boolean; negate: boolean }} */
function parseFilterModifiers(text) {
  let rest = text.trimStart();
  let disabled = false;
  let negate = false;
  while (/^[%!^]/.test(rest)) {
    if (rest.startsWith('%')) disabled = true;
    else negate = true;
    rest = rest.slice(1);
  }
  return { rest, disabled, negate };
}

/** @type {(name: string, text: string) => { field: string; value: string; disabled: boolean; negate: boolean }} */
function parseFieldFilter(name, text) {
  const { rest, disabled, negate: prefixNegate } = parseFilterModifiers(text);
  const { field, value, negate } = parseFieldAssignment(name, rest);
  return { field, value, disabled, negate: prefixNegate || negate };
}

/** @type {(name: string) => name is FilterFlag} */
function isFilterFlag(name) {
  return FILTER_FLAGS.some((flag) => flag === name);
}

/** @type {(tokens: CliTokens) => FilterParam[]} */
function filtersFromCli(tokens) {
  /** @type {FilterParam[]} */
  const filters = [];
  /** @type {string | undefined} */
  let label;
  for (const token of tokens) {
    if (token.kind !== 'option' || token.value === undefined) continue;
    const { name, value } = token;
    if (name === 'filter-label') {
      if (label !== undefined) throw new Error(FILTER_LABEL_ERROR);
      label = value;
      continue;
    }
    if (!isFilterFlag(name)) continue;
    if (name === 'filter-json' && label !== undefined) {
      throw new Error('--filter-label can not be used with --filter-json; set meta.alias instead');
    }
    const param = name === 'filter-json' ? parseJson(name, value) : value;
    filters.push(/** @type {FilterParam} */ (withoutUndefined({ [camelCase(name)]: param, label })));
    label = undefined;
  }
  if (label !== undefined) throw new Error(FILTER_LABEL_ERROR);
  return filters;
}

/** @type {(name: FilterFlag, text: string, common: FilterOptions) => Filter[]} */
function filterFromArg(name, text, common) {
  switch (name) {
    case 'filter': {
      const { field, value, disabled, negate } = parseFieldFilter(name, text);
      return [phraseFilter(field, value, { ...common, disabled, negate })];
    }
    case 'filter-in': {
      const { field, value, disabled, negate } = parseFieldFilter(name, text);
      const items = value.split(',').map((item) => item.trim()).filter(Boolean);
      if (!items.length) throw new Error(`--filter-in: no values in "${text}"`);
      return [phrasesFilter(field, items, { ...common, disabled, negate })];
    }
    case 'filter-range': {
      const { field, value, disabled, negate } = parseFieldFilter(name, text);
      const separator = value.indexOf('..');
      if (separator < 0) throw new Error(`--filter-range: expected FIELD=FROM..TO, got "${text}"`);
      const gte = parseRangeBound(value.slice(0, separator));
      const lt = parseRangeBound(value.slice(separator + 2));
      if (gte === undefined && lt === undefined) {
        throw new Error(`--filter-range: at least one bound is required in "${text}"`);
      }
      /** @type {RangeParams} */
      const range = {};
      if (gte !== undefined) range.gte = gte;
      if (lt !== undefined) range.lt = lt;
      return [rangeFilter(field, range, { ...common, disabled, negate })];
    }
    case 'filter-exists': {
      const { rest, disabled, negate } = parseFilterModifiers(text);
      const field = rest.trim();
      if (!field) throw new Error('--filter-exists: missing field name');
      return [existsFilter(field, { ...common, disabled, negate })];
    }
    case 'filter-dsl': {
      const { rest, disabled, negate } = parseFilterModifiers(text);
      const query = parseJsonObject(name, rest);
      return [customFilter(query, { ...common, disabled, negate })];
    }
    case 'filter-json':
      return filtersFromJson(parseJson(name, text));
  }
}

/** @type {(value: unknown) => Filter[]} */
function filtersFromJson(value) {
  const items = Array.isArray(value) ? value : [value];
  /** @type {Filter[]} */
  const filters = [];
  for (const item of items) {
    if (!isFilter(item)) throw new Error('--filter-json: expected Filter object(s) with a "meta" property');
    filters.push(item);
  }
  return filters;
}

/** @type {(url: string) => Promise<void>} */
async function openUrl(url) {
  const { execFileSync } = await import('node:child_process');
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFileSync(command, [url], { stdio: 'ignore' });
}

/** @type {() => string} */
function commandName() {
  // `discover-url` when installed via npm, `discover-url.js` when run directly
  return process.argv[1]?.split(/[\\/]/).pop() || 'discover-url.js';
}

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/** @typedef {{ from: string; to: string }} TimeRange */
/** @typedef {{ pause: boolean; value: number }} RefreshInterval */
/** @typedef {{ language: 'kuery' | 'lucene'; query: string }} KueryOrLuceneQuery */
/** @typedef {{ esql: string }} EsqlQuery */
/** @typedef {KueryOrLuceneQuery | EsqlQuery} DiscoverQuery */
/** @typedef {{ id: string; index: string; routing?: string }} ExpandedDoc */
/** @typedef {{ id: string; label?: string }} DiscoverTab */
/** @typedef {(typeof PARAM_OPTIONS)[keyof typeof PARAM_OPTIONS]} ParamKind */

/**
 * Discover's URL state, in the shape of Discover's own locator parameters.
 * @typedef {{
 *   kibanaUrl?: string;
 *   spaceId?: string;
 *   savedSearchId?: string;
 *   searchSessionId?: string;
 *   tab?: DiscoverTab;
 *   esql?: string;
 *   kql?: string;
 *   lucene?: string;
 *   dataViewId?: string;
 *   timeRange?: TimeRange;
 *   refreshInterval?: RefreshInterval;
 *   filters?: Filter[];
 *   columns?: string[];
 *   sort?: Array<[string, SortDirection]>;
 *   grid?: RisonObject;
 *   savedQuery?: string;
 *   interval?: string;
 *   viewMode?: ViewMode;
 *   hideAggregatedPreview?: boolean;
 *   breakdownField?: string;
 *   hideChart?: boolean;
 *   hideTable?: boolean;
 *   hideSidebar?: boolean;
 *   sampleSize?: number;
 *   rowHeight?: number;
 *   headerRowHeight?: number;
 *   rowsPerPage?: number;
 *   density?: Density;
 *   documentsDisplayMode?: DocumentsDisplayMode;
 *   esqlApproximation?: boolean;
 *   expandedDoc?: ExpandedDoc;
 *   profileState?: RisonObject;
 * }} UrlState
 */

/** @typedef {{ text: string; index: number }} RisonParser */
/** @typedef {DiscoverUrlParams & { open?: boolean; help?: boolean }} CliParams */
/** @typedef {(typeof FILTER_FLAGS)[number]} FilterFlag */

/**
 * @typedef {{
 *   args: string[];
 *   options: typeof CLI_OPTIONS;
 *   strict: true;
 *   allowPositionals: false;
 *   allowNegative: true;
 *   tokens: true;
 * }} CliConfig
 */

/** @typedef {Awaited<ReturnType<typeof parseCliArgs>>['values']} CliValues */
/** @typedef {Awaited<ReturnType<typeof parseCliArgs>>['tokens']} CliTokens */

// ---------------------------------------------------------------------------
// help text
// ---------------------------------------------------------------------------

/** @type {() => string} */
function helpText() {
  return `usage: ${commandName()} [options]

Prints a Kibana Discover URL built from the options.

connection:
  --kibana URL              Kibana base URL incl. base path ($KIBANA_URL, default ${DEFAULT_KIBANA_URL})
  --space ID                Kibana space id
  --params FILE             JSON file (or - for stdin) with the options (see JSON below); options
                            override it, and filter options are added to its filters
  --open                    also open the URL in the browser

parsing an existing URL:
  --parse URL               print the options for an existing Discover URL, #/... fragment,
                            or _a=...&_g=... query string (- reads it from stdin)
  --output FORMAT           with --parse: args (command-line options, default) or
                            json (the same options as JSON, for --params or buildDiscoverUrl())

query and data:
  --esql QUERY              ES|QL query (switches to ES|QL mode)
  --kql QUERY               KQL query
  --lucene QUERY            Lucene query
  --data-view ID            data view id (not used with --esql)
  --saved-query ID          saved query id
  --saved-search ID         open a saved Discover session
  --session ID              search session id
  --tab-label LABEL         open the URL in a new Discover tab with this label
  --tab-id ID               select an open Discover tab (default new with --tab-label)

time:
  --from TIME               start time, e.g. now-24h or 2026-10-31T00:00:00Z (default now-15m if --to given)
  --to TIME                 end time (default now if --from given)
  --refresh MS              auto-refresh interval in ms (enables auto-refresh)
  --refresh-paused          set the refresh interval but leave auto-refresh paused
                            (interval defaults to 60000 when --refresh is not given)

filters (repeatable):
  --filter FIELD=VALUE      "is" filter
  --filter-in FIELD=V1,V2   "is one of" filter
  --filter-range FIELD=A..B "is between" filter (gte A, lt B; either side may be empty)
  --filter-exists FIELD     "exists" filter
  --filter-dsl JSON         custom query DSL filter
  --filter-json JSON        raw Filter object or array of Filter objects (used as-is)
  --filter-label LABEL      custom label for the next filter option, e.g.
                            --filter-label Errors --filter-exists error.message
  --pin-filters             pin the filters given on the command line

  modifiers (any filter flag except --filter-json):
    FIELD!=VALUE         negate
    leading ^ or !       negate (! needs quoting in interactive shells; ^ does not in bash)
    leading %            add the filter disabled
  e.g. --filter %kibana.task.type!=alerting:.es-query   --filter-exists %^error.message
  filters get meta.index from --data-view, and can not be used with --esql

layout:
  --columns A,B,C           columns (repeatable)
  --sort FIELD[:asc|desc]   sort (repeatable, default desc)
  --grid JSON               data grid settings, e.g. '{"columns":{"message":{"width":400}}}'
  --interval INTERVAL       histogram interval (auto, ms, s, m, h, d, w, M, y)
  --breakdown FIELD         histogram breakdown field
  --view-mode MODE          documents | patterns | aggregated
  --hide-aggregated-preview hide field statistics previews
  --hide-chart              hide the histogram
  --hide-table              hide the documents table
  --hide-sidebar            collapse the field list
  --sample-size N           number of documents to fetch
  --rows-per-page N         grid rows per page
  --row-height N            row height in lines (--row-height=-1 for auto)
  --header-row-height N     header row height in lines (--header-row-height=-1 for auto)
  --density MODE            compact | normal | expanded
  --display-mode MODE       table | json
  --esql-approximation      approximate ES|QL execution
  --doc-id ID               open the document flyout for this document id
  --doc-index INDEX         index of the --doc-id document
  --doc-routing ROUTING     routing of the --doc-id document
  --profile-state JSON      profile URL state (_p)

  boolean options can be negated with --no-, e.g. --no-hide-chart writes hideChart:!f

JSON (--params, --output json, and buildDiscoverUrl()):
  the options as camelCase keys, e.g. --data-view X --hide-sidebar is
    {"dataView": "X", "hideSidebar": true}
  --columns and --sort are arrays; --grid and --profile-state are objects
  filters are an ordered array with one key per filter option, e.g.
    "filters": [{"filter": "event.provider=alerting"}, {"filterExists": "^error.message"}]
  with filterJson values as Filter objects instead of JSON strings, and --filter-label as a
  label key on the filter it applies to, e.g. {"filterExists": "error.message", "label": "Errors"}

  -h, --help                show this help
`;
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

// Node only detects named exports (for `import { ... } from 'discover-url'`) when
// `module.exports` is assigned an object literal, so the list is repeated for the browser.
if (typeof module === 'object') {
  module.exports = {
    DEFAULT_KIBANA_URL,
    NEW_TAB_ID,
    buildDiscoverUrl,
    parseDiscoverUrl,
    paramsToArgs,
    phraseFilter,
    phrasesFilter,
    rangeFilter,
    existsFilter,
    customFilter,
    risonEncode,
    risonDecode,
    encodeUriQuery,
    paramsFromArgs,
    main,
  };
  if (require.main === module) main().then((exitCode) => (process.exitCode = exitCode));
} else {
  Object.assign(globalThis, {
    discoverUrl: {
      DEFAULT_KIBANA_URL,
      NEW_TAB_ID,
      buildDiscoverUrl,
      parseDiscoverUrl,
      paramsToArgs,
      phraseFilter,
      phrasesFilter,
      rangeFilter,
      existsFilter,
      customFilter,
      risonEncode,
      risonDecode,
      encodeUriQuery,
    },
  });
}

})();

// ---------------------------------------------------------------------------
// public types (outside the function, so TypeScript can export them)
// ---------------------------------------------------------------------------

/**
 * Any value that can be rison-encoded; `undefined` values are omitted.
 * @typedef {boolean | string | number | null | undefined | RisonArray | RisonObject} RisonValue
 */

/** @typedef {RisonValue[]} RisonArray */
/** @typedef {{ [key: string]: RisonValue }} RisonObject */
/** @typedef {'appState' | 'globalState'} FilterStore */

/**
 * @typedef {{
 *   key?: string;
 *   type?: string;
 *   value?: string;
 *   params?: RisonValue;
 * }} FilterMetaFields
 */

/**
 * @typedef {FilterMetaFields & {
 *   alias: string | null;
 *   disabled: boolean;
 *   negate: boolean;
 *   index?: string;
 *   [key: string]: RisonValue;
 * }} FilterMeta
 */

/**
 * A Kibana filter pill.
 * @typedef {{
 *   meta: FilterMeta;
 *   query?: RisonObject;
 *   $state?: { store: FilterStore };
 *   [key: string]: RisonValue;
 * }} Filter
 */

/**
 * Options for the filter builders:
 * - negate: exclude matching documents instead of including them
 * - disabled: add the filter pill, but leave it disabled
 * - pinned: pin the filter (stored in `_g`, follows the user across apps)
 * - alias: custom label for the filter pill
 * - index: data view id the filter belongs to
 * @typedef {{
 *   negate?: boolean;
 *   disabled?: boolean;
 *   pinned?: boolean;
 *   alias?: string;
 *   index?: string;
 * }} FilterOptions
 */

/**
 * @typedef {{
 *   gte?: string | number;
 *   gt?: string | number;
 *   lte?: string | number;
 *   lt?: string | number;
 *   format?: string;
 * }} RangeParams
 */

/** @typedef {'asc' | 'desc'} SortDirection */
/** @typedef {'documents' | 'patterns' | 'aggregated'} ViewMode */
/** @typedef {'compact' | 'normal' | 'expanded'} Density */
/** @typedef {'table' | 'json'} DocumentsDisplayMode */

/**
 * Parameters for buildDiscoverUrl(), --params, and --output json: the command-line options as
 * camelCase keys (see `discover-url.js --help` for what each one does).
 * - repeatable options are arrays: `columns` (field names) and `sort` (`FIELD[:asc|desc]`)
 * - filters are an ordered array of FilterParam, one per filter option
 * - grid and profileState are objects, not JSON strings
 * @typedef {{
 *   kibana?: string;
 *   space?: string;
 *   savedSearch?: string;
 *   session?: string;
 *   tabId?: string;
 *   tabLabel?: string;
 *   esql?: string;
 *   kql?: string;
 *   lucene?: string;
 *   dataView?: string;
 *   savedQuery?: string;
 *   from?: string;
 *   to?: string;
 *   refresh?: number;
 *   refreshPaused?: boolean;
 *   pinFilters?: boolean;
 *   filters?: FilterParam[];
 *   columns?: string[];
 *   sort?: string[];
 *   grid?: RisonObject;
 *   interval?: string;
 *   breakdown?: string;
 *   viewMode?: ViewMode;
 *   hideAggregatedPreview?: boolean;
 *   hideChart?: boolean;
 *   hideTable?: boolean;
 *   hideSidebar?: boolean;
 *   sampleSize?: number;
 *   rowsPerPage?: number;
 *   rowHeight?: number;
 *   headerRowHeight?: number;
 *   density?: Density;
 *   displayMode?: DocumentsDisplayMode;
 *   esqlApproximation?: boolean;
 *   docId?: string;
 *   docIndex?: string;
 *   docRouting?: string;
 *   profileState?: RisonObject;
 * }} DiscoverUrlParams
 */

/**
 * One filter, keyed by its filter option in camelCase, e.g. `{ filter: 'event.provider=alerting' }`
 * or `{ filterJson: phraseFilter('event.provider', 'alerting') }`.
 * A `label` (from --filter-label) sets the pill's custom label, except for filterJson.
 * @typedef {({ filter: string } | { filterIn: string } | { filterRange: string } | { filterExists: string }
 *   | { filterDsl: string }) & { label?: string } | { filterJson: Filter | Filter[] }} FilterParam
 */

/**
 * Result of parseDiscoverUrl(); warnings list URL state that couldn't be represented.
 * @typedef {{ params: DiscoverUrlParams; warnings: string[] }} ParsedDiscoverUrl
 */
