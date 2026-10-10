/** In-memory views only. A write invalidates both stored and in-flight views. */
export class PageCache {
  constructor(limit = 3) { this.limit = limit; this.pages = new Map(); this.revision = 0; this.serial = 0; }
  create(key) { return { key, generation: ++this.serial, revision: this.revision, ready: false, parts: new Set() }; }
  fresh(page) { return page?.revision === this.revision; }
  save(page, signature, payload) {
    if (!page?.ready || !this.fresh(page)) return;
    this.pages.delete(page.key);
    this.pages.set(page.key, { ...page, signature, payload });
    while (this.pages.size > this.limit) this.pages.delete(this.pages.keys().next().value);
  }
  take(key, signature) {
    const page = this.pages.get(key); this.pages.delete(key);
    return page?.signature === signature && this.fresh(page) ? page : null;
  }
  invalidate() { this.revision++; this.pages.clear(); }
}
