// eslint-disable-next-line symbol-description
export const ONCLICK = Symbol();

// eslint-disable-next-line consistent-return
export const handleClick = (event: Event): false | undefined => {
  let node = event.target as (Node & { [ONCLICK]?(event: Event): false | undefined }) | null;

  while (node) {
    if (node[ONCLICK]) {
      return node[ONCLICK](event);
    }
    node = node.parentNode;
  }
};

/**
 * NOTE: To save bytes when certain no other code will override it, instead use:
 * ```js
 * import { handleClick } from "stage1"
 * document.onclick = handleClick;
 * ```
 */
export const setupSyntheticClick = (): void => {
  document.addEventListener("click", handleClick);
};

export const removeSyntheticClick = (): void => {
  document.removeEventListener("click", handleClick);
};
