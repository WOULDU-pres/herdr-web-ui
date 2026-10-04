import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { CHIME_LOCK, CHIME_NOTES, playAlertSound, previewAlertSound, unlockAlertSound } from "./alertSound.ts";

/** A stand-in AudioContext that starts suspended, as a page's does before any tap or key. */
const started: number[] = [];
const startedAt: number[] = [];
let resumes = 0;
const made: FakeAudioContext[] = [];
class FakeAudioContext {
  // "interrupted" is iOS Safari's state after a phone call or a switch away: not in the DOM typings
  state: "suspended" | "running" | "closed" | "interrupted" = "suspended";
  constructor() { made.push(this); }
  // set by the tests: a real context's clock runs on its own
  currentTime = 0;
  destination = {};
  async resume() { resumes += 1; this.state = "running"; }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (node: unknown) => node };
  }
  createOscillator() {
    const oscillator = {
      type: "",
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start(at: number) { started.push(oscillator.frequency.value); startedAt.push(at); },
      stop() {},
    };
    return oscillator;
  }
}

/** How long a chime sounds: its last note starts 0.16 s after the one before and lasts 0.3 s. */
const LENGTH = 0.16 + 0.3;

const saved = (globalThis as { AudioContext?: unknown }).AudioContext;
Object.assign(globalThis, { AudioContext: FakeAudioContext });
afterAll(() => { Object.assign(globalThis, { AudioContext: saved }); });

/** Lets the chime of the tab's last test end, and forgets what it played. */
function quiet(): FakeAudioContext {
  const audio = made.at(-1)!;
  audio.currentTime += 10;
  started.length = 0;
  startedAt.length = 0;
  return audio;
}

describe("alert sound", () => {
  it("skips a chime before the page was allowed to play audio, instead of queueing it", () => {
    playAlertSound("blocked");
    expect(started).toEqual([]);
  });

  it("plays each kind's notes once a gesture unlocked the tab", async () => {
    expect(await unlockAlertSound()).toBe(true);
    expect(resumes).toBe(1);
    playAlertSound("blocked");
    quiet();
    playAlertSound("done");
    expect(started).toEqual([...CHIME_NOTES.done]);
  });

  it("tells a question, which rises, from a finish, which falls", () => {
    expect(CHIME_NOTES.blocked[0]!).toBeLessThan(CHIME_NOTES.blocked[1]!);
    expect(CHIME_NOTES.done[0]!).toBeGreaterThan(CHIME_NOTES.done[1]!);
  });

  it("reuses the running context on later gestures", async () => {
    expect(await unlockAlertSound()).toBe(true);
    expect(resumes).toBe(1);
    expect(made.length).toBe(1);
  });

  it("makes a new context on the next gesture once the browser closed the old one", async () => {
    quiet().state = "closed";
    playAlertSound("done");
    expect(started).toEqual([]);
    expect(await unlockAlertSound()).toBe(true);
    expect(made.length).toBe(2);
    // the new context's clock starts again at 0: the old context's chime is not this one's
    playAlertSound("done");
    expect(started).toEqual([...CHIME_NOTES.done]);
  });

  it("resumes a context iOS Safari interrupted, on the next gesture", async () => {
    quiet().state = "interrupted";
    playAlertSound("blocked");
    expect(started).toEqual([]);
    const before = resumes;
    expect(await unlockAlertSound()).toBe(true);
    expect(resumes).toBe(before + 1);
    expect(made.length).toBe(2);
    playAlertSound("blocked");
    expect(started).toEqual([...CHIME_NOTES.blocked]);
  });
});

describe("one chime at a time", () => {
  beforeEach(() => { quiet(); });

  it("chimes once for panes that finish together", () => {
    playAlertSound("done");
    playAlertSound("done");
    playAlertSound("done");
    expect(started).toEqual([...CHIME_NOTES.done]);
  });

  it("starts a question's chime where the finish's ends, and tells the rest by those two", () => {
    const now = made.at(-1)!.currentTime;
    playAlertSound("done");
    playAlertSound("blocked");
    playAlertSound("done");
    playAlertSound("blocked");
    expect(started).toEqual([...CHIME_NOTES.done, ...CHIME_NOTES.blocked]);
    expect(startedAt[2]).toBeCloseTo(now + LENGTH);
  });

  it("tells a finish that comes during a question by the question's chime", () => {
    playAlertSound("blocked");
    playAlertSound("done");
    expect(started).toEqual([...CHIME_NOTES.blocked]);
  });

  it("chimes again once the last chime ended", () => {
    const audio = made.at(-1)!;
    playAlertSound("done");
    audio.currentTime += LENGTH;
    playAlertSound("done");
    expect(started).toEqual([...CHIME_NOTES.done, ...CHIME_NOTES.done]);
  });

  it("previews the chime in Settings, after the chime that sounds", () => {
    const now = made.at(-1)!.currentTime;
    previewAlertSound();
    playAlertSound("blocked");
    expect(started).toEqual([...CHIME_NOTES.done, ...CHIME_NOTES.blocked]);
    quiet();
    playAlertSound("blocked");
    previewAlertSound();
    expect(started).toEqual([...CHIME_NOTES.blocked, ...CHIME_NOTES.done]);
    expect(startedAt[2]).toBeCloseTo(now + 10 + LENGTH);
  });
});

describe("open tabs take turns", () => {
  /** navigator.locks with one lock: `other` stands for another tab of the app holding it. */
  const lock = { held: false, other: false, refuse: false };
  const navigator = globalThis.navigator as unknown as Record<string, unknown>;
  beforeAll(() => Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      async request(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<unknown>) {
        expect(name).toBe(CHIME_LOCK);
        expect(options.ifAvailable).toBe(true);
        await Promise.resolve();
        if (lock.refuse) throw new Error("SecurityError");
        if (lock.held || lock.other) return callback(null);
        lock.held = true;
        try { return await callback({ name }); } finally { lock.held = false; }
      },
    },
  }));
  afterAll(() => { delete navigator["locks"]; });
  beforeEach(() => { quiet(); lock.other = false; lock.refuse = false; });

  /** Until the turn is given back, polling up to a deadline. */
  async function released(): Promise<void> {
    const deadline = performance.now() + 2000;
    while (lock.held && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lock.held).toBe(false);
  }

  it("chimes in the tab that takes the turn, as a tab alone would", async () => {
    playAlertSound("done");
    playAlertSound("blocked");
    playAlertSound("done");
    expect(started).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(lock.held).toBe(true);
    expect(started).toEqual([...CHIME_NOTES.done, ...CHIME_NOTES.blocked]);
    // alerts while it holds the turn are told the same way
    playAlertSound("done");
    expect(started).toEqual([...CHIME_NOTES.done, ...CHIME_NOTES.blocked]);
    await released();
  });

  it("stays quiet while another tab chimes", async () => {
    lock.other = true;
    playAlertSound("blocked");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([]);
  });

  it("gives the turn back after its chime, also when the context's clock stands still", async () => {
    const before = performance.now();
    playAlertSound("blocked");
    await Promise.resolve();
    await Promise.resolve();
    expect(lock.held).toBe(true);
    await released();
    expect(performance.now() - before).toBeGreaterThanOrEqual(LENGTH * 1000 - 5);
  });

  it("previews the chime in Settings while another tab chimes", () => {
    lock.other = true;
    previewAlertSound();
    expect(started).toEqual([...CHIME_NOTES.done]);
  });

  it("chimes alone when the browser refuses the lock", async () => {
    lock.refuse = true;
    playAlertSound("done");
    playAlertSound("blocked");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([...CHIME_NOTES.done, ...CHIME_NOTES.blocked]);
  });
});
