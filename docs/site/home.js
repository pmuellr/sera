// @ts-check

// The home page: the list of pages, and notes on getting their data.

'use strict';

(function () {

const { h, section } = Site;

const REPO_URL = 'https://github.com/pmuellr/sera';

const API_KEY_PRIVILEGES = `{
  "sera": {
    "cluster": [],
    "indices": [
      { "names": [".kibana-event-log-*", ".alerts-*"], "privileges": ["read"], "allow_restricted_indices": false }
    ],
    "applications": [
      { "application": "kibana-.kibana", "privileges": ["read"], "resources": ["*"] }
    ]
  }
}`;

/** @type {(text: string) => HTMLElement} */
function copyButton(text) {
  const button = h('button', {
    onclick: function () {
      navigator.clipboard.writeText(text).then(function () { button.textContent = 'copied'; });
    },
  }, 'copy');
  return button;
}

function renderDataFileLoader() {
  const picker = KibanaData.sessionPicker();
  return [
    picker.notice,
    KibanaData.dataFileLoader({
      hint: ['or drop it on this page; it has the data for every page, from ', h('code', {}, 'sera-download'), ', described below'],
      onLoaded: picker.refresh,
    }),
    picker.element,
  ];
}

function renderPages() {
  return h('ul', { class: 'page-list' }, SITE_PAGES.map(function (page) {
    return h('li', {},
      h('a', { href: Site.pageUrl(page.id) }, page.title),
      h('div', { class: 'muted' }, page.description),
    );
  }));
}

function renderGettingData() {
  return section('getting the data',
    h('p', {},
      'Each page shows the Kibana Dev Tools requests for its data.  Run them in Dev Tools Console, ',
      'and paste the output into the page.  The rules, connectors, alerts, and event log pages share their data, ',
      'so each can use what was loaded on the others.'),
    h('p', {},
      'The user running the requests needs Kibana privileges to read the rules and connectors in every space, ',
      'which include the features of the rules\' types, like Observability or Security; the rules API leaves out ',
      'the rules it isn\'t allowed to read.  They also need Elasticsearch privileges to read the ',
      h('code', {}, '.kibana-event-log-*'), ' and ', h('code', {}, '.alerts-*'), ' indices.'),
    h('p', {},
      'Or, from a clone of the ', h('a', { href: REPO_URL }, 'sera repository'), ', ',
      h('code', {}, 'scripts/sera-download'), ' makes the same requests, for the rules and connectors of every space the user can read, and writes all of ',
      'the responses to a sera data file in the current directory, named for Kibana\'s hostname and the time, like ',
      h('code', {}, 'localhost-26-11-09-17-38.sera.json'), '; load it above, or on any of the pages, to load the data of ',
      'every page.  It needs Node.js 18 or later, and no npm packages.'),
    h('p', {},
      'Without settings, it uses a local development Elasticsearch and Kibana, at ',
      h('code', {}, 'http://localhost:9200'), ' and ', h('code', {}, 'http://localhost:5601'), ', as the user ',
      h('code', {}, 'elastic'), ' with the password ', h('code', {}, 'changeme'), '.  Set ',
      h('code', {}, 'ES_URL'), ' and ', h('code', {}, 'KB_URL'), ' for others, and ',
      h('code', {}, 'ES_API_KEY'), ', or ', h('code', {}, 'ES_USERNAME'), ' and ', h('code', {}, 'ES_PASSWORD'),
      ', or put the user and password in the URLs, like ', h('code', {}, 'http://elastic:changeme@localhost:9200'), '.'),
    h('p', {},
      'An API key needs the privileges above.  ',
      'To create one in Kibana, open Stack Management, then API keys, and Create API key:'),
    h('ol', {},
      h('li', {}, 'name it ', h('code', {}, 'sera'), ', with the type "User API key"'),
      h('li', {}, 'turn on "Control security privileges", and replace the privileges with this ', copyButton(API_KEY_PRIVILEGES),
        h('pre', { class: 'commands' }, API_KEY_PRIVILEGES)),
      h('li', {}, 'optionally, turn on "Expire after time", and set a few days'),
      h('li', {}, 'create it, and copy the "Encoded" value'),
    ),
    h('p', {},
      'The key is read-only: it has no cluster privileges, can only read the event log and alerts indices, and has ',
      'Kibana\'s read privilege, which reads every Kibana feature in every space but can\'t change anything.  ',
      'It can\'t have more privileges than the user who ',
      'creates it.  To keep the key out of the shell history, with it in the clipboard, on macOS run:'),
    h('pre', { class: 'commands' }, [
      'export ES_URL=https://elasticsearch.example.com',
      'export KB_URL=https://kibana.example.com',
      'export ES_API_KEY="$(pbpaste)"',
      'pbcopy < /dev/null',
      'scripts/sera-download',
    ].join('\n')),
    h('p', {},
      'The APIs leave out rule API keys and connector secrets.  The output still contains names, user names, ',
      'and other details of the deployment, so share it with care.'),
  );
}

/** @type {HTMLElement} */ (document.getElementById('home')).append(
  ...renderDataFileLoader(),
  renderPages(),
  renderGettingData(),
);

})();
