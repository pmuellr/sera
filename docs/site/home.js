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

/**
 * The prompt to load a sera data file, which loads the data of every page.
 * Files dropped on the page are loaded too.
 */
function renderDataFileLoader() {
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    onchange: function () {
      const file = fileInput.files?.[0];
      if (file) loadFile(file);
      fileInput.value = '';
    },
  });
  const status = h('div', { class: 'input-status' });

  document.addEventListener('dragover', function (event) {
    event.preventDefault();
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', function (event) {
    if (event.relatedTarget == null) document.body.classList.remove('dragging');
  });
  document.addEventListener('drop', function (event) {
    event.preventDefault();
    document.body.classList.remove('dragging');
    const file = event.dataTransfer?.files[0];
    if (file) loadFile(file);
  });

  return h('div', { class: 'data-file-loader' },
    h('div', { class: 'data-file-loader-prompt' },
      h('button', { onclick: function () { fileInput.click(); } }, 'load a sera data file'),
      h('span', { class: 'muted' },
        'or drop it on this page; it has the data for every page, from ',
        h('code', {}, 'sera-download'), ', described below'),
    ),
    fileInput,
    status,
  );

  /** @type {(file: File) => Promise<void>} */
  async function loadFile(file) {
    showStatus(`reading ${file.name}`, false);
    try {
      const dataFile = Site.parseDataFile(await file.text());
      if (!dataFile) {
        throw new Error(`${file.name} isn't a sera data file; load other files on the pages for their data`);
      }
      const loaded = await KibanaData.loadDataFile(dataFile, file.name);
      const source = KibanaData.dataFileSource(dataFile);
      showStatus('', false);
      status.append(
        h('div', {}, [`loaded ${file.name}`, source].filter(Boolean).join(', ')),
        loaded.length === 0 ? h('div', {}, 'it had no data') : h('ul', {}, loaded.map(function (item) {
          const page = SITE_PAGES.find(function (p) { return p.id === item.page; });
          return h('li', {}, h('a', { href: Site.pageUrl(item.page) }, page?.title ?? item.page), ': ', item.text);
        })),
        ...KibanaData.dataFileErrors(dataFile).map(function (error) {
          return h('div', { class: 'error' }, error);
        }),
      );
    } catch (err) {
      console.error(err);
      showStatus(`error loading ${file.name}: ${Site.errorMessage(err)}`, true);
    }
  }

  /** @type {(message: string, isError: boolean) => void} */
  function showStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }
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
      h('code', {}, 'scripts/sera-download'), ' makes the same requests, for the default space, and writes all of ',
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
      'The key can read every Kibana feature in every space; it can\'t have more privileges than the user who ',
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
  renderDataFileLoader(),
  renderPages(),
  renderGettingData(),
);

})();
