#!/usr/bin/env node
// @ts-check

// Write docs/demo/demo.sera.js, the demo data in docs/demo/demo.sera.json as
// a script, for pages opened from file: URLs, which can't fetch the JSON but
// can load scripts.  Run it after changing demo.sera.json; the copy is
// committed.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEMO_DIR = path.join(ROOT, 'docs', 'demo');
const SRC = path.join(DEMO_DIR, 'demo.sera.json');
const DST = path.join(DEMO_DIR, 'demo.sera.js');

main();

function main() {
  const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  fs.writeFileSync(DST, [
    '// generated from demo.sera.json by scripts/demo-script.js, for pages opened from file: URLs',
    `globalThis.seraDemoData = ${JSON.stringify(data)};`,
    '',
  ].join('\n'));
  console.log(`wrote ${path.relative(ROOT, DST)}`);
}
