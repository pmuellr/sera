#!/usr/bin/env bash

# Download the data the sera pages analyze, into tmp/, with the same requests
# the pages show for Dev Tools.  The rules and connectors are the default
# space's.  The files share a prefix of the month, day, hour, and minute,
# like tmp/1105-2246-rules-space-default.json.
#
#   ES_URL      Elasticsearch URL, like https://elasticsearch.example.com
#   KB_URL      Kibana URL, including any base path
#   ES_API_KEY  an API key, sent as "Authorization: ApiKey ..." to both
#
# The API key is passed to curl on a file descriptor, not the command line,
# so it isn't visible to other processes.

set -euo pipefail

for name in ES_URL KB_URL ES_API_KEY; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is not set; see the comments in $0" >&2
    exit 1
  fi
done

ES_URL="${ES_URL%/}"
KB_URL="${KB_URL%/}"

DIR="$(cd "$(dirname "$0")/.." && pwd)/tmp"
PREFIX="$DIR/$(date +%m%d-%H%M)"
mkdir -p "$DIR"

failures=0

# download <file> <url>
download() {
  local file="$PREFIX-$1" url="$2" status
  status=$(curl --silent --show-error --location --compressed \
    --header @<(printf 'Authorization: ApiKey %s\n' "$ES_API_KEY") \
    --header 'Accept: application/json' \
    --output "$file" --write-out '%{http_code}' \
    "$url") || status="curl failed"
  if [[ "$status" == 2* ]]; then
    echo "$status ${file#"$DIR/"}"
  else
    echo "$status ${file#"$DIR/"}: $url" >&2
    failures=$((failures + 1))
  fi
}

download task-manager-health.json "$KB_URL/api/task_manager/_health"
download rules-space-default.json "$KB_URL/api/alerting/rules/_find?per_page=10000"
download connectors-space-default.json "$KB_URL/api/actions/connectors"
download event-log.json "$ES_URL/.kibana-event-log-*/_search?size=2000&sort=@timestamp:desc"
download alerts.json "$ES_URL/.alerts-*/_search?size=2000&sort=@timestamp:desc"

if ((failures > 0)); then
  echo "$failures requests failed; their files have the error responses" >&2
  exit 1
fi
