// @ts-check

// The analysis pages, in menu order.  Each page lives in docs/<id>/index.html.
// To add a page, copy an existing page's directory, and add an entry here.

'use strict';

/** @type {{ id: string; title: string; description: string }[]} */
const SITE_PAGES = [
  {
    id: 'task-manager-health',
    title: 'Task Manager health',
    description: 'Analyze the output of the Kibana Task Manager health API, GET /api/task_manager/_health.',
  },
  {
    id: 'event-log',
    title: 'Event Log',
    description: 'Analyze Kibana event log documents from .kibana-event-log-*: task runs, rule and connector executions, and errors.',
  },
  {
    id: 'rules',
    title: 'Rules',
    description: 'Analyze alerting rules: schedules, run outcomes, and their connectors and alerts.',
  },
  {
    id: 'connectors',
    title: 'Connectors',
    description: 'Analyze connectors, and the rules that use them.',
  },
  {
    id: 'alerts',
    title: 'Alerts',
    description: 'Analyze alert documents from the .alerts-* indices, by rule and status.',
  },
  {
    id: 'trailblazer',
    title: 'TrailBlazer',
    description: 'Browse the loaded data by following the links between rules, connectors, alerts, and event log documents.',
  },
];
