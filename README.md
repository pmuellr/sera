sera - static elasticsearch resource analysis
================================================================================

`sera`, static elasticsearch resource analysis, is a set of static web pages
that analyze Elastic resources, like the
Kibana Task Manager health report and Kibana event log documents.  Paste JSON
into a page, drop a file on it, or load a file; the data stays in your
browser.

The pages are hosted with GitHub Pages at <https://pmuellr.github.io/sera/>.

| page                                    | analyzes
| --------------------------------------- | ---------------------------------------------
| [Task Manager health][]                 | the output of `GET kbn:/api/task_manager/_health`
| [event log][]                           | documents from `.kibana-event-log-*`, as search or ES\|QL responses, JSON arrays, or NDJSON
| [rules][]                               | alerting rules, from `GET kbn:/api/alerting/rules/_find`, or a search of `.kibana*` for `type: alert`
| [connectors][]                          | connectors, from `GET kbn:/api/actions/connectors`, or a search of `.kibana*` for `type: action`
| [alerts][]                              | alert documents, from a search of `.alerts-*`

The rules, connectors, and alerts pages share their data.  A response pasted
into any of them is sorted into rules, connectors, and alerts, and saved in
the browser's IndexedDB, so each page can use what was loaded on the others:
the rules page checks each rule's connectors and alerts, the connectors page
finds the rules that use each connector, and so on.  The records link to each
other across the pages.  Each page shows the Dev Tools request for each kind
of data; the requests leave out API keys and secrets, and the pages drop them
if they're there anyway.  The data stays until it's cleared on one of the
pages.

The rules, alerts, and event log pages have a dropdown to select rule tags,
from the rules, the alerts' `kibana.alert.rule.tags`, and the event log's.
Selecting tags filters those pages to what has all of them; the selection is
shared by the pages, and saved in the browser's local storage, along with the
last 10 tags selected, which are listed first until the history is cleared.
Event log documents match with their own tags, or those of their rules, when
the rules are loaded.  The connectors page uses it too, when the rules are loaded:
connectors match when a rule that uses them has all of the selected tags.

The rules and connectors APIs return one space's rules and connectors, and
don't say which space.  The home page reads the space of each response from
its request; files named like `rules-space-<space id>.json` are read as that
space's.  The rules API doesn't return the rules' run durations
and success ratios, which the saved objects have; the event log has them too.

The pages link to Kibana Discover, using [discover-url][], for the documents
behind the analysis.  Set the Kibana URL and the event log data view in the
"settings" menu at the top right of each page; they're saved in the browser's
local storage.  See the [discover-url examples][] for creating the
`.kibana-event-log-ds` data view the links use by default.

The [home page][] shows the Kibana Dev Tools requests for the data of all the
pages: the Task Manager health, the spaces, and each space's rules and
connectors, from the Kibana APIs, and searches of the event log and alerts.
Paste them all into Dev Tools Console, run them together, and paste all of
the output back into the home page; it splits the output into each
request's response, works out what each one is, and stores it for its page.
The spaces in the requests are saved in the browser's local storage, and
loading the spaces response adds any that are missing.  Files of saved
responses can be loaded there too.  The health report and event log are stored in
the browser tab's session storage, so open their pages from the same tab.

[home page]: https://pmuellr.github.io/sera/
[Task Manager health]: https://pmuellr.github.io/sera/task-manager-health/index.html
[event log]: https://pmuellr.github.io/sera/event-log/index.html
[rules]: https://pmuellr.github.io/sera/rules/index.html
[connectors]: https://pmuellr.github.io/sera/connectors/index.html
[alerts]: https://pmuellr.github.io/sera/alerts/index.html
[discover-url]: https://github.com/pmuellr/discover-url
[discover-url examples]: https://github.com/pmuellr/discover-url/blob/main/EXAMPLES.md


layout
================================================================================

Everything served by GitHub Pages is in the `docs` directory:

    docs/
      index.html              home page, listing the pages
      site/
        home.js               the home page: the Dev Tools requests, and loading their output
        pages.js              the list of pages, used to build the menu
        site.js               the menu, settings, data input, tables, formatting
        site.css              shared styles
        favicon.svg           the icon for every page
        kibana-data.js        rules, connectors, and alerts, shared by their pages
        globals.d.ts          types of the globals, for type checking
      vendor/
        discover-url.js       copied from node_modules by `npm install`
      task-manager-health/
        index.html
        task-manager-health.js
      event-log/
        index.html
        event-log.js
      rules/                  rules.js
      connectors/             connectors.js
      alerts/                 alerts.js

The pages use plain `<script src>` scripts rather than ES modules, so they
also work when opened from `file:` URLs.  `site.js` adds a `Site` global,
`kibana-data.js` adds a `KibanaData` global, and `discover-url.js` adds a
`discoverUrl` global.  Whether pages opened from `file:` URLs share their
IndexedDB data depends on the browser.

`test/fixtures` contains synthetic sample data for each page.  Load all three
of the `*-search.json` files, together, into one of the rules, connectors,
or alerts pages to see the links between them.  The
`*-space-*.json` files are the same rules and connectors, from the APIs.

The rules, connectors, and alerts pages use `KibanaData.panel(kind,
onData)` instead of `Site.inputPanel()`; `onData(data)` is called with all
the loaded data, and its indexes, whenever it changes.  Links between them
are `<page>/index.html#id=<id>`, to show one record, or `#q=<text>`, to
filter the page's tables.


adding a page
================================================================================

1. Copy an existing page's directory, like `docs/event-log`, to
   `docs/<id>`, rename its script, and set its `<title>` to
   `sera - <menu title>`.

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
page in `pages.js` exists, has its title, and loads the shared resources.

A page's script typically:

- calls `Site.inputPanel({ storageKey, onData })` to get the paste, drop,
  and file input; `onData(text)` is called with the input, or with `''` when
  it's cleared; the home page stores files for the page under the same
  `storageKey` with `Site.saveInput()`, so add the page's file to `FILES` in
  `docs/site/home.js`
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
    npm test              # check the pages are set up correctly, and read the fixtures
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
