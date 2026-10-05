/**
 * The water drop's motion, shared by the tab row's drop (TabDrop.tsx) and every other group's
 * (WaterDrop.tsx). One drop in a liquid element inside a host the caller owns; boxes are in the
 * host's space. The drop wells up over its first box; to the next its leading edge runs ahead and
 * it thins, then the tail snaps after it and draws out a thread of beads that breaks into pearls:
 * the front one runs back into the drop, the rest fall away and shrink to nothing. When it goes it
 * shrinks where it is, and the beads still out pop with it. Under reduced motion it only jumps, and
 * sheds nothing.
 *
 * The drop and the beads are plain shapes: the liquid's filter (WaterFilter in WaterDrop.tsx) makes
 * them one water. The filter works on every pixel the liquid covers, so the liquid covers only the
 * run at hand (where the drop is, where it goes, the beads still out, and room around them), cut
 * to what is on screen; when it moves, everything in it is moved back by as much, so nothing jumps.
 * The shapes are made here, outside React's tree, and moved with Web Animations.
 */
import { SHED_DISTANCE, cssTime, runOf, stretchBox, thinness, threadBeads, type DropBox, type Point } from "../lib/waterDrop.ts";

/** beads one snap draws out: from, to */
const SHED = [4, 5] as const;
/** beads out at once: a pointer swept along a group does not pile up more */
const MAX_BEADS = 30;

export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DropMotion {
  /** wells up over a box, or runs there from where it is */
  show(box: DropBox): void;
  /** the box it rests on moved (the layout changed under it): it follows without running there */
  retarget(box: DropBox): void;
  /** jumps to a box at once, as when the host moved under it; the beads still out pop */
  place(box: DropBox): void;
  /** shrinks away where it is, and its beads with it */
  vanish(): void;
  readonly shown: boolean;
  destroy(): void;
}

export interface DropMotionOptions {
  /** its corners: a capsule unless given */
  radius?: string;
  /** the largest bead across, in pixels: a wide row's drop sheds beads, not slabs */
  maxBead?: number;
  /** the liquid's room around a run: the drop spills and wobbles, beads fall below, the light needs a margin */
  room?: { side: number; above: number; below: number };
  /** the part of the host on screen, in the host's space: the liquid never covers more than this and its room */
  clip?: () => Area | null;
}

export function createDropMotion(liquid: HTMLElement, { radius, maxBead = Infinity, room = { side: 16, above: 16, below: 40 }, clip }: DropMotionOptions = {}): DropMotion {
  const drop = document.createElement("span");
  drop.className = "water-drop";
  if (radius) drop.style.borderRadius = radius;
  liquid.append(drop);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ms = (token: string): number => cssTime(getComputedStyle(document.documentElement).getPropertyValue(token));
  // each bead out, and how far the liquid has moved since it was shed
  const beads = new Map<HTMLElement, Point>();
  let origin: Point = { x: 0, y: 0 };
  let covered: Area = { left: 0, top: 0, right: 0, bottom: 0 };
  // the box the drop rests on, or runs to, in the host's space
  let resting: DropBox | null = null;
  let shown = false;
  let move: Animation | null = null;
  let wobble: Animation | null = null;
  let fade: Animation | null = null;

  const local = (box: DropBox): DropBox => ({ ...box, left: box.left - origin.x, top: box.top - origin.y });
  const hosted = (box: DropBox): DropBox => ({ ...box, left: box.left + origin.x, top: box.top + origin.y });
  // where the drop is now, mid-flight included, in the liquid's space
  const live = (): DropBox & { scale: string } => {
    const style = getComputedStyle(drop);
    const translate = style.getPropertyValue("translate");
    const [x = 0, y = 0] = translate === "none" || translate === "" ? [] : translate.split(" ").map(parseFloat);
    const scale = style.getPropertyValue("scale");
    return { left: x, top: y, width: parseFloat(style.width) || 0, height: parseFloat(style.height) || 0, scale: scale === "none" || scale === "" ? "1" : scale };
  };
  const frame = (box: DropBox): Keyframe => ({ translate: `${box.left}px ${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  const set = (box: DropBox): void => {
    drop.style.setProperty("translate", `${box.left}px ${box.top}px`);
    drop.style.width = `${box.width}px`;
    drop.style.height = `${box.height}px`;
  };
  const stop = (): void => { move?.cancel(); wobble?.cancel(); fade?.cancel(); };
  const at = (point: Point): string => `${point.x}px ${point.y}px`;
  // the beads out, in the host's space
  const beadBoxes = (): DropBox[] => {
    if (beads.size === 0) return [];
    const base = liquid.getBoundingClientRect();
    return [...beads.keys()].map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left - base.left + origin.x, top: rect.top - base.top + origin.y, width: rect.width, height: rect.height };
    });
  };
  const inside = (box: DropBox): boolean => box.left >= covered.left && box.top >= covered.top && box.left + box.width <= covered.right && box.top + box.height <= covered.bottom;
  const same = (a: DropBox, b: DropBox): boolean => Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

  // cover these boxes and their room, as far as they are on screen; what is in the liquid moves back
  // by as much as the liquid moves. The drop's own run is restarted by the caller.
  const cover = (boxes: DropBox[]): void => {
    let area: Area = {
      left: Math.min(...boxes.map((box) => box.left)) - room.side,
      top: Math.min(...boxes.map((box) => box.top)) - room.above,
      right: Math.max(...boxes.map((box) => box.left + box.width)) + room.side,
      bottom: Math.max(...boxes.map((box) => box.top + box.height)) + room.below,
    };
    const screen = clip?.();
    if (screen) {
      area = {
        left: Math.max(area.left, screen.left - room.side),
        top: Math.max(area.top, screen.top - room.above),
        right: Math.min(area.right, screen.right + room.side),
        bottom: Math.min(area.bottom, screen.bottom + room.below),
      };
    }
    const dx = origin.x - area.left;
    const dy = origin.y - area.top;
    origin = { x: area.left, y: area.top };
    covered = area;
    liquid.style.left = `${area.left}px`;
    liquid.style.top = `${area.top}px`;
    liquid.style.width = `${Math.max(0, area.right - area.left)}px`;
    liquid.style.height = `${Math.max(0, area.bottom - area.top)}px`;
    if (dx === 0 && dy === 0) return;
    const rest = live();
    set({ ...rest, left: rest.left + dx, top: rest.top + dy });
    for (const [node, moved] of beads) {
      moved.x += dx;
      moved.y += dy;
      node.style.transform = `translate(${moved.x}px, ${moved.y}px)`;
    }
  };

  // the beads ride their shares of the tail's run on the drop's own curve, then merge or fall
  const shed = (from: DropBox, stretched: DropBox, to: DropBox): void => {
    const count = Math.min(SHED[0] + Math.floor(Math.random() * (SHED[1] - SHED[0] + 1)), MAX_BEADS - beads.size);
    const duration = ms("--dur-water");
    const { axis, dir } = runOf(from, to);
    const drift = axis === "x" ? dir : 0;
    for (const bead of threadBeads(from, stretched, to, Math.max(0, count), Math.random, maxBead)) {
      const node = document.createElement("span");
      node.className = "water-bead";
      node.style.width = node.style.height = `${bead.size}px`;
      liquid.append(node);
      const [start, half, end] = bead.at;
      const run = 1 / bead.life;
      const ride: Keyframe[] = [
        { translate: at(start), scale: "1", easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
        { translate: at(half), scale: "1", offset: 0.42 * run, easing: "cubic-bezier(0.3, 1.45, 0.55, 1)" },
      ];
      const animation = node.animate(bead.fate === "merge" ? [
        ...ride,
        { translate: at(end), scale: "1", offset: run, easing: "cubic-bezier(0.5, 0, 0.5, 1)" },
        { translate: at(bead.home), scale: "0.5" },
      ] : [
        ...ride,
        { translate: at(end), scale: "1", offset: run, easing: "cubic-bezier(0.2, 0.6, 0.4, 1)" },
        { translate: at({ x: end.x + drift * 4, y: end.y + 4 }), scale: "0.95", offset: run + (1 - run) * 0.25, easing: "cubic-bezier(0.55, 0, 0.9, 0.55)" },
        { translate: at({ x: end.x + drift * 6, y: end.y + bead.fall }), scale: "0.2" },
      ], { duration: duration * bead.life });
      beads.set(node, { x: 0, y: 0 });
      animation.onfinish = animation.oncancel = () => { beads.delete(node); node.remove(); };
    }
  };
  const popBeads = (): void => {
    for (const node of [...beads.keys()]) {
      beads.delete(node);
      if (reduced.matches) {
        node.remove();
        continue;
      }
      const scale = getComputedStyle(node).getPropertyValue("scale");
      node.animate([{ scale: scale === "none" || scale === "" ? "1" : scale }, { scale: "0.1" }], { duration: ms("--dur-base"), easing: "ease-in", fill: "forwards" })
        .onfinish = () => node.remove();
    }
  };

  // it wells up: a small bead that swells and settles
  const appear = (box: DropBox): void => {
    stop();
    cover([box, ...beadBoxes()]);
    set(local(box));
    resting = box;
    drop.classList.add("is-on");
    shown = true;
    if (reduced.matches) return;
    wobble = drop.animate([
      { scale: "0.3" },
      { scale: "1.08 0.9", offset: 0.5 },
      { scale: "0.97 1.04", offset: 0.75 },
      { scale: "1" },
    ], { duration: ms("--dur-water"), easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" });
  };

  // the leading edge runs ahead and the drop thins; the tail snaps after it, overshoots and
  // draws out its thread, and the drop wobbles round again
  const travel = (box: DropBox): void => {
    const here = live();
    const start = hosted(here);
    stop();
    cover([start, box, ...beadBoxes()]);
    const from = { ...local(start), scale: here.scale };
    const to = local(box);
    set(to);
    resting = box;
    if (reduced.matches) return;
    const stretched = stretchBox(from, to);
    const duration = ms("--dur-water");
    const { axis } = runOf(from, to);
    const squash = (k: string): string => (axis === "x" ? `1 ${k}` : `${k} 1`);
    move = drop.animate([
      { ...frame(from), easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
      { ...frame(stretched), offset: 0.42, easing: "cubic-bezier(0.3, 1.45, 0.55, 1)" },
      frame(to),
    ], { duration });
    wobble = drop.animate([
      { scale: from.scale },
      { scale: squash(thinness(stretched, to).toFixed(3)), offset: 0.42 },
      { scale: squash("1.08"), offset: 0.68 },
      { scale: squash("0.97"), offset: 0.85 },
      { scale: "1" },
    ], { duration, easing: "ease-out" });
    const run = Math.hypot(to.left + to.width / 2 - from.left - from.width / 2, to.top + to.height / 2 - from.top - from.height / 2);
    if (run > SHED_DISTANCE) shed(from, stretched, to);
  };

  return {
    show: (box) => { if (shown) travel(box); else appear(box); },
    // a re-render that leaves the box where it was changes nothing, so a run in flight goes on; a
    // box that moved ends the run there, instead of letting it finish on the old box and jump
    retarget: (box) => {
      if (!shown || (resting && same(resting, box))) return;
      stop();
      if (!inside(box)) cover([box, ...beadBoxes()]);
      set(local(box));
      resting = box;
    },
    place: (box) => {
      popBeads();
      if (!shown) return;
      stop();
      cover([box]);
      set(local(box));
      resting = box;
    },
    vanish: () => {
      popBeads();
      if (!shown) return;
      const here = live();
      stop();
      set(here);
      shown = false;
      resting = null;
      drop.classList.remove("is-on");
      if (reduced.matches) return;
      fade = drop.animate([{ scale: here.scale, opacity: 1 }, { scale: "0.2", opacity: 1 }], { duration: ms("--dur-base") * 1.4, easing: "cubic-bezier(0.5, 0, 0.9, 0.5)" });
    },
    get shown() { return shown; },
    destroy: () => { stop(); for (const node of beads.keys()) node.remove(); beads.clear(); drop.remove(); },
  };
}
