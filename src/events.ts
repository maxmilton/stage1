// eslint-disable-next-line symbol-description
export const ONCLICK = Symbol();

// eslint-disable-next-line consistent-return
export const handleClick = (event: Event): false | undefined => {
  let node = event.target as
    | (Node & { [ONCLICK]?(event: Event): false | undefined })
    | null;

  while (node) {
    if (node[ONCLICK]) {
      return node[ONCLICK](event);
    }
    node = node.parentNode;
  }
};

// TODO: Add documentation: If you want to save bytes and you are sure no code
// will override it, use `document.onclick = handleClick` instead.
export const setupSyntheticClick = (): void => {
  document.addEventListener('click', handleClick);
};

export const removeSyntheticClick = (): void => {
  document.removeEventListener('click', handleClick);
};
