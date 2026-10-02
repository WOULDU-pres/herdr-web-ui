import "/home/hwjoo/01-projects/2026/hwjoo-tools/herdr-web-ui-chat-new/scripts/test-herdr.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { paneRead, paneSendKeys, paneSendText, workspaceClose, workspaceCreate } from "/home/hwjoo/01-projects/2026/hwjoo-tools/herdr-web-ui-chat-new/server/herdr/client.ts";
import { createServer } from "/home/hwjoo/01-projects/2026/hwjoo-tools/herdr-web-ui-chat-new/server/index.ts";
import { UsageService } from "/home/hwjoo/01-projects/2026/hwjoo-tools/herdr-web-ui-chat-new/server/usage.ts";

const cwd = "/tmp/omo-new-probe";
const evidence = process.env.EVIDENCE_DIR!;
const created = await workspaceCreate({ cwd, label: "omo-new-probe" });
const pane = created.root_pane.pane_id;
const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: mkdtempSync(join(tmpdir(), "omo-probe-state-")), usage: new UsageService(undefined, []) });
const origin = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
await context.addInitScript(() => { if (!localStorage.getItem("herdr-web-ui:settings")) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", defaultView: "chat" })); });
const page = await context.newPage();
const screen = async () => (await paneRead({ paneId: pane, source: "visible", stripAnsi: true })).text;
const api = async () => {
  const body = await (await fetch(`${origin}/api/pane/conversation?pane_id=${encodeURIComponent(pane)}`)).json() as { source: string; turns: { role: string; parts?: { text?: string }[] }[] };
  return `${body.source} turns=${body.turns.length} text=${JSON.stringify(body.turns.map((t) => (t.parts ?? []).map((p) => p.text ?? "").join("")).join(" / ")).slice(0, 160)}`;
};
const until = async (check: () => Promise<boolean>, ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await Bun.sleep(500); } return false; };
const enter = () => paneSendKeys(pane, ["Enter"]);
const chatText = async () => (await page.locator("main").first().innerText().catch(async () => await page.locator("body").innerText())).replace(/\s+/g, " ").slice(0, 600);
const shows = (text: string) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 20_000 }).then(() => true, () => false);
try {
  await paneSendText(pane, "omo");
  await enter();
  const holders = join(process.env.HOME!, ".omo", "agent", "sessions", `-${cwd.replaceAll("/", "-")}--`, "session-holders");
  await until(async () => { try { return (await import("node:fs")).readdirSync(holders).length > 0; } catch { return false; } }, 40_000);
  await Bun.sleep(3000);
  await page.goto(`${origin}/?pane=${encodeURIComponent(pane)}`);
  await page.locator(".conn-live").waitFor();
  await paneSendText(pane, "Reply with exactly: probe-ok-1");
  await enter();
  await until(async () => (await api()).includes("probe-ok-1"), 120_000);
  const shown = await shows("probe-ok-1");
  console.log(`== after first answer (page shows it: ${shown})\napi: ${await api()}\nchat: ${await chatText()}\n`);
  await page.screenshot({ path: join(evidence, "1-before-new.png") });
  await paneSendText(pane, "/new");
  await enter();
  const followed = await until(async () => !(await api()).includes("probe-ok-1"), 20_000);
  await page.waitForFunction(() => !document.body.innerText.includes("probe-ok-1"), undefined, { timeout: 20_000 }).catch(() => {});
  console.log(`== after /new, nothing typed (api followed: ${followed})\napi: ${await api()}\npage still shows probe-ok-1: ${await page.evaluate(() => document.body.innerText.includes("probe-ok-1"))}\nchat: ${await chatText()}\n`);
  await page.screenshot({ path: join(evidence, "2-after-new.png") });
} finally {
  await context.close();
  await browser.close();
  server.stop(true);
  await paneSendKeys(pane, ["C-c"]).catch(() => {});
  await Bun.sleep(500);
  await paneSendKeys(pane, ["C-c"]).catch(() => {});
  await Bun.sleep(1500);
  await workspaceClose(created.workspace.workspace_id).catch(() => {});
}
process.exit(0);
