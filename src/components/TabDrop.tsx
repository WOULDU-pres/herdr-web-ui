/**
 * The water drop under the pointer on the tab row: 1.25 times the tab, in a layer over the whole
 * window and under the tabs' names, so it spills past the row onto the header and the pane while
 * the names stay readable on top. It moves like water: its leading edge runs to the next tab and
 * the drop thins, then the tail snaps after it. The tail draws out into a thread that breaks into
 * pearls; the front one runs back into the drop and the rest fall away, shrinking until they are
 * gone, or pop with the drop when the pointer leaves the row. Keyboard focus shows it too; a touch
 * leaves nothing behind, and under reduced motion it moves without animating and sheds nothing.
 *
 * The drop and the beads are plain shapes. The liquid's SVG filter blurs them together and cuts the
 * blur back to a hard edge, so shapes that touch merge and a bead pulling away draws a neck that
 * thins and snaps; then it paints the water on that shape: a faint body, an edge, a bright crescent
 * along the bottom, light on the curved surface and a shadow under it.
 *
 * The liquid, the drop and the beads are made here, outside React's tree, and moved with Web
 * Animations: React renders only the layer and the filter, so a re-render never resets a drop.
 */
import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";

import "./TabDrop.css";

import { SHED_DISTANCE, cssTime, dropBox, stretchBox, thinness, threadBeads, type DropBox } from "../lib/tabDrop.ts";

/** beads one snap draws out: from, to */
const SHED = [4, 5] as const;
/** beads on screen at once: a pointer swept along the row does not pile up more */
const MAX_BEADS = 30;
/** the liquid's room around the row: the drop spills up, beads fall down, the light needs a margin.
    No more than that: its filter works on every pixel it covers */
const ROOM = { side: 24, above: 28, below: 56 };

export function TabDrop({ strip }: { strip: RefObject<HTMLDivElement> }) {
  const filter = `tab-water-${useId().replace(/[^\w-]/g, "")}`;
  const layer = useRef<HTMLDivElement>(null);
  const follow = useRef<() => void>(() => undefined);

  useEffect(() => {
    const row = strip.current;
    const host = layer.current;
    if (!row || !host) return;
    const liquid = document.createElement("div");
    liquid.className = "tab-drop-liquid";
    liquid.style.filter = `url(#${filter})`;
    host.append(liquid);
    const drop = document.createElement("span");
    drop.className = "tab-drop";
    liquid.append(drop);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const ms = (token: string): number => cssTime(getComputedStyle(document.documentElement).getPropertyValue(token));
    const beads = new Set<HTMLElement>();
    let origin = { x: 0, y: 0 };
    let target: HTMLElement | null = null;
    let shown = false;
    let move: Animation | null = null;
    let wobble: Animation | null = null;
    let fade: Animation | null = null;

    // the liquid covers the row and its room; the drop and the beads are placed within it
    const fit = (): void => {
      const ends = row.getBoundingClientRect();
      origin = { x: ends.left - ROOM.side, y: ends.top - ROOM.above };
      liquid.style.left = `${origin.x}px`;
      liquid.style.top = `${origin.y}px`;
      liquid.style.width = `${ends.width + ROOM.side * 2}px`;
      liquid.style.height = `${ends.height + ROOM.above + ROOM.below}px`;
    };
    // a tab being renamed is a field: the drop leaves it alone
    const itemOf = (node: EventTarget | null): HTMLElement | null => {
      const item = node instanceof Element ? node.closest<HTMLElement>(".tab-strip-item") : null;
      return item && !item.classList.contains("is-editing") ? item : null;
    };
    // within the row, and never under the + at its end (which keeps the panel's colour)
    const boxOf = (item: HTMLElement): DropBox => {
      const tab = item.getBoundingClientRect();
      const ends = row.getBoundingClientRect();
      const add = row.querySelector(".tab-strip-add")?.getBoundingClientRect().left ?? ends.right;
      return dropBox(
        { left: tab.left - origin.x, top: tab.top - origin.y, width: tab.width, height: tab.height },
        { left: ends.left - origin.x, right: add - origin.x },
      );
    };
    // where the drop is now, mid-flight included
    const live = (): DropBox & { scale: string } => {
      const style = getComputedStyle(drop);
      const translate = style.getPropertyValue("translate");
      const [x = 0, y = 0] = translate === "none" || translate === "" ? [] : translate.split(" ").map(parseFloat);
      const scale = style.getPropertyValue("scale");
      return { left: x, top: y, width: parseFloat(style.width) || 0, height: parseFloat(style.height) || 0, scale: scale === "none" || scale === "" ? "1" : scale };
    };
    const place = (box: DropBox): Keyframe => ({ translate: `${box.left}px ${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    const set = (box: DropBox): void => {
      drop.style.setProperty("translate", `${box.left}px ${box.top}px`);
      drop.style.width = `${box.width}px`;
      drop.style.height = `${box.height}px`;
    };
    const stop = (): void => { move?.cancel(); wobble?.cancel(); fade?.cancel(); };
    const at = (x: number, y: number): string => `${x}px ${y}px`;

    // the beads ride their shares of the tail's run on the drop's own curve, then merge or fall
    const shed = (from: DropBox, stretched: DropBox, to: DropBox): void => {
      const count = Math.min(SHED[0] + Math.floor(Math.random() * (SHED[1] - SHED[0] + 1)), MAX_BEADS - beads.size);
      const duration = ms("--dur-tab-drop");
      const dir = to.left > from.left ? 1 : -1;
      for (const bead of threadBeads(from, stretched, to, Math.max(0, count), Math.random)) {
        const node = document.createElement("span");
        node.className = "tab-drop-bead";
        node.style.width = node.style.height = `${bead.size}px`;
        liquid.append(node);
        const bow = Math.sin(Math.PI * bead.share);
        const run = 1 / bead.life;
        const end = { x: bead.x[2], y: bead.y + bow * 3 };
        const ride: Keyframe[] = [
          { translate: at(bead.x[0], bead.y), scale: "1", easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
          { translate: at(bead.x[1], bead.y + bow * 2), scale: "1", offset: 0.42 * run, easing: "cubic-bezier(0.3, 1.45, 0.55, 1)" },
        ];
        const animation = node.animate(bead.fate === "merge" ? [
          ...ride,
          { translate: at(end.x, end.y), scale: "1", offset: run, easing: "cubic-bezier(0.5, 0, 0.5, 1)" },
          { translate: at(bead.home.x, bead.home.y), scale: "0.5" },
        ] : [
          ...ride,
          { translate: at(end.x, end.y), scale: "1", offset: run, easing: "cubic-bezier(0.2, 0.6, 0.4, 1)" },
          { translate: at(end.x + dir * 4, bead.y + 4), scale: "0.95", offset: run + (1 - run) * 0.25, easing: "cubic-bezier(0.55, 0, 0.9, 0.55)" },
          { translate: at(end.x + dir * 6, bead.y + bead.fall), scale: "0.2" },
        ], { duration: duration * bead.life });
        beads.add(node);
        animation.onfinish = animation.oncancel = () => { beads.delete(node); node.remove(); };
      }
    };
    // the pointer left the row: the beads go with the drop, shrinking where they are
    const popBeads = (): void => {
      for (const node of beads) {
        beads.delete(node);
        const scale = getComputedStyle(node).getPropertyValue("scale");
        node.animate([{ scale: scale === "none" || scale === "" ? "1" : scale }, { scale: "0.1" }], { duration: ms("--dur-base"), easing: "ease-in", fill: "forwards" })
          .onfinish = () => node.remove();
      }
    };

    // it wells up: a small bead that swells and settles
    const appear = (item: HTMLElement): void => {
      stop();
      if (beads.size === 0) fit();
      set(boxOf(item));
      drop.classList.add("is-on");
      shown = true;
      target = item;
      if (reduced.matches) return;
      wobble = drop.animate([
        { scale: "0.3" },
        { scale: "1.08 0.9", offset: 0.5 },
        { scale: "0.97 1.04", offset: 0.75 },
        { scale: "1" },
      ], { duration: ms("--dur-tab-drop"), easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" });
    };

    // the leading edge runs ahead and the drop thins; the tail snaps after it, overshoots and
    // draws out its thread, and the drop wobbles round again
    const travel = (item: HTMLElement): void => {
      if (item === target) return;
      const from = live();
      const to = boxOf(item);
      target = item;
      stop();
      set(to);
      if (reduced.matches) return;
      const stretched = stretchBox(from, to);
      const duration = ms("--dur-tab-drop");
      move = drop.animate([
        { ...place(from), easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
        { ...place(stretched), offset: 0.42, easing: "cubic-bezier(0.3, 1.45, 0.55, 1)" },
        place(to),
      ], { duration });
      wobble = drop.animate([
        { scale: from.scale },
        { scale: `1 ${thinness(stretched, to).toFixed(3)}`, offset: 0.42 },
        { scale: "1 1.08", offset: 0.68 },
        { scale: "1 0.97", offset: 0.85 },
        { scale: "1" },
      ], { duration, easing: "ease-out" });
      if (Math.abs(to.left - from.left) > SHED_DISTANCE) shed(from, stretched, to);
    };

    // it shrinks to nothing where it is, and its beads with it
    const vanish = (): void => {
      popBeads();
      if (!shown) return;
      const here = live();
      stop();
      set(here);
      shown = false;
      target = null;
      drop.classList.remove("is-on");
      if (reduced.matches) return;
      fade = drop.animate([{ scale: here.scale, opacity: 1 }, { scale: "0.2", opacity: 1 }], { duration: ms("--dur-base") * 1.4, easing: "cubic-bezier(0.5, 0, 0.9, 0.5)" });
    };

    const show = (item: HTMLElement): void => { if (shown) travel(item); else appear(item); };
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
    // the row scrolled, the window resized, or the snapshot moved the tab (renamed, closed,
    // a dot came or went): the drop follows, or goes with its tab
    follow.current = () => {
      if (!shown || !target) return;
      if (!target.isConnected || target.classList.contains("is-editing")) { vanish(); return; }
      fit();
      set(boxOf(target));
    };
    const onLayout = (): void => follow.current();

    row.addEventListener("pointerover", onOver);
    row.addEventListener("pointerleave", vanish);
    row.addEventListener("focusin", onFocusIn);
    row.addEventListener("focusout", onFocusOut);
    row.addEventListener("scroll", onLayout, { passive: true });
    window.addEventListener("resize", onLayout);
    return () => {
      row.removeEventListener("pointerover", onOver);
      row.removeEventListener("pointerleave", vanish);
      row.removeEventListener("focusin", onFocusIn);
      row.removeEventListener("focusout", onFocusOut);
      row.removeEventListener("scroll", onLayout);
      window.removeEventListener("resize", onLayout);
      follow.current = () => undefined;
      stop();
      liquid.remove();
    };
  }, [strip, filter]);

  useLayoutEffect(() => follow.current());

  return (
    <div ref={layer} className="tab-drop-layer" aria-hidden="true">
      <svg className="tab-drop-defs" focusable="false">
        <filter id={filter} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          {/* the liquid: blurred together, cut back to a hard edge */}
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="soft" />
          <feColorMatrix in="soft" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 20 -8" result="liquid" />
          {/* a shadow under it, outside it only, so the body stays clear */}
          <feOffset in="liquid" dy="2" result="lower" />
          <feGaussianBlur in="lower" stdDeviation="2.5" result="lowerSoft" />
          <feFlood className="tab-water-shade" result="shadeColor" />
          <feComposite in="shadeColor" in2="lowerSoft" operator="in" result="shadeAll" />
          <feComposite in="shadeAll" in2="liquid" operator="out" result="shadow" />
          <feFlood className="tab-water-body" result="bodyColor" />
          <feComposite in="bodyColor" in2="liquid" operator="in" result="body" />
          <feMorphology in="liquid" operator="erode" radius="1" result="inner" />
          <feComposite in="liquid" in2="inner" operator="out" result="ring" />
          <feFlood className="tab-water-edge" result="edgeColor" />
          <feComposite in="edgeColor" in2="ring" operator="in" result="edge" />
          {/* the light the drop gathers along its bottom */}
          <feOffset in="liquid" dy="-2.5" result="raised" />
          <feComposite in="liquid" in2="raised" operator="out" result="crescent" />
          <feGaussianBlur in="crescent" stdDeviation="0.7" result="crescentSoft" />
          <feFlood className="tab-water-rim" result="rimColor" />
          <feComposite in="rimColor" in2="crescentSoft" operator="in" result="caustic" />
          {/* light on the curved surface, from the upper left */}
          <feGaussianBlur in="liquid" stdDeviation="2.5" result="height" />
          <feSpecularLighting in="height" className="tab-water-light" surfaceScale="6" specularConstant="1.25" specularExponent="32" result="shine">
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
    </div>
  );
}
