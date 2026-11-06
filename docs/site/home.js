// @ts-check

// The home page: the list of pages, and notes on getting their data.

'use strict';

(function () {

const { h, section } = Site;

const REPO_URL = 'https://github.com/pmuellr/sera';

const API_KEY_PRIVILEGES = `{
  "sera": {
    "indices": [
      { "names": [".kibana-event-log-*", ".alerts-*"], "privileges": ["read"] }
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
      h('code', {}, 'scripts/download-data.sh'), ' makes the same requests with curl, for the default space, ',
      'and saves the responses in ', h('code', {}, 'tmp/'), ', with a prefix of the month, day, hour, and minute; ',
      'then load the files on the pages.  It needs the Elasticsearch and Kibana URLs, and an API key with the ',
      'privileges above.  To create the key in Kibana, open Stack Management, then API keys, and Create API key:'),
    h('ol', {},
      h('li', {}, 'name it ', h('code', {}, 'sera'), ', with the type "User API key"'),
      h('li', {}, 'turn on "Control security privileges", and replace the privileges with this ', copyButton(API_KEY_PRIVILEGES),
        h('pre', { class: 'commands' }, API_KEY_PRIVILEGES)),
      h('li', {}, 'optionally, turn on "Expire after time", and set a few days'),
      h('li', {}, 'create it, and copy the "Encoded" value'),
    ),
    h('p', {},
      'The key can read every Kibana feature in every space; it can\'t have more privileges than the user who ',
      'creates it.  To keep the key out of the shell history, with it in the clipboard, on macOS run:'),
    h('pre', { class: 'commands' }, [
      'export ES_URL=https://elasticsearch.example.com',
      'export KB_URL=https://kibana.example.com',
      'export ES_API_KEY="$(pbpaste)"',
      'pbcopy < /dev/null',
      'scripts/download-data.sh',
    ].join('\n')),
    h('p', {},
      'The APIs leave out rule API keys and connector secrets.  The output still contains names, user names, ',
      'and other details of the deployment, so share it with care.'),
  );
}

/** @type {HTMLElement} */ (document.getElementById('home')).append(
  renderPages(),
  renderGettingData(),
);

})();
