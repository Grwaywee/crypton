import type { NotifyEvent } from '@crypton/core';

type Listener = (event: NotifyEvent) => void;

/**
 * Minimal in-process pub/sub keyed by copyId. When a copy's token rotates (someone
 * opened it), subscribers are notified so a displaced holder can learn its token went
 * stale (도4 / 옵션: B 열람 시 A에 알림). A production deployment fans this out over
 * Redis pub/sub so it works across server nodes.
 */
export class Notifier {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(copyId: string, fn: Listener): () => void {
    let set = this.listeners.get(copyId);
    if (!set) {
      set = new Set();
      this.listeners.set(copyId, set);
    }
    set.add(fn);
    return () => {
      const s = this.listeners.get(copyId);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) this.listeners.delete(copyId);
    };
  }

  publish(event: NotifyEvent): void {
    const set = this.listeners.get(event.copyId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(event);
      } catch {
        /* a broken subscriber must not break the rotation path */
      }
    }
  }
}
