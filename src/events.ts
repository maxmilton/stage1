const CONFIGURED_SYNTHETIC_EVENTS: { [key: string]: boolean } = {};

const nativeToSyntheticEvent = (
  event: Event & { target: Element | null },
  name: string,
) => {
  const eventKey = `__${name}`;
  let dom = event.target;

  while (dom !== null) {
    const eventHandler = dom[eventKey];

    if (eventHandler) {
      eventHandler(event);
      return;
    }
    dom = dom.parentNode;
  }
};

export function setupSyntheticEvent(name: string): void {
  if (CONFIGURED_SYNTHETIC_EVENTS[name]) return;

  document.addEventListener(name, (event) => nativeToSyntheticEvent(event, name));
  CONFIGURED_SYNTHETIC_EVENTS[name] = true;
}
