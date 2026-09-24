export const ONCLICK = Symbol();

// oxlint-disable-next-line typescript/consistent-return
export const handleClick = (event: Event): false | undefined => {
  let node = event.target as (Node & { [ONCLICK]?: (event: Event) => false | undefined }) | null;

  while (node) {
    if (node[ONCLICK]) {
      return node[ONCLICK](event);
    }
    node = node.parentNode;
  }
};

/**
 * NOTE: To save bytes when certain no other code will override it, instead use:
 *
 * ```ts
 * import { handleClick } from "stage1";
 * document.onclick = handleClick;
 * ```
 */
export const setupSyntheticClick = (): void => {
  // oxlint-disable-next-line typescript/strict-void-return
  document.addEventListener("click", handleClick);
};

export const removeSyntheticClick = (): void => {
  // oxlint-disable-next-line typescript/strict-void-return
  document.removeEventListener("click", handleClick);
};
