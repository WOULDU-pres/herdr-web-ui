/**
 * The geometry of the glass drop under the pointer on the tab row (components/TabDrop.tsx): where
 * it sits over a tab, how it stretches on its way to the next one, and the beads its tail sheds.
 * Pure: boxes are viewport pixels in, keyframe values out, and chance comes from the caller.
 */

/** A box in viewport pixels. */
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

/** How much bigger than its tab the drop is, across and down. */
export const DROP_SCALE = 1.25;

/** The least distance between two tabs that sheds beads: a short hop does not break the tail. */
export const SHED_DISTANCE = 24;

/**
 * The drop over a tab: centred on it and `scale` times its size, so it spills past the row onto
 * the header and the pane. It moves in sideways to stay within the row's ends, keeping its size.
 */
export function dropBox(tab: DropBox, row: { left: number; right: number }, scale: number = DROP_SCALE, margin = 2): DropBox {
  const width = tab.width * scale;
  const height = tab.height * scale;
  const centred = tab.left + (tab.width - width) / 2;
  const left = Math.max(row.left + margin, Math.min(centred, row.right - margin - width));
  return { left, top: tab.top + (tab.height - height) / 2, width, height };
}

/**
 * The drop halfway to the next tab: its leading edge has arrived (a little past, as water runs
 * on), its trailing edge has moved only a fifth of the way. The drop is long and thin here.
 */
export function stretchBox(from: DropBox, to: DropBox): DropBox {
  const reach = to.height * 0.1;
  const fromRight = from.left + from.width;
  const toRight = to.left + to.width;
  const rightward = to.left > from.left;
  const left = rightward ? from.left + (to.left - from.left) * 0.18 : to.left - reach;
  const right = rightward ? toRight + reach : fromRight + (toRight - fromRight) * 0.18;
  return { left, top: to.top, width: right - left, height: to.height };
}

/** How far down a stretched drop thins: the longer it is, the thinner, never below 0.6. */
export function thinness(stretched: DropBox, to: DropBox): number {
  return Math.max(0.6, 1 - (stretched.width / to.width - 1) * 0.16);
}

export interface ThreadBead {
  size: number;
  /** the share of the tail's run it rides: 0 stays where the drop was, 1 stays in the drop */
  share: number;
  /** its top edge, before the thread bows */
  y: number;
  /** its left edge where the run starts, halfway (where the drop is most stretched) and at the end */
  x: [number, number, number];
  /** a bead near the front runs back into the drop; the rest fall away */
  fate: "merge" | "fall";
  /** where a merging bead runs back into the drop */
  home: Point;
  /** how far a falling bead drops before the liquid lets go of it */
  fall: number;
  /** its whole life, the run included, in drop durations */
  life: number;
}

/**
 * The thread the tail draws out as the drop runs from `from` (through `stretched`) to `to`:
 * `count` beads, each riding a fixed share of the tail's run, from none to all of it. They start
 * merged in the old tail; while the run is short they overlap and the liquid draws them as one
 * thread, and as it lengthens the thread breaks into pearls. The front pearls (a share of 3/4 or
 * more) run back into the drop; the rest fall away, quickly, shrinking until they are gone.
 * `random` is a source in [0, 1), Math.random in the app.
 */
export function threadBeads(from: DropBox, stretched: DropBox, to: DropBox, count: number, random: () => number): ThreadBead[] {
  const rightward = to.left > from.left;
  const dir = rightward ? 1 : -1;
  const h = to.height;
  // the centre of the tail's round end
  const tail = (box: DropBox): number => (rightward ? box.left : box.left + box.width) + dir * h * 0.5;
  const t0 = tail(from);
  const t1 = tail(stretched);
  const t2 = tail(to);
  const middle = from.top + from.height / 2;
  const beads: ThreadBead[] = [];
  for (let i = 0; i < count; i++) {
    const share = Math.pow(i / Math.max(1, count - 1), 1.25);
    // the middle of a thread is its thinnest part
    const size = h * (0.46 + random() * 0.14) * (1 - Math.sin(Math.PI * share) * 0.15);
    const y = middle - size / 2 + (random() - 0.5) * 3;
    const x0 = t0 - size / 2;
    const merges = share >= 0.75;
    beads.push({
      size,
      share,
      y,
      x: [x0, x0 + (t1 - t0) * share, x0 + (t2 - t0) * share],
      fate: merges ? "merge" : "fall",
      home: { x: t2 - size / 2 + dir * h * 0.3, y: to.top + h / 2 - size / 2 },
      fall: 16 + random() * 12,
      life: merges ? 1.6 : 1.55 + random() * 0.15,
    });
  }
  return beads;
}
