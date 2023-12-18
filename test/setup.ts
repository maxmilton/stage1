import { GlobalWindow, type Window } from 'happy-dom';

declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var happyDOM: Window['happyDOM'];
}

function setupDOM() {
  const dom = new GlobalWindow({
    url: 'chrome-extension://cpcibnbdmpmcmnkhoiilpnlaepkepknb/',
  });
  global.happyDOM = dom.happyDOM;
  // @ts-expect-error - happy-dom only implements a subset of the DOM API
  global.window = dom.window.document.defaultView;
  global.document = window.document;
  global.console = window.console;
  global.setTimeout = window.setTimeout;
  global.clearTimeout = window.clearTimeout;
  global.DocumentFragment = window.DocumentFragment;
  global.CSSStyleSheet = window.CSSStyleSheet;
  global.Text = window.Text;
  global.fetch = window.fetch;
  global.MutationObserver = window.MutationObserver;
}

function setupMocks(): void {
  // TODO:!
}

export function reset(): void {
  setupDOM();
  setupMocks();
}

reset();
