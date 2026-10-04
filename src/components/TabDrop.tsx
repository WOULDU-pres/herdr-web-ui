/**
 * The tab row's water drop (Settings → Water drops): 1.25 times the tab, in a layer over the whole
 * window and under the tabs' names, so it spills past the row onto the header and the pane while
 * the names stay readable on top. Every other group's drop stays inside its group (WaterDrop.tsx);
 * this one is the exception, and it moves the same way (waterDropMotion.ts). Keyboard focus shows
 * it too; a touch leaves nothing behind.
 *
 * React renders only the layer; the liquid, the drop and the beads are made here, so a re-render
 * of the strip never resets a drop in flight.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import "./TabDrop.css";
import "./WaterDrop.css";

import { dropBox, type DropBox } from "../lib/waterDrop.ts";
import { createDropMotion } from "./waterDropMotion.ts";

/** the liquid's room around a run: the drop spills past the row above, beads fall below it */
const ROOM = { side: 24, above: 28, below: 56 };

export function TabDrop({ strip }: { strip: RefObject<HTMLDivElement> }) {
  const layer = useRef<HTMLDivElement>(null);
  const keep = useRef<() => void>(() => undefined);

  useEffect(() => {
    const row = strip.current;
    const host = layer.current;
    if (!row || !host) return;
    const liquid = document.createElement("div");
    liquid.className = "water-liquid";
    host.append(liquid);
    // the layer covers the window, so its space is the window's
    const motion = createDropMotion(liquid, { room: ROOM, clip: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }) });
    let target: HTMLElement | null = null;

    // a tab being renamed is a field: the drop leaves it alone
    const itemOf = (node: EventTarget | null): HTMLElement | null => {
      const item = node instanceof Element ? node.closest<HTMLElement>(".tab-strip-item") : null;
      return item && !item.classList.contains("is-editing") ? item : null;
    };
    // within the row's ends and short of the + (which keeps the panel's colour), free above and below
    const boxOf = (item: HTMLElement): DropBox => {
      const tab = item.getBoundingClientRect();
      const ends = row.getBoundingClientRect();
      const add = row.querySelector(".tab-strip-add")?.getBoundingClientRect().left ?? ends.right;
      return dropBox({ left: tab.left, top: tab.top, width: tab.width, height: tab.height }, { left: ends.left, right: add });
    };
    const show = (item: HTMLElement): void => {
      if (item === target && motion.shown) return;
      target = item;
      motion.show(boxOf(item));
    };
    const vanish = (): void => {
      target = null;
      motion.vanish();
    };
    // the pointer went: the drop goes back to a tab the keyboard focus is showing on, and goes only
    // when that left too
    const rest = (): void => {
      const active = document.activeElement;
      const focused = active instanceof HTMLElement && active.matches(":focus-visible") ? itemOf(active) : null;
      if (focused) show(focused);
      else vanish();
    };
    const onOver = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      const item = itemOf(event.target);
      if (item) show(item);
    };
    const onFocusIn = (event: FocusEvent): void => {
      const item = itemOf(event.target);
      if (item && event.target instanceof Element && event.target.matches(":focus-visible")) show(item);
    };
    const onFocusOut = (event: FocusEvent): void => {
      if ((event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) || row.matches(":hover")) return;
      vanish();
    };
    // the row scrolled or the window resized: the drop moves with its tab at once
    const onLayout = (): void => {
      if (motion.shown && target) motion.place(boxOf(target));
    };
    // the snapshot moved the tab (renamed, closed, a dot came or went): the drop follows, or goes with it
    keep.current = () => {
      if (!motion.shown || !target) return;
      if (!target.isConnected || target.classList.contains("is-editing")) { vanish(); return; }
      motion.retarget(boxOf(target));
    };

    row.addEventListener("pointerover", onOver);
    row.addEventListener("pointerleave", rest);
    row.addEventListener("focusin", onFocusIn);
    row.addEventListener("focusout", onFocusOut);
    row.addEventListener("scroll", onLayout, { passive: true });
    window.addEventListener("resize", onLayout);
    return () => {
      row.removeEventListener("pointerover", onOver);
      row.removeEventListener("pointerleave", rest);
      row.removeEventListener("focusin", onFocusIn);
      row.removeEventListener("focusout", onFocusOut);
      row.removeEventListener("scroll", onLayout);
      window.removeEventListener("resize", onLayout);
      keep.current = () => undefined;
      motion.destroy();
      liquid.remove();
    };
  }, [strip]);

  useLayoutEffect(() => keep.current());

  return <div ref={layer} className="tab-drop-layer" aria-hidden="true" />;
}
