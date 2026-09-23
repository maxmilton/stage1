import type * as Stage1 from "../../src/browser/index.ts";

declare global {
  interface Window {
    stage1: typeof Stage1;
  }

  /**
   * A node carrying a synthetic click handler (src/events.ts). Keying on
   * `[ONCLICK]` fails — the bodies destructure it off `window.stage1`, widening
   * `unique symbol` to `symbol` (TS7053) — and the real `false | undefined`
   * return would make every handler end in `return undefined`.
   */
  type ClickTarget = Element & Record<symbol, (event: Event) => void>;
}
