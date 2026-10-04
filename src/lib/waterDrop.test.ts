import { describe, expect, it } from "bun:test";

import { cssTime, dropBox, runOf, stretchBox, thinness, threadBeads, type DropBox } from "./waterDrop.ts";

const row = { left: 0, right: 600 };
const tab = (left: number, width = 80): DropBox => ({ left, top: 52, width, height: 34 });
// a sidebar row: wide and short, stacked down a list
const listRow = (top: number): DropBox => ({ left: 12, top, width: 276, height: 56 });
const list = { left: 0, right: 300, top: 0, bottom: 600 };

/** a repeatable stand-in for Math.random */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("water drop", () => {
  it("reads its duration token however the build writes it", () => {
    expect(cssTime("520ms")).toBe(520);
    // the production build's minifier turns 520ms into .52s
    expect(cssTime(" .52s")).toBe(520);
    expect(cssTime("")).toBe(0);
    expect(cssTime("fast")).toBe(0);
  });

  it("sits centred over its tab, 1.25 times its size, spilling past the row above and below", () => {
    const box = dropBox(tab(100), row);
    expect(box).toEqual({ left: 90, top: 47.75, width: 100, height: 42.5 });
  });

  it("moves in from the bounds instead of shrinking, on every side the bounds name", () => {
    expect(dropBox(tab(4), row)).toMatchObject({ left: 2, width: 100 });
    expect(dropBox(tab(520), row)).toMatchObject({ left: 498, width: 100 });
    // a list bounds it down the page too: the last row's drop stays inside the list
    expect(dropBox(listRow(560), list, 1.1)).toMatchObject({ top: 600 - 2 - 56 * 1.1 });
    expect(dropBox(listRow(0), list, 1.1)).toMatchObject({ top: 2 });
  });

  it("runs along the longer leg", () => {
    expect(runOf(tab(100), tab(300))).toEqual({ axis: "x", dir: 1 });
    expect(runOf(tab(300), tab(100))).toEqual({ axis: "x", dir: -1 });
    expect(runOf(listRow(0), listRow(112))).toEqual({ axis: "y", dir: 1 });
    expect(runOf(listRow(112), listRow(0))).toEqual({ axis: "y", dir: -1 });
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

  it("stretches down a list the same way, keeping the row's width", () => {
    const from = listRow(0);
    const to = listRow(168);
    const down = stretchBox(from, to);
    expect(down.width).toBe(to.width);
    expect(down.top).toBeCloseTo(from.top + (to.top - from.top) * 0.18);
    expect(down.top + down.height).toBeGreaterThan(to.top + to.height);
    const up = stretchBox(to, from);
    expect(up.top).toBeLessThan(from.top);
    expect(thinness(down, to)).toBeLessThan(1);
  });

  it("draws the tail out into a thread: each bead rides its share of the tail's run", () => {
    const from = dropBox(tab(100), row);
    const to = dropBox(tab(300), row);
    const stretched = stretchBox(from, to);
    const beads = threadBeads(from, stretched, to, 5, seeded(7));
    expect(beads).toHaveLength(5);
    expect(beads[0]?.share).toBe(0);
    expect(beads[4]?.share).toBe(1);
    for (const bead of beads) {
      const [start, half, end] = bead.at;
      // all start merged in the old tail, then move in proportion to it
      expect(start.x + bead.size / 2).toBeCloseTo(from.left + to.height * 0.5);
      expect(half.x - start.x).toBeCloseTo((stretched.left - from.left) * bead.share);
      expect(end.x - start.x).toBeCloseTo((to.left - from.left) * bead.share);
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
      expect(bead.at[0].x + bead.size / 2).toBeCloseTo(from.left + from.width - to.height * 0.5);
      expect(bead.at[2].x).toBeLessThanOrEqual(bead.at[0].x);
    }
    expect(beads.at(-1)!.home.x + beads.at(-1)!.size / 2).toBeLessThan(to.left + to.width);
  });

  it("threads down a list along y, with beads no bigger than asked, wandering across the row", () => {
    const from = listRow(0);
    const to = listRow(168);
    const beads = threadBeads(from, stretchBox(from, to), to, 5, seeded(9), 20);
    for (const bead of beads) {
      expect(bead.size).toBeLessThanOrEqual(20);
      expect(bead.at[0].y + bead.size / 2).toBeCloseTo(from.top + 56 * 0.5);
      expect(bead.at[2].y - bead.at[0].y).toBeCloseTo((to.top - from.top) * bead.share);
      // across: within the row, and no sag sideways
      expect(bead.at[0].x).toBeGreaterThan(from.left);
      expect(bead.at[0].x + bead.size).toBeLessThan(from.left + from.width);
      expect(bead.at[2].x).toBe(bead.at[0].x);
    }
  });
});
