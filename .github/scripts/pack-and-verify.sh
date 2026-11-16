#!/bin/bash
set -euo pipefail

fail() {
  local status=$?
  printf '::error::%s\n' "$1"
  exit "$status"
}

PACK_JSON="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pack.json"

echo "::group::npm pack output (pack.json)"
# TODO: Use bun pm pack when it supports --json; https://github.com/oven-sh/bun/issues/38191
npm pack --ignore-scripts --json | tee "$PACK_JSON" \
  || fail "Package creation failed"
echo "::endgroup::"

jq -e '.[keys[0]].name == "stage1"' "$PACK_JSON" \
  || fail "Unexpected package name"
jq -e '
  .[keys[0]].files | map(.path) |
  index("LICENSE") != null and
  index("README.md") != null and
  index("package.json") != null and
  index("dist/browser.d.ts") != null and
  index("dist/browser.d.ts.map") != null and
  index("dist/browser.js") != null and
  index("dist/browser.js.map") != null and
  index("dist/browser.mjs") != null and
  index("dist/browser.mjs.map") != null and
  index("dist/macro.d.ts") != null and
  index("dist/macro.d.ts.map") != null and
  index("dist/macro.js") != null and
  index("dist/macro.js.map") != null and
  index("dist/legacy/index.d.ts") != null and
  index("dist/legacy/index.d.ts.map") != null and
  index("dist/legacy/index.js") != null and
  index("dist/legacy/index.js.map") != null and
  index("dist/legacy/reconcile/keyed.d.ts") != null and
  index("dist/legacy/reconcile/keyed.d.ts.map") != null and
  index("dist/legacy/reconcile/keyed.js") != null and
  index("dist/legacy/reconcile/keyed.js.map") != null and
  index("dist/legacy/reconcile/non-keyed.d.ts") != null and
  index("dist/legacy/reconcile/non-keyed.d.ts.map") != null and
  index("dist/legacy/reconcile/non-keyed.js") != null and
  index("dist/legacy/reconcile/non-keyed.js.map") != null and
  index("dist/legacy/reconcile/reuse-nodes.d.ts") != null and
  index("dist/legacy/reconcile/reuse-nodes.d.ts.map") != null and
  index("dist/legacy/reconcile/reuse-nodes.js") != null and
  index("dist/legacy/reconcile/reuse-nodes.js.map") != null and
  index("dist/legacy/reconcile/reuse-lite.d.ts") != null and
  index("dist/legacy/reconcile/reuse-lite.d.ts.map") != null and
  index("dist/legacy/reconcile/reuse-lite.js") != null and
  index("dist/legacy/reconcile/reuse-lite.js.map") != null and
  index("dist/types.d.ts") != null and
  index("dist/types.d.ts.map") != null and
  index("src/index.ts") != null and
  index("src/runtime.ts") != null and
  index("src/signal.ts") != null and
  index("src/reconcile.ts") != null and
  index("src/events.ts") != null and
  index("src/utils.ts") != null and
  index("src/types.ts") != null and
  index("src/macro.ts") != null and
  index("src/lite/index.ts") != null and
  index("src/lite/signal.ts") != null and
  index("src/browser/index.ts") != null and
  index("src/browser/runtime.ts") != null and
  index("src/legacy/index.ts") != null and
  index("src/legacy/runtime.ts") != null and
  index("src/legacy/events.ts") != null and
  index("src/legacy/store.ts") != null and
  index("src/legacy/types.ts") != null and
  index("src/legacy/utils.ts") != null and
  index("src/legacy/reconcile/keyed.ts") != null and
  index("src/legacy/reconcile/non-keyed.ts") != null and
  index("src/legacy/reconcile/reuse-nodes.ts") != null and
  index("src/legacy/reconcile/reuse-lite.ts") != null
' "$PACK_JSON" \
  || fail "Required package files missing"
jq -e '.[keys[0]].entryCount == 57' "$PACK_JSON" \
  || fail "Expected 57 packed files"
filename="$(jq -er '.[keys[0]].filename' "$PACK_JSON")" \
  || fail "Package filename missing"
mv -- "$filename" publish.tgz \
  || fail "Could not rename package"
