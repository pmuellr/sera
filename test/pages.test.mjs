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
    for (const resource of ['../site/site.css', '../site/pages.js', '../site/site.js']) {
      assert.ok(html.includes(`"${resource}"`), `${page.id}/index.html references ${resource}`);
    }
    assert.ok(html.indexOf('../site/pages.js') < html.indexOf('../site/site.js'),
      `${page.id}/index.html loads pages.js before site.js`);
  }
});

test('vendored resources exist', function () {
  assert.ok(fs.existsSync(path.join(DOCS, 'vendor', 'discover-url.js')), 'run npm install to copy discover-url.js');
});
