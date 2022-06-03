const configuredEvents: Record<string, boolean | null> = {};

const nativeToSyntheticEvent = (event: Event) => {
  // eslint-disable-next-line prefer-template
  const eventKey = '__' + event.type;
  let node = event.target as Node | null;

  while (node) {
    // @ts-expect-error - unavoidable string indexing
    if (node[eventKey]) {
      // @ts-expect-error - unavoidable string indexing
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      node[eventKey](event);
      return;
    }
    node = node.parentNode;
  }
};

export const setupSyntheticEvent = (type: keyof DocumentEventMap): void => {
  if (configuredEvents[type]) return;

  document.addEventListener(type, nativeToSyntheticEvent);
  configuredEvents[type] = true;
};

export const deleteSyntheticEvent = (type: keyof DocumentEventMap): void => {
  document.removeEventListener(type, nativeToSyntheticEvent);
  configuredEvents[type] = null;
};
