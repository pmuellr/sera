#!/usr/bin/env node
// @ts-check

// Copy browser resources from node_modules into docs/vendor, since GitHub
// Pages only serves the docs directory.  The copies are committed.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'docs', 'vendor');

/** files to copy, relative to node_modules */
const FILES = [
  'discover-url/discover-url.js',
];

main();

function main() {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  for (const file of FILES) {
    const src = path.join(ROOT, 'node_modules', file);
    const dst = path.join(VENDOR_DIR, path.basename(file));
    fs.copyFileSync(src, dst);
    console.log(`copied ${path.relative(ROOT, src)} to ${path.relative(ROOT, dst)}`);
  }
}
