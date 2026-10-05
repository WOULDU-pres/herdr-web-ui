/** Real browser cleanup of beads when the reduced-motion preference changes mid-flight. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { DropMotion } from "../src/components/waterDropMotion.ts";
import type { DropBox } from "../src/lib/waterDrop.ts";

declare global {
  interface Window {
    waterQa: { motion: DropMotion; box: DropBox; cleanupAnimations: number };
  }
}

const root = mkdtempSync(join(tmpdir(), "herdr-water-motion-"));
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const build = await Bun.build({ entrypoints: ["src/components/waterDropMotion.ts"], outdir: root, target: "browser" });
  assert.ok(build.success, String(build.logs));
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response('<html><head><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/WaterDrop.css"></head><body><div class="water-liquid"></div></body></html>', { headers: { "Content-Type": "text/html" } });
    if (path === "/styles.css") return new Response(Bun.file("src/styles.css"));
    if (path === "/WaterDrop.css") return new Response(Bun.file("src/components/WaterDrop.css"));
    if (path === "/waterDropMotion.js") return new Response(Bun.file(join(root, "waterDropMotion.js")));
    return new Response(null, { status: 404 });
  } });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const action of ["place", "vanish"] as const) {
    for (const reducedMotion of ["reduce", "no-preference"] as const) {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`http://127.0.0.1:${server.port}/`);
      const count = await page.evaluate(async () => {
        const { createDropMotion } = await import("/waterDropMotion.js");
        const liquid = document.querySelector<HTMLElement>(".water-liquid")!;
        const motion = createDropMotion(liquid);
        const box = { left: 250, top: 20, width: 100, height: 32 };
        window.waterQa = { motion, box, cleanupAnimations: 0 };
        motion.show({ ...box, left: 20 });
        motion.show(box);
        // Hold the real animations so the media preference can change while beads still exist.
        for (const animation of liquid.getAnimations({ subtree: true })) animation.pause();
        const beads = [...liquid.querySelectorAll<HTMLElement>(".water-bead")];
        for (const bead of beads) {
          const animate = bead.animate.bind(bead);
          bead.animate = (...args) => { window.waterQa.cleanupAnimations++; return animate(...args); };
        }
        return beads.length;
      });
      assert.ok(count > 0, "travel creates live beads before the preference changes");
      await page.emulateMedia({ reducedMotion });
      await page.waitForFunction((reduced) => matchMedia("(prefers-reduced-motion: reduce)").matches === reduced, reducedMotion === "reduce");
      const cleaned = await page.evaluate((action) => {
        const { motion, box } = window.waterQa;
        if (action === "place") motion.place(box);
        else motion.vanish();
        return { count: document.querySelectorAll(".water-bead").length, animations: window.waterQa.cleanupAnimations, shown: motion.shown };
      }, action);
      assert.equal(cleaned.shown, action === "place", `${action} keeps the expected drop visibility`);
      if (reducedMotion === "reduce") {
        assert.equal(cleaned.animations, 0, `${action} starts no bead cleanup animation under reduced motion`);
        assert.equal(cleaned.count, 0, `${action} removes existing beads synchronously under reduced motion`);
      } else {
        assert.equal(cleaned.animations, count, `${action} keeps animated bead cleanup for normal motion`);
        await page.waitForFunction(() => document.querySelectorAll(".water-bead").length === 0);
      }
      await page.evaluate(() => window.waterQa.motion.destroy());
      assert.equal(await page.locator(".water-drop, .water-bead").count(), 0);
      console.log(`PASS water drops: ${action} bead cleanup with ${reducedMotion}`);
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
}
