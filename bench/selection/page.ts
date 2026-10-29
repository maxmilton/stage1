// Browser side: one page per variant, ops modelled on js-framework-benchmark.

import { mapper, selector } from "../../src/ng/composables.ts";
import { list } from "../../src/ng/reconcile.ts";
import { set, signal } from "../../src/ng/signal.ts";

interface Row {
  id: number;
  label: string;
}
type Create = (item: Row, own: (dispose: () => void) => void) => HTMLTableRowElement;

declare const gc: () => void;

let nextId = 1;
const rows = (count: number): Row[] =>
  Array.from({ length: count }, () => ({ id: nextId, label: `row ${nextId++}` }));

const tpl = document.createElement("template");
tpl.innerHTML = "<tr><td></td><td><a></a></td><td><a>x</a></td><td></td></tr>";
const proto = tpl.content.firstChild as HTMLTableRowElement;
const fill = (item: Row): HTMLTableRowElement => {
  const tr = proto.cloneNode(true) as HTMLTableRowElement;
  (tr.firstChild as HTMLElement).textContent = String(item.id);
  (tr.childNodes[1].firstChild as HTMLElement).textContent = item.label;
  return tr;
};
const paint = (tr: HTMLElement, selected: boolean): void => {
  tr.className = selected ? "danger" : "";
};

const style = document.createElement("style");
style.textContent = ".danger{background:#f88}td{padding:2px 6px}";
document.head.append(style);
const table = document.createElement("table");
const tbody = document.createElement("tbody");
table.append(tbody);
document.body.append(table);

const items = signal<readonly Row[]>([]);
const selected = signal(0);

const viaSelector =
  (make: typeof selector): (() => Create) =>
  () => {
    const select = make(selected);
    return (item, own) => {
      const tr = fill(item);
      own(
        select(item.id, (on) => {
          paint(tr, on);
        }),
      );
      return tr;
    };
  };
const viaMapper =
  (make: typeof mapper): (() => Create) =>
  () => {
    const mark = make(selected, paint);
    return (item, own) => {
      const tr = fill(item);
      own(mark(item.id, tr));
      return tr;
    };
  };

const variants: Record<string, () => Create> = {
  none: () => fill,
  selector: viaSelector(selector),
  mapper: viaMapper(mapper),
};

// Forcing style and layout costs the same for every variant, so it's opt-in
let layout = false;

const setup = (variant: string, withLayout: boolean): void => {
  if (!Object.hasOwn(variants, variant)) throw new Error(`Unknown variant: ${variant}`);
  layout = withLayout;
  list(tbody, items, "id", variants[variant]());
};

const reset = (count: number): void => {
  set(items, []);
  set(selected, 0);
  if (count) set(items, rows(count));
};

// Returns [script ms, script + style/layout ms, or 0 without --layout]
const time = (fn: () => void): [number, number] => {
  gc();
  const t0 = performance.now();
  fn();
  const t1 = performance.now();
  if (!layout) return [t1 - t0, 0];
  void document.body.offsetHeight;
  return [t1 - t0, performance.now() - t0];
};

/** An op that times `fn` on a list reset to `count` rows. */
const from =
  (count: number, fn: (current: readonly Row[]) => readonly Row[]) => (): [number, number] => {
    reset(count);
    return time(() => {
      set(items, fn(items.v));
    });
  };

const SELECTS = 1000;

/** Times SELECTS selections among `count` rows, striding by a prime so each differs from the last. */
const selectAmong = (count: number) => (): [number, number] => {
  if (items.v.length !== count) reset(count);
  const ids = Array.from({ length: SELECTS }, (_item, index) => items.v[(index * 7919) % count].id);
  return time(() => {
    for (const id of ids) set(selected, id);
  });
};

const ops: Record<string, () => [number, number]> = {
  create1k: from(0, () => rows(1000)),
  create10k: from(0, () => rows(10_000)),
  replace1k: from(1000, () => rows(1000)),
  append1k: from(1000, (current) => [...current, ...rows(1000)]),
  update10th: from(1000, (current) =>
    current.map((row, index) => (index % 10 ? row : { ...row, label: `${row.label} !!!` })),
  ),
  swap: from(1000, (current) => current.with(1, current[998]).with(998, current[1])),
  remove: from(1000, (current) => current.toSpliced(500, 1)),
  clear1k: from(1000, () => []),
  clear10k: from(10_000, () => []),
  [`select1k x${SELECTS}`]: selectAmong(1000),
  [`select10k x${SELECTS}`]: selectAmong(10_000),
};

Object.assign(globalThis, { setup, ops });
