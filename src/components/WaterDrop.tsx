/**
 * Water drops (Settings → Water drops): a drop of water that follows the pointer over what can be
 * picked. The tab row has its own (TabDrop.tsx), which spills past the row; every other group puts
 * a <WaterDrop> inside its container, and the drop runs between the group's items there. The
 * motion is shared (waterDropMotion.ts); <WaterFilter> holds the one filter that makes the drops
 * water, rendered once by App while the setting is on.
 *
 * A group's layer sits inside its container, under the items: the container is made a stacking
 * context of its own (component CSS, under `:root[data-drops="on"]`) and the layer is at z-index
 * -1 in it, so it reaches inside a sticky header, a portaled menu or a modal alike, and the items'
 * labels stay on top. The layer scrolls with the items; the liquid in it covers only the run at hand,
 * cut to what is on screen (waterDropMotion.ts).
 */
import { useEffect, useLayoutEffect, useRef } from "react";

import "./WaterDrop.css";

import { dropBox, type DropBox } from "../lib/waterDrop.ts";
import { useSettings } from "../lib/settings.ts";
import { createDropMotion, type Area } from "./waterDropMotion.ts";

/** the filter every drop is painted with; one per document */
export const WATER_FILTER_ID = "water-drop";

/** a pass across the gap between two items does not drop the drop */
const LEAVE_GRACE_MS = 110;

export interface WaterDropProps {
  /** the items the drop runs between, as a selector within the group */
  items: string;
  /**
   * "pointer": under the pointer, and under the keyboard focus when it shows. "selected": on the
   * marked item (`marked`), for a list whose highlight follows the keys while the focus stays in a
   * field (the command palette, the composer's completions); the pointer takes it to the item it is
   * over, and it goes back to the marked one when the pointer leaves the list.
   */
  follow?: "pointer" | "selected";
  /** for follow="selected": the mark, as a selector the item matches */
  marked?: string;
  /** the layer's element: an "li" inside a list, so the list holds only list items */
  as?: "div" | "li";
  /** how much bigger than its item the drop is, across and down */
  scale?: number;
  /** its corners: a capsule unless given */
  radius?: string;
  /** how far past the group's sides it may spill, in pixels */
  spillX?: number;
  spillY?: number;
}

/** the scrolling boxes around an element, nearest first: they clip it and they move it */
function scrollParents(element: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|hidden)/.test(style.overflowY + style.overflowX)) found.push(node);
  }
  return found;
}

export function WaterDrop({ items, follow = "pointer", marked = '[aria-selected="true"]', as = "div", scale = 1.04, radius, spillX = 2, spillY = 4 }: WaterDropProps) {
  const { settings } = useSettings();
  const on = settings.waterDrops;
  const layer = useRef<HTMLElement | null>(null);
  const keep = useRef<() => void>(() => undefined);

  useEffect(() => {
    const host = layer.current;
    const group = host?.parentElement;
    if (!on || !host || !group) return;
    const liquid = document.createElement("div");
    liquid.className = "water-liquid";
    host.append(liquid);
    const scrollers = scrollParents(group);
    // the group as far as it is on screen (inside its scrolling boxes and the window), in the layer's space
    const onScreen = (): Area => {
      const base = host.getBoundingClientRect();
      const area = group.getBoundingClientRect();
      let { left, top, right, bottom } = area;
      for (const clip of [...scrollers.map((node) => node.getBoundingClientRect()), { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }]) {
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
      return { left: left - base.left, top: top - base.top, right: right - base.left, bottom: bottom - base.top };
    };
    const motion = createDropMotion(liquid, { radius, maxBead: 20, clip: onScreen });
    let target: HTMLElement | null = null;
    let leave = 0;

    // the layer scrolls with the group's items, so an item's box in its space holds while the list scrolls
    const boxOf = (item: HTMLElement): DropBox => {
      const base = host.getBoundingClientRect();
      const rect = item.getBoundingClientRect();
      const box = group.getBoundingClientRect();
      return dropBox(
        { left: rect.left - base.left, top: rect.top - base.top, width: rect.width, height: rect.height },
        { left: box.left - base.left - spillX, right: box.right - base.left + spillX, top: box.top - base.top - spillY, bottom: box.bottom - base.top + spillY },
        scale,
      );
    };
    const itemOf = (node: EventTarget | null): HTMLElement | null => {
      const item = node instanceof Element ? node.closest<HTMLElement>(items) : null;
      return item && group.contains(item) && !item.matches(":disabled, [aria-disabled='true']") ? item : null;
    };
    const show = (item: HTMLElement): void => {
      if (item === target && motion.shown) return;
      target = item;
      motion.show(boxOf(item));
    };
    const vanish = (): void => {
      window.clearTimeout(leave);
      target = null;
      motion.vanish();
    };
    // the pointer went: the drop goes back to an item the keyboard focus is showing on (its fill is
    // dropped while water drops are on, so the drop is its highlight), and goes only when that left too
    const rest = (): void => {
      window.clearTimeout(leave);
      const active = document.activeElement;
      const focused = active instanceof HTMLElement && active.matches(":focus-visible") ? itemOf(active) : null;
      if (focused) show(focused);
      else vanish();
    };
    // the window resized: the item may have moved in the layer's space
    const onLayout = (): void => {
      if (motion.shown && target) motion.retarget(boxOf(target));
    };
    keep.current = () => {
      if (!motion.shown || !target) return;
      if (!target.isConnected) { if (follow === "selected") pick(); else vanish(); return; }
      motion.retarget(boxOf(target));
    };

    // follow="selected": the drop sits on the marked item, wherever the mark moves, unless the pointer
    // is over another item
    let pointing = false;
    const pick = (): void => {
      if (pointing) return;
      const item = [...group.querySelectorAll<HTMLElement>(items)].find((candidate) => candidate.matches(marked));
      if (item) show(item);
      else vanish();
    };
    const observer = follow === "selected" ? new MutationObserver(pick) : null;
    observer?.observe(group, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected", "aria-current", "data-active"] });
    if (follow === "selected") pick();
    const onPoint = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      const item = itemOf(event.target);
      pointing = item !== null;
      if (item) show(item);
      else pick();
    };
    const onPointLeave = (): void => { pointing = false; pick(); };

    const onOver = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      window.clearTimeout(leave);
      const item = itemOf(event.target);
      if (item) show(item);
      else leave = window.setTimeout(rest, LEAVE_GRACE_MS);
    };
    const onFocusIn = (event: FocusEvent): void => {
      const item = itemOf(event.target);
      if (item && event.target instanceof Element && event.target.matches(":focus-visible")) show(item);
    };
    const onFocusOut = (event: FocusEvent): void => {
      if ((event.relatedTarget instanceof Node && group.contains(event.relatedTarget)) || group.matches(":hover")) return;
      vanish();
    };
    if (follow === "pointer") {
      group.addEventListener("pointerover", onOver);
      group.addEventListener("pointerleave", rest);
      group.addEventListener("focusin", onFocusIn);
      group.addEventListener("focusout", onFocusOut);
    } else {
      group.addEventListener("pointerover", onPoint);
      group.addEventListener("pointerleave", onPointLeave);
    }
    window.addEventListener("resize", onLayout);
    return () => {
      window.clearTimeout(leave);
      observer?.disconnect();
      group.removeEventListener("pointerover", onOver);
      group.removeEventListener("pointerleave", rest);
      group.removeEventListener("focusin", onFocusIn);
      group.removeEventListener("focusout", onFocusOut);
      group.removeEventListener("pointerover", onPoint);
      group.removeEventListener("pointerleave", onPointLeave);
      window.removeEventListener("resize", onLayout);
      keep.current = () => undefined;
      motion.destroy();
      liquid.remove();
    };
  }, [on, items, follow, marked, scale, radius, spillX, spillY]);

  // the group re-rendered: the item under the drop may have moved, grown, or gone
  useLayoutEffect(() => keep.current());

  if (!on) return null;
  return as === "li"
    ? <li ref={(node) => { layer.current = node; }} className="water-layer" aria-hidden="true" role="presentation" />
    : <div ref={(node) => { layer.current = node; }} className="water-layer" aria-hidden="true" />;
}

/** The filter that makes the drops water, painted with the --water-* colours. One per document. */
export function WaterFilter() {
  return (
    <svg className="water-defs" aria-hidden="true" focusable="false">
      <filter id={WATER_FILTER_ID} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        {/* the liquid: the shapes blurred together, cut back to a hard edge */}
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="soft" />
        <feColorMatrix in="soft" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 20 -8" result="liquid" />
        {/* a shadow under it, outside it only, so the body stays clear */}
        <feOffset in="liquid" dy="2" result="lower" />
        <feGaussianBlur in="lower" stdDeviation="2.5" result="lowerSoft" />
        <feFlood className="water-shade" result="shadeColor" />
        <feComposite in="shadeColor" in2="lowerSoft" operator="in" result="shadeAll" />
        <feComposite in="shadeAll" in2="liquid" operator="out" result="shadow" />
        <feFlood className="water-body" result="bodyColor" />
        <feComposite in="bodyColor" in2="liquid" operator="in" result="body" />
        <feMorphology in="liquid" operator="erode" radius="1" result="inner" />
        <feComposite in="liquid" in2="inner" operator="out" result="ring" />
        <feFlood className="water-edge" result="edgeColor" />
        <feComposite in="edgeColor" in2="ring" operator="in" result="edge" />
        {/* the light the drop gathers along its bottom */}
        <feOffset in="liquid" dy="-2.5" result="raised" />
        <feComposite in="liquid" in2="raised" operator="out" result="crescent" />
        <feGaussianBlur in="crescent" stdDeviation="0.7" result="crescentSoft" />
        <feFlood className="water-rim" result="rimColor" />
        <feComposite in="rimColor" in2="crescentSoft" operator="in" result="caustic" />
        {/* light on the curved surface, from the upper left */}
        <feGaussianBlur in="liquid" stdDeviation="2.5" result="height" />
        <feSpecularLighting in="height" className="water-light" surfaceScale="6" specularConstant="1.25" specularExponent="32" result="shine">
          <feDistantLight azimuth="235" elevation="42" />
        </feSpecularLighting>
        <feComposite in="shine" in2="liquid" operator="in" result="gloss" />
        <feMerge>
          <feMergeNode in="shadow" />
          <feMergeNode in="body" />
          <feMergeNode in="edge" />
          <feMergeNode in="caustic" />
          <feMergeNode in="gloss" />
        </feMerge>
      </filter>
    </svg>
  );
}
