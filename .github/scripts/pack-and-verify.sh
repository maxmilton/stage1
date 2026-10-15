#!/usr/bin/env bash
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
' "$PACK_JSON" \
  || fail "Required package files missing"
jq -e '.[keys[0]].entryCount == 33' "$PACK_JSON" \
  || fail "Expected 33 packed files"
filename="$(jq -er '.[keys[0]].filename' "$PACK_JSON")" \
  || fail "Package filename missing"
mv -- "$filename" publish.tgz \
  || fail "Could not rename package"
