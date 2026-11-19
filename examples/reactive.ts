// A pager's view model whose state reads and writes as plain properties: reading one in an effect
// follows it, writing one runs what follows it, and `pager.$key` is the key's signal or computed
// (for sub). `page` and `pages` are computed fields: read only. reactive(Pager) gives each `$key`
// field a `key` accessor pair on Pager.prototype (README "State patterns"). The methods read through
// the accessors: call them from event handlers (in an effect, their reads would subscribe it).
//
//   const pager = new Pager(20);
//   pager.total = items.length;
//   effect(() => {
//     label.textContent = `page ${pager.page + 1} of ${pager.pages}`;
//   });
//   next.onclick = () => pager.next();
//   sub(pager.$offset, (offset) => {
//     history.replaceState(null, "", `?offset=${offset}`);
//   });
import { batch, computed, reactive, type Signal, signal } from "stage1";

export class Pager {
  // The keys' types: `declare` emits no field (a field would hide the accessor)
  /** The first item shown, from 0. */
  declare public offset: number;
  /** How many items a page shows. */
  declare public limit: number;
  /** How many items there are. */
  declare public total: number;
  /** The page shown, from 0. */
  declare public readonly page: number;
  /** How many pages the items fill (at least 1). */
  declare public readonly pages: number;
  public readonly $offset = signal(0);
  public readonly $limit: Signal<number>;
  public readonly $total = signal(0);
  // Computeds read lazily: after the constructor has set $limit
  public readonly $page = computed(() => Math.floor(this.offset / this.limit));
  public readonly $pages = computed(() => Math.max(1, Math.ceil(this.total / this.limit)));

  // reactive() makes one instance with no arguments: every parameter needs a default
  public constructor(limit = 10) {
    this.$limit = signal(limit);
  }

  /** Shows `page`, clamped to the pages there are. */
  public go(page: number): void {
    this.offset = (page < 0 ? 0 : Math.min(page, this.pages - 1)) * this.limit;
  }

  public next(): void {
    this.go(this.page + 1);
  }

  public prev(): void {
    this.go(this.page - 1);
  }

  /** Shows `limit` items per page, from the page that holds the first item shown. */
  public resize(limit: number): void {
    // One batch: what reads both runs once, and never sees one written without the other
    batch(() => {
      this.offset = Math.floor(this.offset / limit) * limit;
      this.limit = limit;
    });
  }
}
reactive(Pager);
