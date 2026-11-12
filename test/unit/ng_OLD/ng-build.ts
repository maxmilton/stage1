// Builds an ng module with Bun feature flags, the way an app's build would, and loads it.

import type * as Ng from "../../src/ng/index.ts";
import type * as Signal from "../../src/ng/signal.ts";

const build = async (file: string, features: string[]): Promise<unknown> => {
  const entry = `${import.meta.dir}/../../src/ng/${file}`;
  const out = await Bun.build({ entrypoints: [entry], features, target: "browser" });
  const code = await out.outputs[0].text();
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const buildSignal = async (features: string[]): Promise<typeof Signal> =>
  (await build("signal.ts", features)) as typeof Signal;

/** The whole of ng, so a built list and the signals driving it share one instance. */
export const buildNg = async (features: string[]): Promise<typeof Ng> =>
  (await build("index.ts", features)) as typeof Ng;
