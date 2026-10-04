"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useCollapse } from "./collapse";

/**
 * Plays a graphic's entrance animation when it scrolls into view.
 *
 * - mode "always" (default): resets when it scrolls fully away, so it plays every time.
 * - mode "once": plays the first time it's seen, then stays put. Pass `sectionId` to
 *   re-arm it when that section is collapsed and opened again (it plays on the next
 *   view: immediately if it's on screen, otherwise when scrolled to).
 *
 * CSS animations: add an `a-*` class (globals.css "replayable animations"); they only
 * run while the wrapper has `.play`. SMIL / JS animations: key the animated subtree by
 * `useReplay()`, which increments on every play, so it remounts and starts over.
 * `.play` is toggled on the DOM directly so a restart doesn't need a re-render.
 */
const ReplayContext = createContext(0);
export const useReplay = () => useContext(ReplayContext);

const inView = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.bottom > -60 && r.top < window.innerHeight + 60 && r.height > 0;
};

export function Replay({
  children,
  className,
  style,
  mode = "always",
  sectionId,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  mode?: "always" | "once";
  sectionId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [round, setRound] = useState(0);
  const armed = useRef(true);

  const play = () => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("play");
    void el.offsetWidth; // restart CSS animations
    el.classList.add("play");
    armed.current = false;
    setRound((r) => r + 1);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && e.boundingClientRect.height > 0) {
          if (armed.current) play();
        } else if (mode === "always") {
          el.classList.remove("play");
          armed.current = true;
        }
      },
      { rootMargin: "60px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mode]);

  // "once" + sectionId: re-arm when the section is opened again after being collapsed.
  const { isCollapsed } = useCollapse();
  const collapsed = sectionId ? isCollapsed(sectionId) : false;
  const wasCollapsed = useRef(collapsed);
  useEffect(() => {
    if (mode === "once" && wasCollapsed.current && !collapsed) {
      armed.current = true;
      ref.current?.classList.remove("play");
      // Wait for the section to lay out, then play now if visible; otherwise the
      // observer plays it when it's next scrolled into view.
      requestAnimationFrame(() => {
        if (ref.current && inView(ref.current)) play();
      });
    }
    wasCollapsed.current = collapsed;
  }, [collapsed, mode]);

  return (
    <div ref={ref} className={`replay${className ? ` ${className}` : ""}`} style={style}>
      <ReplayContext.Provider value={round}>{children}</ReplayContext.Provider>
    </div>
  );
}
