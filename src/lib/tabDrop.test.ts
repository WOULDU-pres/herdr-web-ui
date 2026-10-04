import { describe, expect, it } from "bun:test";

import { cssTime, dropBox, stretchBox, thinness, threadBeads, type DropBox } from "./tabDrop.ts";

const row = { left: 0, right: 600 };
const tab = (left: number, width = 80): DropBox => ({ left, top: 52, width, height: 34 });

/** a repeatable stand-in for Math.random */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("tab drop", () => {
  it("reads its duration token however the build writes it", () => {
    expect(cssTime("520ms")).toBe(520);
    // the production build's minifier turns 520ms into .52s
    expect(cssTime(" .52s")).toBe(520);
    expect(cssTime("")).toBe(0);
    expect(cssTime("fast")).toBe(0);
  });

  it("sits centred over its tab, 1.25 times its size, spilling past the row above and below", () => {
    const box = dropBox(tab(100), row);
    expect(box.width).toBe(100);
    expect(box.height).toBe(42.5);
    expect(box.left).toBe(90);
    expect(box.top).toBe(47.75);
    expect(box.top + box.height).toBe(90.25);
  });

  it("moves in from the row's ends instead of shrinking", () => {
    expect(dropBox(tab(4), row)).toMatchObject({ left: 2, width: 100 });
    expect(dropBox(tab(520), row)).toMatchObject({ left: 498, width: 100 });
  });

  it("stretches ahead on its way: the leading edge arrives first, the tail has barely moved", () => {
    const from = dropBox(tab(100), row);
    const to = dropBox(tab(300), row);
    const right = stretchBox(from, to);
    expect(right.left + right.width).toBeGreaterThan(to.left + to.width);
    expect(right.left).toBeCloseTo(from.left + (to.left - from.left) * 0.18);
    const left = stretchBox(to, from);
    expect(left.left).toBeLessThan(from.left);
    expect(left.left + left.width).toBeCloseTo(to.left + to.width + (from.left + from.width - to.left - to.width) * 0.18);
    expect(thinness(right, to)).toBeLessThan(1);
    expect(thinness({ ...right, width: right.width * 10 }, to)).toBe(0.6);
  });

  it("draws the tail out into a thread: each bead rides its share of the tail's run", () => {
    const from = dropBox(tab(100), row);
    const to = dropBox(tab(300), row);
    const stretched = stretchBox(from, to);
    const beads = threadBeads(from, stretched, to, 5, seeded(7));
    expect(beads).toHaveLength(5);
    expect(beads[0]?.share).toBe(0);
    expect(beads[4]?.share).toBe(1);
    const run = (to.left - from.left);
    for (const bead of beads) {
      // all start merged in the old tail, then move in proportion to it
      expect(bead.x[0] + bead.size / 2).toBeCloseTo(from.left + to.height * 0.5);
      expect(bead.x[1] - bead.x[0]).toBeCloseTo((stretched.left - from.left) * bead.share);
      expect(bead.x[2] - bead.x[0]).toBeCloseTo(run * bead.share);
      expect(bead.size).toBeGreaterThanOrEqual(to.height * 0.46 * 0.85);
      expect(bead.size).toBeLessThan(to.height * 0.6);
    }
    // the middle of the thread is thinner than its ends, other things equal
    const even = threadBeads(from, stretched, to, 5, () => 0.5);
    expect(even[2]!.size).toBeLessThan(even[0]!.size);
  });

  it("sends the front of the thread back into the drop and lets the rest fall away quickly", () => {
    const from = dropBox(tab(100), row);
    const to = dropBox(tab(300), row);
    const beads = threadBeads(from, stretchBox(from, to), to, 5, seeded(3));
    // shares 0, 0.18, 0.42, 0.7, 1: only the front one is past 3/4
    expect(beads.map((bead) => bead.fate)).toEqual(["fall", "fall", "fall", "fall", "merge"]);
    for (const bead of beads) {
      if (bead.fate === "merge") {
        expect(bead.home.x).toBeGreaterThan(to.left);
        expect(bead.life).toBe(1.6);
      } else {
        expect(bead.fall).toBeGreaterThanOrEqual(16);
        expect(bead.life).toBeGreaterThanOrEqual(1.55);
        expect(bead.life).toBeLessThan(1.7);
      }
    }
  });

  it("mirrors the thread when the drop runs left", () => {
    const from = dropBox(tab(300), row);
    const to = dropBox(tab(100), row);
    const beads = threadBeads(from, stretchBox(from, to), to, 4, seeded(5));
    for (const bead of beads) {
      expect(bead.x[0] + bead.size / 2).toBeCloseTo(from.left + from.width - to.height * 0.5);
      expect(bead.x[2]).toBeLessThanOrEqual(bead.x[0]);
    }
    expect(beads.at(-1)!.home.x + beads.at(-1)!.size / 2).toBeLessThan(to.left + to.width);
  });
});
