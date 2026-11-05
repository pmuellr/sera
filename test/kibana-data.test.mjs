// Tests of reading search responses in docs/site/kibana-data.js, with the
// synthetic fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.join(import.meta.dirname, '..');

/**
 * Load site.js and kibana-data.js, with just enough of a browser to do so.
 * @returns {{ Site: typeof Site; KibanaData: typeof KibanaData }}
 */
function loadScripts() {
  const context = vm.createContext({
    document: {
      currentScript: { src: 'http://localhost/site/site.js' },
      addEventListener: function () {},
    },
    window: { addEventListener: function () {} },
    URL,
    URLSearchParams,
    console,
  });
  for (const file of ['docs/site/site.js', 'docs/site/kibana-data.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  return vm.runInContext('({ Site, KibanaData })', context);
}

/** @param {string} name */
function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', name), 'utf8'));
}

const { Site: site, KibanaData: kibanaData } = loadScripts();

test('classifies each kind of search response', function () {
  const { records, totals } = kibanaData.classify([
    fixture('rules-search.json'),
    fixture('connectors-search.json'),
    fixture('alerts-search.json'),
  ]);
  assert.equal(records.rules.length, 12);
  assert.equal(records.connectors.length, 4);
  assert.equal(records.alerts.length, 25);
  assert.deepEqual({ ...totals }, { rules: 12, connectors: 4, alerts: 25 });
});

test('reads msearch responses', function () {
  const { records } = kibanaData.classify([{ responses: [fixture('rules-search.json'), fixture('connectors-search.json')] }]);
  assert.equal(records.rules.length, 12);
  assert.equal(records.connectors.length, 4);
});

test('reads rules, with their connectors and space', function () {
  const { records } = kibanaData.classify([fixture('rules-search.json')]);
  const byName = new Map(records.rules.map(function (rule) { return [rule.name, rule]; }));

  const chat = byName.get('Error log spike');
  assert.equal(chat.id, '00000000-0000-4000-8000-000000000002');
  assert.equal(chat.intervalMs, 5 * 60 * 1000);
  assert.deepEqual(chat.actions.map(function (/** @type {RuleAction} */ action) { return action.connectorId; }),
    ['00000000-0000-4000-8000-000000000065', '00000000-0000-4000-8000-000000000066']);

  const security = byName.get('Slow security rule');
  assert.equal(security.id, '00000000-0000-4000-8000-000000000006');
  assert.equal(security.space, 'security');

  const preconfigured = byName.get('Server log via preconfigured connector').actions[0];
  assert.equal(preconfigured.connectorId, 'example-server-log');
  assert.equal(preconfigured.preconfigured, true);

  const failed = byName.get('Checkout latency');
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.statusReason, 'read');
});

test('drops secrets and API keys', function () {
  const { records } = kibanaData.classify([fixture('rules-search.json'), fixture('connectors-search.json')]);
  const text = JSON.stringify([...records.rules, ...records.connectors]);
  assert.equal(text.includes('ENCRYPTED-PLACEHOLDER'), false);
});

test('reads alerts', function () {
  const { records } = kibanaData.classify([fixture('alerts-search.json')]);
  const flapping = records.alerts.filter(function (alert) { return alert.flapping; });
  assert.equal(flapping.length, 3);
  assert.equal(records.alerts[0].ruleId, '00000000-0000-4000-8000-000000000001');
  assert.equal(records.alerts[0].status, 'active');
});

test('only attributes totals to a single kind', function () {
  const response = fixture('connectors-search.json');
  response.hits.total.value = 500;
  const { totals } = kibanaData.classify([response]);
  assert.equal(totals.connectors, 500);

  const mixed = fixture('connectors-search.json');
  mixed.hits.hits.push(...fixture('rules-search.json').hits.hits);
  assert.deepEqual({ ...kibanaData.classify([mixed]).totals }, {});

  const capped = fixture('alerts-search.json');
  capped.hits.total = { value: 25, relation: 'gte' };
  const cappedTotal = kibanaData.classify([capped]).totals.alerts;
  assert.equal(cappedTotal, Infinity);
  const cappedSet = { records: new Array(25), total: cappedTotal, source: 'test', loadedAt: '' };
  assert.equal(kibanaData.isComplete(cappedSet), false);
  assert.equal(kibanaData.countText(cappedSet), '25 of more');

  const dataSet = { records: new Array(4), total: 500, source: 'test', loadedAt: '' };
  assert.equal(kibanaData.isComplete(dataSet), false);
  assert.equal(kibanaData.isComplete({ ...dataSet, total: undefined }), true);
});

/** @param {string} name */
function fixtureFile(name) {
  return { name, text: fs.readFileSync(path.join(ROOT, 'test', 'fixtures', name), 'utf8') };
}

test('reads rules and connectors from the APIs, with the spaces from the file names', function () {
  const { records, totals } = kibanaData.classifyFiles([
    fixtureFile('rules-space-default.json'),
    fixtureFile('rules-space-security.json'),
    fixtureFile('connectors-space-default.json'),
    fixtureFile('connectors-space-security.json'),
  ]);
  assert.equal(records.rules.length, 12);
  assert.equal(totals.rules, 12);
  // the preconfigured and system connectors are in both spaces' files
  assert.equal(records.connectors.length, 6);
  assert.equal(totals.connectors, undefined);

  const byName = new Map(records.rules.map(function (rule) { return [rule.name, rule]; }));
  assert.equal(byName.get('Slow security rule').space, 'security');
  const chat = byName.get('Error log spike');
  assert.equal(chat.space, 'default');
  assert.equal(chat.id, '00000000-0000-4000-8000-000000000002');
  assert.equal(chat.type, '.es-query');
  assert.equal(chat.scheduledTaskId, chat.id);
  assert.equal(chat.p95, undefined);
  // the files are parsed in the vm context, so its arrays are copied to compare them
  assert.deepEqual([...chat.actions.map(function (/** @type {RuleAction} */ action) { return action.connectorId; })],
    ['00000000-0000-4000-8000-000000000065', '00000000-0000-4000-8000-000000000066']);

  const failed = byName.get('Checkout latency');
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.statusReason, 'read');
  assert.match(String(failed.outcomeMessage), /no such index/);

  const connectors = new Map(records.connectors.map(function (connector) { return [connector.id, connector]; }));
  const preconfigured = connectors.get('example-server-log');
  assert.equal(preconfigured.preconfigured, true);
  assert.equal(preconfigured.space, undefined);
  assert.equal(connectors.get('system-connector-.cases').system, true);
  const webhook = connectors.get('00000000-0000-4000-8000-000000000067');
  assert.equal(webhook.isMissingSecrets, true);
  assert.equal(webhook.space, 'default');
  assert.equal(webhook.referencedBy, 1);
});

test('reads API responses without a space', function () {
  const { records } = kibanaData.classify([fixture('rules-space-default.json')]);
  assert.equal(records.rules.length, 11);
  assert.equal(records.rules[0].space, undefined);
});

test('finds the space in file names', function () {
  assert.equal(kibanaData.spaceFromFileName('rules-space-default.json'), 'default');
  assert.equal(kibanaData.spaceFromFileName('connectors-space-my_team-2.json'), 'my_team-2');
  assert.equal(kibanaData.spaceFromFileName('rules-search.json'), undefined);
});

test('reads the rule tags of alerts, and combines them with the rules\' tags', function () {
  const { records } = kibanaData.classify([fixture('rules-search.json'), fixture('alerts-search.json')]);
  const alert = records.alerts.find(function (/** @type {Alert} */ item) { return item.ruleName === 'High CPU on hosts'; });
  assert.deepEqual([...alert.tags], ['infra']);

  const rule = records.rules.find(function (/** @type {Rule} */ item) { return item.id === alert.ruleId; });
  const data = { rulesById: new Map([[rule.id, { ...rule, tags: ['infra', 'prod'] }]]), rules: undefined, alerts: undefined };
  assert.deepEqual([...kibanaData.alertTags(/** @type {any} */ (data), alert)], ['infra', 'prod']);

  const all = kibanaData.allTags(/** @type {any} */ ({ rules: { records: records.rules }, alerts: { records: records.alerts } }));
  assert.deepEqual([...all].sort(), ['infra', 'logs', 'noisy', 'siem']);

  assert.equal(site.hasSelectedTags(['infra', 'prod'], ['infra', 'prod']), true);
  assert.equal(site.hasSelectedTags(['infra'], ['infra', 'prod']), false);
  assert.equal(site.hasSelectedTags([], []), true);
});

test('finds the space in requests', function () {
  assert.equal(kibanaData.spaceFromRequest('GET kbn:/api/alerting/rules/_find?per_page=10000'), 'default');
  assert.equal(kibanaData.spaceFromRequest('GET kbn:/s/my_team-2/api/actions/connectors'), 'my_team-2');
  assert.equal(kibanaData.spaceFromRequest('GET /s/security/api/actions/connectors'), 'security');
  assert.equal(kibanaData.spaceFromRequest('GET .alerts-*/_search?size=2000'), undefined);
  assert.equal(kibanaData.requestInSpace(kibanaData.KINDS.connectors.query, 'security'), 'GET kbn:/s/security/api/actions/connectors');
  assert.equal(kibanaData.requestInSpace(kibanaData.KINDS.connectors.query, 'default'), kibanaData.KINDS.connectors.query);
});

test('splits Dev Tools output into each request\'s response', function () {
  const rules = fixture('rules-space-security.json');
  const connectors = fixture('connectors-space-default.json');
  const output = [
    '# GET kbn:/s/security/api/alerting/rules/_find?per_page=10000 200 OK (31 ms)',
    JSON.stringify(rules, null, 2),
    '',
    '# GET kbn:/api/actions/connectors 200 OK',
    JSON.stringify(connectors, null, 2),
  ].join('\n');
  const parts = site.splitDevToolsOutput(output);
  assert.deepEqual([...parts.map(function (part) { return part.request; })],
    ['GET kbn:/s/security/api/alerting/rules/_find?per_page=10000', 'GET kbn:/api/actions/connectors']);
  assert.deepEqual(JSON.parse(parts[0].text), rules);
  assert.deepEqual(JSON.parse(parts[1].text), connectors);

  const classified = kibanaData.classifyFiles(parts.map(function (part) {
    return { name: String(part.request), text: part.text, space: kibanaData.spaceFromRequest(String(part.request)) };
  }));
  assert.ok(classified.records.rules.length > 0);
  assert.ok(classified.records.rules.every(function (/** @type {Rule} */ rule) { return rule.space === 'security'; }));

  assert.deepEqual([...site.splitDevToolsOutput('{"a": 1}')].map(function (part) { return { ...part }; }), [{ text: '{"a": 1}' }]);
});

test('parses intervals', function () {
  assert.equal(kibanaData.parseInterval('30s'), 30 * 1000);
  assert.equal(kibanaData.parseInterval('1d'), 24 * 60 * 60 * 1000);
  assert.equal(kibanaData.parseInterval('soon'), undefined);
});
