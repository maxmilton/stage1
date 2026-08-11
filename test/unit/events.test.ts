import { afterEach, describe, expect, expectTypeOf, mock, onTestFinished, test } from "bun:test";
import { cleanup, render } from "@maxmilton/test-utils/dom";
import {
  handleClick,
  ONCLICK,
  removeSyntheticClick,
  setupSyntheticClick,
} from "../../src/events.ts";

declare global {
  interface HTMLElement {
    /** `stage1` synthetic click event handler. */
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    [ONCLICK]?(event: Event): false | void | Promise<void>;
  }
}

describe("handleClick", () => {
  test("types", () => {
    expectTypeOf(handleClick).not.toBeAny();
    expectTypeOf(handleClick).toBeFunction();
    expectTypeOf(handleClick).parameters.toEqualTypeOf<[Event]>();
    expectTypeOf(handleClick).returns.not.toBeAny();
    expectTypeOf(handleClick).returns.toEqualTypeOf<false | undefined>();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(handleClick).toBeFunction();
    expect(handleClick).not.toBeClass();
  });

  test("expects 1 parameter", () => {
    expect.assertions(1);
    expect(handleClick).toHaveParameters(1, 0);
  });

  test("returns undefined", () => {
    expect.assertions(1);
    expect(handleClick({} as Event)).toBeUndefined();
  });

  describe("in DOM", () => {
    afterEach(cleanup);

    test("returns undefined when event handler is noop", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      button[ONCLICK] = () => {};
      render(button);
      expect(handleClick({ target: button } as unknown as Event)).toBeUndefined();
    });

    test("returns false when event handler returns false", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      button[ONCLICK] = () => false;
      render(button);
      expect(handleClick({ target: button } as unknown as Event)).toBe(false);
    });

    test("calls synthetic event handler", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      handleClick({ target: button } as unknown as Event);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test("passes event to nearest synthetic event handler", () => {
      expect.assertions(3);
      const outer = document.createElement("div");
      const button = document.createElement("button");
      const event = { target: button } as unknown as Event;
      const outerHandler = mock(() => {});
      const buttonHandler = mock(() => {});
      outer[ONCLICK] = outerHandler;
      button[ONCLICK] = buttonHandler;
      outer.appendChild(button);
      render(outer);
      handleClick(event);
      expect(buttonHandler).toHaveBeenCalledWith(event);
      expect(buttonHandler).toHaveBeenCalledTimes(1);
      expect(outerHandler).not.toHaveBeenCalled();
    });

    test("does not call native event handler", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const handler = mock(() => {});
      button.onclick = handler;
      render(button);
      handleClick({ target: button } as unknown as Event);
      expect(handler).toHaveBeenCalledTimes(0);
    });
  });
});

describe("setupSyntheticClick", () => {
  test("types", () => {
    expectTypeOf(setupSyntheticClick).not.toBeAny();
    expectTypeOf(setupSyntheticClick).toBeFunction();
    expectTypeOf(setupSyntheticClick).parameters.toEqualTypeOf<[]>();
    expectTypeOf(setupSyntheticClick).returns.not.toBeAny();
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    expectTypeOf(setupSyntheticClick).returns.toEqualTypeOf<void>();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(setupSyntheticClick).toBeFunction();
    expect(setupSyntheticClick).not.toBeClass();
  });

  test("expects 0 parameters", () => {
    expect.assertions(1);
    expect(setupSyntheticClick).toHaveParameters(0, 0);
  });

  // NOTE: An API-shape test still runs the function, so it inherits the side
  // effect — this one leaves a live `click` listener on `document`. That is
  // process-wide state, and it used to outlive the test: under `--randomize`,
  // whenever "does not call handler if synthetic event is not setup" was
  // scheduled as the first test of the block below, the stale listener made its
  // click reach handleClick and the test failed for a reason that had nothing
  // to do with it. Reproduced on seeds 1, 777 and 3305907093 (~3 runs in 20;
  // 2026-08-12, bun 1.4.0-canary.1). onTestFinished runs even when the test
  // fails (verified), which cleanup at the end of the body does not.
  test("returns undefined", () => {
    expect.assertions(1);
    onTestFinished(removeSyntheticClick);
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(setupSyntheticClick()).toBeUndefined();
  });

  describe("in DOM", () => {
    afterEach(cleanup);

    test("calls synthetic click event handler on native click", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      button.click();
      button.click();
      button.click();
      expect(handler).toHaveBeenCalledTimes(3);
    });

    test("calls synthetic click event handler on synthetic click event", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      const event = new window.MouseEvent("click", {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(event);
      button.dispatchEvent(event);
      button.dispatchEvent(event);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    test("does not call synthetic event click handler on non-click event", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      button.dispatchEvent(new window.Event("mouseover"));
      expect(handler).not.toHaveBeenCalled();
    });

    test("propagates click event from deeply nested element", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const div = document.createElement("div");
      const span = document.createElement("span");
      const img = document.createElement("img");
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      button.appendChild(div);
      div.appendChild(span);
      span.appendChild(img);
      render(button);
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      img.click();
      img.click();
      img.click();
      expect(handler).toHaveBeenCalledTimes(3);
    });

    // NOTE: The one test which writes to `document.body` — the other piece of
    // process-wide state in this file, so it undoes that here too.
    test("propagates up to document body", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const handler = mock(() => {});
      document.body[ONCLICK] = handler;
      onTestFinished(() => {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete document.body[ONCLICK];
      });
      render(button);
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      button.click();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test("no longer propagates click event once handled", () => {
      expect.assertions(1);
      const div1 = document.createElement("div");
      const div2 = document.createElement("div");
      const handler = mock(() => {});
      div1[ONCLICK] = handler;
      div2[ONCLICK] = handler;
      div1.appendChild(div2);
      render(div1);
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      div2.click();
      expect(handler).toHaveBeenCalledTimes(1); // only called once
    });

    test("does not call handler if synthetic event is not setup", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      button.click();
      expect(handler).not.toHaveBeenCalled();
    });

    test("does not call handler if event originates from another DOM tree branch", () => {
      expect.assertions(2);
      const div = document.createElement("div");
      const button1 = document.createElement("button");
      const button2 = document.createElement("button");
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});
      button1[ONCLICK] = handler1;
      button2[ONCLICK] = handler2;
      render(div);
      div.appendChild(button1);
      div.appendChild(button2);
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      button1.click();
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });

    test("only registers synthetic click handler once", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      button.click();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

describe("removeSyntheticClick", () => {
  test("types", () => {
    expectTypeOf(removeSyntheticClick).not.toBeAny();
    expectTypeOf(removeSyntheticClick).toBeFunction();
    expectTypeOf(removeSyntheticClick).parameters.toEqualTypeOf<[]>();
    expectTypeOf(removeSyntheticClick).returns.not.toBeAny();
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    expectTypeOf(removeSyntheticClick).returns.toEqualTypeOf<void>();
  });

  test("is a function", () => {
    expect.assertions(2);
    expect(removeSyntheticClick).toBeFunction();
    expect(removeSyntheticClick).not.toBeClass();
  });

  test("expects 0 parameters", () => {
    expect.assertions(1);
    expect(removeSyntheticClick).toHaveParameters(0, 0);
  });

  test("returns undefined", () => {
    expect.assertions(1);
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(removeSyntheticClick()).toBeUndefined();
  });

  describe("in DOM", () => {
    afterEach(cleanup);

    // NOTE: Both tests here call removeSyntheticClick() as the behaviour under
    // test, but an assertion failing before that point would leak the listener,
    // so they register it as cleanup too — it is idempotent.
    test("does not call synthetic click handler after delete", () => {
      expect.assertions(2);
      const button = document.createElement("button");
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      button.click();
      expect(handler).toHaveBeenCalledTimes(1);
      removeSyntheticClick();
      button.click();
      button.click();
      button.click();
      expect(handler).toHaveBeenCalledTimes(1); // still only one call
    });

    test("is safe to call more than once", () => {
      expect.assertions(1);
      const button = document.createElement("button");
      const handler = mock(() => {});
      button[ONCLICK] = handler;
      render(button);
      setupSyntheticClick();
      onTestFinished(removeSyntheticClick);
      removeSyntheticClick();
      removeSyntheticClick();
      button.click();
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
