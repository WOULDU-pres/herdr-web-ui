/**
 * The alert sound: a short chime the open tab plays itself when an alert is due. It is page
 * audio, not a system notification, so it is heard where notifications stay quiet - a macOS
 * Focus, Do Not Disturb - as long as a tab of the app is open.
 *
 * A browser lets a page play audio only after the user interacted with it, so the audio context
 * is made and resumed from a tap or key (`unlockAlertSound`); until then a chime is skipped,
 * never queued to sound late.
 *
 * One chime sounds at a time. Alerts that come together - several panes finishing at once, or
 * the same alert reaching every open tab of the app - would otherwise sound over each other. An
 * alert that comes while a chime sounds is already told by it, except a question after a finish:
 * the question's chime starts where the finish's ends, so a question is never lost.
 */

export type AlertSoundKind = "blocked" | "done";

/** Each chime's notes in Hz: a question rises, a finish falls. */
export const CHIME_NOTES: Readonly<Record<AlertSoundKind, readonly number[]>> = {
  blocked: [660, 880],
  done: [880, 660],
};
const NOTE_GAP_S = 0.16;
const NOTE_LENGTH_S = 0.3;
const PEAK_GAIN = 0.25;
/** The Web Lock the open tabs take turns on, so one of them chimes for an alert they all hear. */
export const CHIME_LOCK = "herdr-web-ui:alert-sound";

let context: AudioContext | null = null;
// this tab's last chime, on its context's clock
let sounding: { audio: AudioContext; kind: AlertSoundKind; until: number } | null = null;
// alerts that came while this tab asked the other tabs for the turn, in order
let asking: AlertSoundKind[] | null = null;
// while this tab holds the turn: when it gives it back, on the wall clock (performance.now)
let holdUntil: number | null = null;

function contextClass(): typeof AudioContext | undefined {
  return globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** From a user gesture: lets this tab's later chimes play. Resolves whether it can play now. */
export async function unlockAlertSound(): Promise<boolean> {
  const Context = contextClass();
  if (!Context) return false;
  // a context the browser closed never resumes: the next gesture makes a new one
  if (!context || context.state === "closed") context = new Context();
  // suspended before the first gesture, or "interrupted" (iOS Safari, after a call or a switch away):
  // both resume from a gesture
  if (context.state !== "running") {
    try {
      await context.resume();
    } catch {
      return false;
    }
  }
  return context.state === "running";
}

/** An alert: chimes, unless a chime of this tab or of another open tab already tells it. */
export function playAlertSound(kind: AlertSoundKind): void {
  const audio = context;
  if (!audio || audio.state !== "running") return;
  if (holdUntil !== null) {
    keepTurn(chime(audio, kind));
    return;
  }
  if (asking !== null) {
    asking.push(kind);
    return;
  }
  // Every open tab hears the same alerts: the tab that takes the turn chimes, the others stay
  // quiet. Web Locks exist only in a secure context (https, localhost), so a tab on a plain-http
  // LAN address keeps only its own chimes apart.
  const locks: LockManager | undefined = globalThis.navigator?.locks;
  if (!locks) {
    chime(audio, kind);
    return;
  }
  asking = [kind];
  locks.request(CHIME_LOCK, { ifAvailable: true }, async (lock) => {
    const wanted = asking ?? [];
    asking = null;
    // null: another tab is chiming these alerts
    if (!lock || audio.state !== "running") return;
    holdUntil = performance.now();
    for (const each of wanted) keepTurn(chime(audio, each));
    // timed on the wall clock: a context the browser suspends stops its own clock
    while (performance.now() < holdUntil) {
      await new Promise((resolve) => setTimeout(resolve, holdUntil! - performance.now()));
    }
    holdUntil = null;
  }).catch(() => {
    // a browser that refuses the lock: this tab chimes on its own
    const wanted = asking ?? [];
    asking = null;
    holdUntil = null;
    for (const each of wanted) chime(audio, each);
  });
}

/** Settings' preview of the chime: played by this tab whatever another tab is chiming, after this tab's own chime. */
export function previewAlertSound(): void {
  const audio = context;
  if (audio?.state === "running") chime(audio, "done", true);
}

/** Holds the turn until this tab's chimes end, `seconds` from now. */
function keepTurn(seconds: number): void {
  holdUntil = Math.max(holdUntil ?? 0, performance.now() + seconds * 1000);
}

/**
 * Plays `kind` unless this tab's last chime still sounds; a preview then starts where it ends.
 * Returns how long from now this tab's chimes sound, in seconds.
 */
function chime(audio: AudioContext, kind: AlertSoundKind, preview = false): number {
  const now = audio.currentTime;
  let start = now;
  const current = sounding !== null && sounding.audio === audio && sounding.until > now ? sounding : null;
  if (current) {
    // already told by the chime that sounds, except a question after a finish
    if (!preview && (kind !== "blocked" || current.kind === "blocked")) return current.until - now;
    start = current.until;
  }
  const notes = CHIME_NOTES[kind];
  notes.forEach((frequency, index) => {
    const at = start + index * NOTE_GAP_S;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    // a ramp from near silence on both ends: a note that starts or stops at full level clicks
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_LENGTH_S);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + NOTE_LENGTH_S);
  });
  sounding = { audio, kind, until: start + (notes.length - 1) * NOTE_GAP_S + NOTE_LENGTH_S };
  return sounding.until - now;
}
