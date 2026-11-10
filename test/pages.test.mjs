// @ts-check

// Checks that the pages in docs/site/pages.js exist and load the shared scripts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const DOCS = path.join(import.meta.dirname, '..', 'docs');

/** @type {{ id: string; title: string; description: string }[]} */
const pages = vm.runInNewContext(`${fs.readFileSync(path.join(DOCS, 'site', 'pages.js'), 'utf8')}; SITE_PAGES`);

test('pages have unique ids, titles, and descriptions', function () {
  assert.ok(pages.length > 0);
  assert.equal(new Set(pages.map(function (page) { return page.id; })).size, pages.length);
  for (const page of pages) {
    assert.match(page.id, /^[a-z0-9-]+$/, `id ${page.id}`);
    assert.ok(page.title, `title of ${page.id}`);
    assert.ok(page.description, `description of ${page.id}`);
  }
});

test('pages load the shared scripts and stylesheet', function () {
  for (const page of pages) {
    const file = path.join(DOCS, page.id, 'index.html');
    assert.ok(fs.existsSync(file), `${path.relative(DOCS, file)} exists`);

    const html = fs.readFileSync(file, 'utf8');
    for (const resource of ['../site/site.css', '../site/favicon.svg', '../site/pages.js', '../site/site.js']) {
      assert.ok(html.includes(`"${resource}"`), `${page.id}/index.html references ${resource}`);
    }
    assert.ok(html.includes(`<title>sera - ${page.title}</title>`), `${page.id}/index.html has the title "sera - ${page.title}"`);
    assert.ok(html.indexOf('../site/pages.js') < html.indexOf('../site/site.js'),
      `${page.id}/index.html loads pages.js before site.js`);
  }
});

test('the home page has the favicon', function () {
  assert.ok(fs.existsSync(path.join(DOCS, 'site', 'favicon.svg')));
  assert.ok(fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8').includes('"site/favicon.svg"'));
});

test('the home page loads home.js after the scripts it uses', function () {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const home = html.indexOf('"site/home.js"');
  assert.ok(home >= 0, 'index.html loads site/home.js');
  for (const script of ['site/pages.js', 'site/site.js', 'site/kibana-data.js']) {
    const index = html.indexOf(`"${script}"`);
    assert.ok(index >= 0 && index < home, `index.html loads ${script} before site/home.js`);
  }
});

test('the demo script has the demo data', function () {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(DOCS, 'demo', 'demo.sera.js'), 'utf8'), context);
  assert.equal(JSON.stringify(context.seraDemoData), JSON.stringify(JSON.parse(fs.readFileSync(path.join(DOCS, 'demo', 'demo.sera.json'), 'utf8'))),
    'run npm run demo after changing demo.sera.json');
});

test('vendored resources exist', function () {
  assert.ok(fs.existsSync(path.join(DOCS, 'vendor', 'discover-url.js')), 'run npm install to copy discover-url.js');
});
