import type * as Stage1 from "../../src/browser/index.ts";

declare global {
  interface Window {
    readonly stage1: typeof Stage1;
  }

  /**
   * Keyed by `symbol`, since a destructured ONCLICK widens (TS7053); `void`
   * spares handlers `return undefined`.
   */
  type ClickTarget = Element & Record<symbol, (event: Event) => void>;
}
