/**
 * Clicking a route line on a map focuses the flights it stands for, in the list beside it.
 * A line can stand for several flights (three logbook flights on one route, a board's five
 * departures to one city): the first click focuses all of them, each further click on the same
 * line steps to the next one, and after the last it goes back to all of them. A line with one
 * flight focuses it, and a second click lets go.
 */
export type LineFocus = {
  /** The map route's key. */
  key: string;
  /** -1 = every flight on the line; otherwise the index of the one in focus. */
  at: number;
} | null;

/** The focus after a click on the line `key`, which stands for `n` flights. */
export function nextFocus(cur: LineFocus, key: string, n: number): LineFocus {
  if (n < 1) return null;
  if (!cur || cur.key !== key) return { key, at: n > 1 ? -1 : 0 };
  if (n === 1) return null;
  return { key, at: cur.at + 1 >= n ? -1 : cur.at + 1 };
}

/** Is item i of the line `key` in focus? */
export function inFocus(f: LineFocus, key: string, i: number): boolean {
  return !!f && f.key === key && (f.at === -1 || f.at === i);
}

/**
 * Bring the first element matching `selector` into view (inside its scrolling list too), once
 * React has drawn the new focus.
 */
export function reveal(selector: string): void {
  requestAnimationFrame(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      block: "nearest",
      behavior: still ? "auto" : "smooth",
    });
  });
}
