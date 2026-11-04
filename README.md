sera - web pages that analyze Elastic resources
================================================================================

`sera` is a set of static web pages that analyze Elastic resources, like the
Kibana Task Manager health report and Kibana event log documents.  Paste JSON
into a page, drop a file on it, or load a file; the data stays in your
browser.

The pages are hosted with GitHub Pages at <https://pmuellr.github.io/sera/>.

| page                                    | analyzes
| --------------------------------------- | ---------------------------------------------
| [Task Manager health][]                 | the output of `GET kbn:/api/task_manager/_health`
| [event log][]                           | documents from `.kibana-event-log-*`, as search or ES\|QL responses, JSON arrays, or NDJSON

The pages link to Kibana Discover, using [discover-url][], for the documents
behind the analysis.  Set the Kibana URL and the event log data view in the
"settings" menu at the top right of each page; they're saved in the browser's
local storage.  See the [discover-url examples][] for creating the
`.kibana-event-log-ds` data view the links use by default.

[Task Manager health]: https://pmuellr.github.io/sera/task-manager-health/index.html
[event log]: https://pmuellr.github.io/sera/event-log/index.html
[discover-url]: https://github.com/pmuellr/discover-url
[discover-url examples]: https://github.com/pmuellr/discover-url/blob/main/EXAMPLES.md


layout
================================================================================

Everything served by GitHub Pages is in the `docs` directory:

    docs/
      index.html              home page, listing the pages
      site/
        pages.js              the list of pages, used to build the menu
        site.js               the menu, settings, data input, tables, formatting
        site.css              shared styles
        globals.d.ts          types of the globals, for type checking
      vendor/
        discover-url.js       copied from node_modules by `npm install`
      task-manager-health/
        index.html
        task-manager-health.js
      event-log/
        index.html
        event-log.js

The pages use plain `<script src>` scripts rather than ES modules, so they
also work when opened from `file:` URLs.  `site.js` adds a `Site` global,
and `discover-url.js` adds a `discoverUrl` global.

`test/fixtures` contains sample data for each page.


adding a page
================================================================================

1. Copy an existing page's directory, like `docs/event-log`, to
   `docs/<id>`, and rename its script.

2. Add an entry for the page in `docs/site/pages.js`:

   ```js
   {
     id: '<id>',
     title: 'menu title',
     description: 'what the page analyzes, shown on the home page',
   },
   ```

The menu at the top of every page, and the list on the home page, are built
from `pages.js`, so nothing else needs to change.  `npm test` checks that each
page in `pages.js` exists and loads the shared resources.

A page's script typically:

- calls `Site.inputPanel({ storageKey, onData })` to get the paste, drop,
  and file input; `onData(text)` is called with the input, or with `''` when
  it's cleared
- parses the input with `Site.parseJsonValues(text)`, which handles single
  JSON values, NDJSON, and Dev Tools output
- renders the analysis with `Site.h()`, `Site.section()`, `Site.table()`, and
  `Site.findingsList()`
- builds Discover links with `Site.discoverLink()`, and re-renders on
  `Site.onSettingsChange()`


dependencies
================================================================================

npm dependencies that the pages use in the browser are copied into
`docs/vendor` by `npm run vendor`, which runs after `npm install`.  The
copies are committed, since GitHub Pages serves the `docs` directory as-is.
To add one, add it to the `FILES` list in `scripts/vendor.js`.

To update `discover-url` to the latest version on GitHub:

    npm update discover-url
    npm run vendor


development
================================================================================

    npm install           # install dependencies, and copy them to docs/vendor
    npm run serve         # serve docs at http://localhost:8080
    npm test              # check the pages are set up correctly
    npm run check         # type check the JavaScript

The pages can also be opened directly from the `docs` directory, without a
server.


GitHub Pages
================================================================================

In the repository's Settings, under Pages, set the source to "Deploy from a
branch", with the `main` branch and the `/docs` folder.  `docs/.nojekyll`
turns off Jekyll processing, so the files are served as-is.


license
================================================================================

This package is licensed under the MIT license.  See the [LICENSE.md][] file
for more information.


contributing
================================================================================

Awesome!  We're happy that you want to contribute.

Please read the [CONTRIBUTING.md][] file for more information.


[LICENSE.md]: LICENSE.md
[CONTRIBUTING.md]: CONTRIBUTING.md
