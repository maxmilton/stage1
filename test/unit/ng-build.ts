// Builds src/ng/signal.ts with Bun feature flags, the way an app's build would, and loads it.

import type * as Signal from "../../src/ng/signal.ts";

const source = `${import.meta.dir}/../../src/ng/signal.ts`;

export const buildSignal = async (features: string[]): Promise<typeof Signal> => {
  const out = await Bun.build({ entrypoints: [source], features, target: "browser" });
  const code = await out.outputs[0].text();
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return (await import(url)) as typeof Signal;
  } finally {
    URL.revokeObjectURL(url);
  }
};
