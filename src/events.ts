const CONFIGURED_EVENTS: { [key: string]: boolean } = {};

const nativeToSyntheticEvent = (event: Event, name: string) => {
  // eslint-disable-next-line prefer-template
  const eventKey = '__' + name;
  let dom = event.target as Node | null;

  while (dom !== null) {
    // @ts-expect-error - string indexing dom is unavoidable
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const eventHandler = dom[eventKey];

    if (eventHandler) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      eventHandler(event);
      return;
    }
    dom = dom.parentNode;
  }
};

export function setupSyntheticEvent(name: string): void {
  if (CONFIGURED_EVENTS[name]) return;

  document.addEventListener(name, (event) => nativeToSyntheticEvent(event, name));

  CONFIGURED_EVENTS[name] = true;
}
