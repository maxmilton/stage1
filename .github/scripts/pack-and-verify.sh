#!/usr/bin/env bash
set -euo pipefail

# TODO: Use bun pm pack when it supports --json; https://github.com/oven-sh/bun/issues/38191
PACK_JSON="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pack.json"
npm pack --ignore-scripts --json > "$PACK_JSON"
jq -e '.[keys[0]].name == "stage1"' "$PACK_JSON"
jq -e '
  .[keys[0]].files | map(.path) |
  index("LICENSE") != null and
  index("README.md") != null and
  index("dist/browser.js") != null and
  index("dist/browser.js.map") != null and
  index("dist/browser.mjs") != null and
  index("dist/browser.mjs.map") != null and
  index("dist/index.d.ts") != null and
  index("dist/index.d.ts.map") != null and
  index("dist/index.js") != null and
  index("dist/index.js.map") != null and
  index("dist/macro.js") != null and
  index("dist/macro.js.map") != null and
  index("dist/reconcile/keyed.js") != null and
  index("dist/reconcile/keyed.js.map") != null and
  index("dist/reconcile/non-keyed.js") != null and
  index("dist/reconcile/non-keyed.js.map") != null and
  index("dist/reconcile/reuse-nodes.js") != null and
  index("dist/reconcile/reuse-nodes.js.map") != null and
  index("package.json") != null and
  index("src/browser/index.ts") != null and
  index("src/browser/runtime.ts") != null and
  index("src/events.ts") != null and
  index("src/fast/index.ts") != null and
  index("src/fast/runtime.ts") != null and
  index("src/reconcile/keyed.ts") != null and
  index("src/reconcile/non-keyed.ts") != null and
  index("src/reconcile/reuse-nodes.ts") != null and
  index("src/index.ts") != null and
  index("src/macro.ts") != null and
  index("src/runtime.ts") != null and
  index("src/store.ts") != null and
  index("src/types.ts") != null and
  index("src/utils.ts") != null
' "$PACK_JSON"
jq -e '.[keys[0]].entryCount == 33' "$PACK_JSON"
mv -- "$(jq -er '.[keys[0]].filename' "$PACK_JSON")" publish.tgz
