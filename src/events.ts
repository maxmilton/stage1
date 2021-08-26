const CONFIGURED_EVENTS: { [key: string]: boolean } = {};

const nativeToSyntheticEvent = (event: Event) => {
  // eslint-disable-next-line prefer-template
  const eventKey = '__' + event.type;
  let node = event.target as Node | null;

  while (node !== null) {
    // @ts-expect-error - string indexing dom is unavoidable
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const eventHandler = node[eventKey];

    if (eventHandler) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      eventHandler(event);
      return;
    }
    node = node.parentNode;
  }
};

export const setupSyntheticEvent = (type: keyof DocumentEventMap): void => {
  if (CONFIGURED_EVENTS[type]) return;

  document.addEventListener(type, nativeToSyntheticEvent);

  CONFIGURED_EVENTS[type] = true;
};
