// @ts-check

// The home page: the list of pages, and notes on getting their data.

'use strict';

(function () {

const { h, section } = Site;

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
      'and paste the output into the page.  The rules, connectors, and alerts pages share their data, ',
      'so each can use what was loaded on the others.'),
    h('p', {},
      'The user running the requests needs Kibana privileges to read the rules and connectors in every space, ',
      'which include the features of the rules\' types, like Observability or Security; the rules API leaves out ',
      'the rules it isn\'t allowed to read.  They also need Elasticsearch privileges to read the ',
      h('code', {}, '.kibana-event-log-*'), ' and ', h('code', {}, '.alerts-*'), ' indices.'),
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
