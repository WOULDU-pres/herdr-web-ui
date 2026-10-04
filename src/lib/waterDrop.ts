/**
 * The geometry of the water drop that follows the pointer over what can be picked (Settings →
 * Water drops; components/TabDrop.tsx on the tab row, components/WaterDrop.tsx everywhere else):
 * where it sits over an item, how it stretches on its way to the next one, and the thread of beads
 * its tail draws out. Pure: boxes in pixels in, keyframe values out, and chance comes from the caller.
 */

/** A box in pixels, in whatever space the caller draws the drop in. */
export interface DropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The sides a drop stays within: a missing side does not bound it. */
export interface DropBounds {
  left: number;
  right: number;
  top?: number;
  bottom?: number;
}

/**
 * A CSS time in milliseconds: "520ms", or ".52s" as the production build's minifier writes the
 * same token. 0 for anything else.
 */
export function cssTime(value: string): number {
  const text = value.trim();
  const amount = parseFloat(text);
  if (!Number.isFinite(amount)) return 0;
  return text.endsWith("ms") ? amount : text.endsWith("s") ? amount * 1000 : 0;
}

/** How much bigger than its tab the tab row's drop is, across and down. */
export const DROP_SCALE = 1.25;

/** The least distance between two items that sheds beads: a short hop does not break the tail. */
export const SHED_DISTANCE = 24;

/**
 * The drop over an item: centred on it and `scale` times its size. It moves in to stay within the
 * bounds, keeping its size; a side the bounds leave open lets it spill (the tab row's drop spills
 * onto the header and the pane).
 */
export function dropBox(item: DropBox, bounds: DropBounds, scale: number = DROP_SCALE, margin = 2): DropBox {
  const width = item.width * scale;
  const height = item.height * scale;
  const clamp = (start: number, size: number, low: number | undefined, high: number | undefined): number => {
    let at = start;
    if (high !== undefined) at = Math.min(at, high - margin - size);
    if (low !== undefined) at = Math.max(at, low + margin);
    return at;
  };
  return {
    left: clamp(item.left + (item.width - width) / 2, width, bounds.left, bounds.right),
    top: clamp(item.top + (item.height - height) / 2, height, bounds.top, bounds.bottom),
    width,
    height,
  };
}

export type Axis = "x" | "y";

/** The way a drop runs from one box to the next: along the longer leg, and which way along it. */
export function runOf(from: DropBox, to: DropBox): { axis: Axis; dir: 1 | -1 } {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const axis: Axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
  return { axis, dir: (axis === "x" ? dx : dy) > 0 ? 1 : -1 };
}

/**
 * The drop halfway to the next item: its leading edge has arrived (a little past, as water runs
 * on), its trailing edge has moved only a fifth of the way. The drop is long and thin here.
 */
export function stretchBox(from: DropBox, to: DropBox): DropBox {
  const { axis, dir } = runOf(from, to);
  const reach = Math.min(to.width, to.height) * 0.1;
  if (axis === "x") {
    const left = dir > 0 ? from.left + (to.left - from.left) * 0.18 : to.left - reach;
    const right = dir > 0 ? to.left + to.width + reach : from.left + from.width + (to.left + to.width - from.left - from.width) * 0.18;
    return { left, top: to.top, width: right - left, height: to.height };
  }
  const top = dir > 0 ? from.top + (to.top - from.top) * 0.18 : to.top - reach;
  const bottom = dir > 0 ? to.top + to.height + reach : from.top + from.height + (to.top + to.height - from.top - from.height) * 0.18;
  return { left: to.left, top, width: to.width, height: bottom - top };
}

/**
 * How far across its run a stretched drop thins: the longer it is, the thinner, never below 0.6.
 * A stretched box keeps the target's size across the run, so its longer ratio is the one along it.
 */
export function thinness(stretched: DropBox, to: DropBox): number {
  const ratio = Math.max(stretched.width / to.width, stretched.height / to.height);
  return Math.max(0.6, 1 - (ratio - 1) * 0.16);
}

export interface ThreadBead {
  size: number;
  /** the share of the tail's run it rides: 0 stays where the drop was, 1 stays in the drop */
  share: number;
  /** its top-left corner where the run starts, halfway (where the drop is most stretched) and at the end */
  at: [Point, Point, Point];
  /** a bead near the front runs back into the drop; the rest fall away */
  fate: "merge" | "fall";
  /** where a merging bead runs back into the drop */
  home: Point;
  /** how far a falling bead drops (down the screen, whichever way the drop ran) before the liquid lets go of it */
  fall: number;
  /** its whole life, the run included, in drop durations */
  life: number;
}

/**
 * The thread the tail draws out as the drop runs from `from` (through `stretched`) to `to`:
 * `count` beads, each riding a fixed share of the tail's run, from none to all of it. They start
 * merged in the old tail; while the run is short they overlap and the liquid draws them as one
 * thread, and as it lengthens the thread breaks into pearls. The front pearls (a share of 3/4 or
 * more) run back into the drop; the rest fall away, quickly, shrinking until they are gone. A bead
 * is at most `maxSize` across, so a wide row's drop does not shed beads the size of the row.
 * `random` is a source in [0, 1), Math.random in the app.
 */
export function threadBeads(from: DropBox, stretched: DropBox, to: DropBox, count: number, random: () => number, maxSize = Infinity): ThreadBead[] {
  const { axis, dir } = runOf(from, to);
  const short = Math.min(to.width, to.height);
  // the centre of the tail's round end, along the run
  const tail = (box: DropBox): number => axis === "x"
    ? (dir > 0 ? box.left : box.left + box.width) + dir * short * 0.5
    : (dir > 0 ? box.top : box.top + box.height) + dir * short * 0.5;
  const t0 = tail(from);
  const t1 = tail(stretched);
  const t2 = tail(to);
  // across the run: a horizontal thread runs along the middle, a vertical one wanders across the row
  const middle = axis === "x" ? from.top + from.height / 2 : from.left + from.width / 2;
  const spread = axis === "x" ? 3 : Math.min(from.width * 0.5, 120);
  const point = (along: number, across: number): Point => axis === "x" ? { x: along, y: across } : { x: across, y: along };
  const beads: ThreadBead[] = [];
  for (let i = 0; i < count; i++) {
    const share = Math.pow(i / Math.max(1, count - 1), 1.25);
    // the middle of a thread is its thinnest part
    const size = Math.min(maxSize, short * (0.46 + random() * 0.14)) * (1 - Math.sin(Math.PI * share) * 0.15);
    const across = middle - size / 2 + (random() - 0.5) * spread;
    // a horizontal thread sags a little in the middle
    const bow = axis === "x" ? Math.sin(Math.PI * share) : 0;
    const a0 = t0 - size / 2;
    const merges = share >= 0.75;
    beads.push({
      size,
      share,
      at: [point(a0, across), point(a0 + (t1 - t0) * share, across + bow * 2), point(a0 + (t2 - t0) * share, across + bow * 3)],
      fate: merges ? "merge" : "fall",
      home: point(t2 - size / 2 + dir * short * 0.3, (axis === "x" ? to.top + to.height / 2 : to.left + to.width / 2) - size / 2),
      fall: 16 + random() * 12,
      life: merges ? 1.6 : 1.55 + random() * 0.15,
    });
  }
  return beads;
}
