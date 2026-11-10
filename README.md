sera - static elasticsearch resource analysis
================================================================================

`sera`, static elasticsearch resource analysis, is a set of static web pages
that analyze Elastic resources, like the
Kibana Task Manager health report and Kibana event log documents.  Paste JSON
into a page, drop a file on it, or load a file; the data stays in your
browser.

The pages are hosted with GitHub Pages at <https://pmuellr.github.io/sera/>,
with demo data loaded the first time they're opened.

| page                                    | analyzes
| --------------------------------------- | ---------------------------------------------
| [Task Manager health][]                 | the output of `GET kbn:/api/task_manager/_health`
| [event log][]                           | documents from `.kibana-event-log-*`, as search or ES\|QL responses, JSON arrays, or NDJSON
| [rules][]                               | alerting rules, from `GET kbn:/api/alerting/rules/_find`, or a search of `.kibana*` for `type: alert`
| [connectors][]                          | connectors, from `GET kbn:/api/actions/connectors`, or a search of `.kibana*` for `type: action`
| [alerts][]                              | alert documents, from a search of `.alerts-*`
| [TrailBlazer][]                         | browses all of the loaded data, by following the links between the records

The rules, connectors, alerts, and event log pages share their data; only
the Task Manager health page keeps its own.  A response pasted into any of
them is sorted into rules, connectors, alerts, and event log documents, and
saved in the browser's IndexedDB, so each page can use what was loaded on the
others: the rules page checks each rule's connectors and alerts, the
connectors page finds the rules that use each connector, the event log page
uses the rules' tags, and so on.  The records link to each
other across the pages.  Each page shows the Dev Tools request for each kind
of data; the requests leave out API keys and secrets, and the pages drop them
if they're there anyway.  The data stays until it's cleared on one of the
pages.

As well as displaying info on single-type resources, there's the 
TrailBlazer browser, loosely based on the IBM Smalltalk TrailBlazer Browser
from Chris Gerkin.  There's no good description I've found of it, but I
would describe it as an explorer of relationships of one object with
others.  As you click on things, you explore a new relationship or
fine tune on something specific.  Clicking on something generally opens
another pane to the right.  So yeah, [Gopher](https://en.wikipedia.org/wiki/Gopher_(protocol)) for Smalltalk resources.  Applicable to other object shapes tho!
Thanks for the memory, Chris!

Here's the demo:
[![TrailBlazer, following a trail from a rule to its alerts and event log documents](docs/demo/trailblazer.png)][TrailBlazer video]

[The TrailBlazer video][TrailBlazer video] starts on the home page with the
demo data, and follows a trail in TrailBlazer: from the rules, to a rule with
9 active alerts, to one of its alerts, to the event log documents for that
alert.

Each set of loaded data is a session, and the pages show the current one.
Loading a sera data file starts a new session, named for the file.
Responses pasted or loaded on the pages are added to the current session,
unless "add pasted and loaded responses to the current session" is turned
off, which starts a new one.  The data panel of each page, and the home
page, list the sessions, with what each has and its size as JSON, to pick
the current one or delete them, along with how much of the browser's
storage the site is using.  The current session is shared by the tabs.
The first time sera is opened in a browser, with no sessions, it loads the
demo data in `docs/demo/demo.sera.json` from the same site, as a session
named `demo.sera.json`; it isn't loaded again after that session is deleted.
While it's the current session, the pages say it's the demo, and responses
loaded on the pages start a new session instead of being added to it.
Pages opened from `file:` URLs can't fetch it, so they load the same data
from `docs/demo/demo.sera.js`; run `npm run demo` to regenerate it after
changing `demo.sera.json`.

The rules, alerts, and event log pages have a dropdown to select rule tags,
from the rules, the alerts' `kibana.alert.rule.tags`, and the event log's.
Selecting tags filters those pages to what has all of them; the selection is
shared by the pages, and saved in the browser's local storage, along with the
last 10 tags selected, which are listed first until the history is cleared.
Event log documents match with their own tags, or those of their rules, when
the rules are loaded.  The connectors page uses it too, when the rules are loaded:
connectors match when a rule that uses them has all of the selected tags.
The TrailBlazer page filters its rules, alerts, and event log documents the
same way.

Next to it, a dropdown selects spaces, from the spaces of the rules,
connectors, alerts, and event log documents; the pages show what is in any
of the selected spaces.  The selection is shared and saved like the tags.
Alerts and event log documents are in the spaces of their `kibana.space_ids`,
and connectors that the rules use but that aren't loaded are in their rules'
spaces.  Preconfigured and system connectors, and what is in every space,
`*`, are in all of them.  Neither filter applies to the health report.

The TrailBlazer page browses everything loaded, including the Task Manager
health report.
Selecting an item opens it in a pane to the right, replacing the panes after
it, and the arrow keys move up and down a list, and between the panes.
Searches are conditions on the fields of the documents and API responses,
run over the loaded data rather than Elasticsearch: a search's fields show
each field's values and how often they occur, and selecting a value adds it
to the search, as does selecting one of a record's fields.  A record's
related items are the records and searches linked to it: a rule's
connectors, alerts, and event log documents, the rules using a connector, an
alert's rule and the alerts and event log documents from the same rule run,
an event log document's saved objects and task, and the rules of the
alerting task types in the health report.  Event log and alert searches link
to Discover.  The trail is kept in the URL, so it's restored when the page
is reloaded.  Event log documents are identified by their position in the
loaded data, so their panes aren't restored after other data is loaded.

The rules and connectors APIs return one space's rules and connectors, and
don't say which space.  Run the requests for every space together in Dev
Tools Console, and paste all of the output into one of the pages; the space
of each response is read from the line naming its request, like
`# GET kbn:/s/<space id>/api/actions/connectors 200 OK`.  Files named like
`rules-space-<space id>.json` are read as that space's.  The rules API doesn't return the rules' run durations
and success ratios, which the saved objects have; the event log has them too.

The pages link to Kibana Discover, using [discover-url][], for the documents
behind the analysis.  Set the Kibana URL and the event log data view in the
"settings" menu at the top right of each page; they're saved in the browser's
local storage.  See the [discover-url examples][] for creating the
`.kibana-event-log-ds` data view the links use by default.

Each page shows the Kibana Dev Tools requests for its data; paste the output
into the page.  The health report is stored in the browser tab's session
storage, so it's kept while the tab is open.

`scripts/sera-download` makes the same requests, and writes all of the
responses to a sera data file, described below, in the current directory,
named for the hostname of the Kibana URL, and the year, month, day, hour,
and minute, like `localhost-26-11-09-17-38.sera.json`.  It lists the spaces
with `GET kbn:/api/spaces/space`, and gets the rules and connectors of each
of them; if the spaces can't be listed, it gets the default space's.  It
needs Node.js 18 or later, and no npm packages.  Without settings, it uses a local development
Elasticsearch and Kibana, with these environment variables:

| variable      | value                                               | default
| ------------- | --------------------------------------------------- | -----------------------
| `ES_URL`      | the Elasticsearch URL                               | `http://localhost:9200`
| `KB_URL`      | the Kibana URL, including any base path             | `http://localhost:5601`
| `ES_API_KEY`  | an API key, instead of a user and password          |
| `ES_USERNAME` | the user, for both Elasticsearch and Kibana         | `elastic`
| `ES_PASSWORD` | the user's password                                 | `changeme`

Without an API key, a user and password in a URL, like
`http://elastic:changeme@localhost:9200`, are used for that URL.

The API key needs Elasticsearch privileges to read the event log and alerts,
and Kibana privileges to read the rules and connectors; without the Kibana
privileges, the rules and connectors requests get 403 responses.  To create
one in Kibana, open Stack Management, then API keys, and Create API key:

1. name it `sera`, with the type "User API key"
2. turn on "Control security privileges", and replace the privileges with:

   ```json
   {
     "sera": {
       "cluster": [],
       "indices": [
         { "names": [".kibana-event-log-*", ".alerts-*"], "privileges": ["read"], "allow_restricted_indices": false }
       ],
       "applications": [
         { "application": "kibana-.kibana", "privileges": ["read"], "resources": ["*"] }
       ]
     }
   }
   ```

3. optionally, turn on "Expire after time", and set a few days
4. create it, and copy the "Encoded" value; that's `ES_API_KEY`

The key is read-only: it has no cluster privileges, can only read the event
log and alerts indices, and has Kibana's `read` privilege, which reads every
Kibana feature in every space, including the spaces, rules, connectors, and
Task Manager health that `sera-download` gets, but can't change anything.  It
can't have more privileges than the user who creates it.  To keep the key off the command line
and out of the shell history, copy it to the clipboard, and on macOS set it
with `pbpaste`, then clear the clipboard:

    export ES_URL=https://elasticsearch.example.com
    export KB_URL=https://kibana.example.com
    export ES_API_KEY="$(pbpaste)"
    pbcopy < /dev/null
    scripts/sera-download

The script prints the spaces, and how many of each kind of data it
downloaded, or the error of each request that failed, including each space's;
it exits with an error if any of them failed, and doesn't write the file if
all of them did.  The file contains names and other details of
the deployment, so share it with care.

A sera data file is a JSON object with the response for each page, as the
property named by the page's id, and a `meta` property describing the file:
when the data was downloaded, from which Kibana and Elasticsearch URLs, without
any user and password, and the errors of the requests that failed, which are
left out.  The rules and connectors are objects of each space's response, by
space id, and `spaces` is the list of spaces; in version 1 files, the rules
and connectors are the default space's response.

```json
{
  "meta": {
    "format": "sera-data",
    "version": 2,
    "timestamp": "2026-11-05T22:46:00.000Z",
    "kibanaUrl": "https://kibana.example.com",
    "elasticsearchUrl": "https://elasticsearch.example.com",
    "errors": { "connectors in space security": "403 Unauthorized to get actions" }
  },
  "spaces": [{ "...": "the response of GET kbn:/api/spaces/space" }],
  "task-manager-health": { "...": "the response of GET kbn:/api/task_manager/_health" },
  "rules": {
    "default": { "...": "the response of GET kbn:/api/alerting/rules/_find?per_page=10000" },
    "security": { "...": "the response of GET kbn:/s/security/api/alerting/rules/_find?per_page=10000" }
  },
  "connectors": {
    "default": [{ "...": "the response of GET kbn:/api/actions/connectors" }]
  },
  "event-log": { "...": "the response of the event log search" },
  "alerts": { "...": "the response of the alerts search" }
}
```

Load it with "load a sera data file" on the home page, or drop it on the
home page, or on any of the rules, connectors, alerts, or event log pages.
It's loaded into a new session, which becomes the current one.  The Task
Manager health report is analyzed when its page is opened in the same tab,
and again when its session is picked.  Its Kibana URL replaces the Kibana URL setting,
so the links to Discover go to the Kibana it was downloaded from; the
setting is for the data loaded from other files.
On the Task Manager health page, a data file loads just its health report.

The Task Manager health report is only complete from Kibana instances with
the `background_tasks` node role.  On Elastic Cloud Hosted with Kibana larger
than 8GB, and always on serverless, the health API request goes to a UI
instance, so get the report from the "Latest Monitored Stats" messages in the
Kibana logs instead; the Task Manager health page reads those too, as log
lines or as log documents copied from Discover.  In Discover of the Kibana
logs, the KQL filter `tags : "task-manager-background-node-health"` finds
them.

[Task Manager health]: https://pmuellr.github.io/sera/task-manager-health/index.html
[event log]: https://pmuellr.github.io/sera/event-log/index.html
[rules]: https://pmuellr.github.io/sera/rules/index.html
[connectors]: https://pmuellr.github.io/sera/connectors/index.html
[alerts]: https://pmuellr.github.io/sera/alerts/index.html
[TrailBlazer]: https://pmuellr.github.io/sera/trailblazer/index.html
[TrailBlazer video]: https://pmuellr.github.io/sera/demo/trailblazer.mp4
[discover-url]: https://github.com/pmuellr/discover-url
[discover-url examples]: https://github.com/pmuellr/discover-url/blob/main/EXAMPLES.md


layout
================================================================================

Everything served by GitHub Pages is in the `docs` directory:

    docs/
      index.html              home page, listing the pages
      site/
        home.js               the home page: loading a sera data file, the list of pages, and notes on getting their data
        pages.js              the list of pages, used to build the menu
        site.js               the menu, settings, data input, tables, formatting
        site.css              shared styles
        favicon.svg           the icon for every page
        kibana-data.js        rules, connectors, alerts, and event log documents, shared by their pages
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
      trailblazer/            trailblazer.js, trailblazer.css

The pages use plain `<script src>` scripts rather than ES modules, so they
also work when opened from `file:` URLs.  `site.js` adds a `Site` global,
`kibana-data.js` adds a `KibanaData` global, and `discover-url.js` adds a
`discoverUrl` global.  Whether pages opened from `file:` URLs share their
IndexedDB data depends on the browser.

`test/fixtures` contains synthetic sample data for each page.  Load all three
of the `*-search.json` files, together, into one of the rules, connectors,
or alerts pages to see the links between them.  The
`*-space-*.json` files are the same rules and connectors, from the APIs.

The rules, connectors, alerts, and event log pages use `KibanaData.panel(kind,
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
  it's cleared; wrap it in `Site.dataPanel(...)` for the collapsible "data"
  panel, and call its `update(summary, loaded)` when the data changes
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
