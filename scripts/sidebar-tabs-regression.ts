/** The optional sidebar tab list, using only workspaces owned by this check. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";
import type { Machine } from "../shared/machines.ts";
import { herdrRpc, paneRename, tabClose, tabCreate, tabRename, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

async function selected(page: Page, paneId: string): Promise<void> {
  await page.locator(`.pane-select[aria-current="true"][title^="${paneId} —"]`).waitFor();
}

export async function checkSidebarTabs(browser: Browser, origin: string): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-web-ui-sidebar-tabs-")));
  const workspaces: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  try {
    const created = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-sidebar-tabs" });
    const workspaceId = created.workspace.workspace_id;
    workspaces.push(workspaceId);
    const lone = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-sidebar-lone" });
    workspaces.push(lone.workspace.workspace_id);
    const second = await tabCreate({ workspaceId, cwd: root, label: "Review" });
    const otherFolder = join(root, "docs");
    mkdirSync(otherFolder);
    const third = await tabCreate({ workspaceId, cwd: otherFolder, label: "Docs" });
    const split = await herdrRpc<{ pane: { pane_id: string } }>("pane.split", { target_pane_id: created.root_pane.pane_id, direction: "right", focus: false });
    await paneRename(created.root_pane.pane_id, "Main pane");
    await paneRename(split.pane.pane_id, "Split pane");
    await paneRename(second.root_pane.pane_id, "Review changes");
    await paneRename(third.root_pane.pane_id, "Read documentation");
    await herdrRpc("pane.report_agent", { pane_id: second.root_pane.pane_id, source: "manual", agent: "codex", state: "blocked" });
    await context.addInitScript(() => {
      if (!localStorage.getItem("herdr-web-ui:settings")) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", defaultView: "chat" }));
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const evidence = process.env.UI_EVIDENCE_DIR;
    if (evidence) mkdirSync(evidence, { recursive: true });
    const screenshot = async (name: string) => {
      if (evidence) await page.screenshot({ path: join(evidence, `sidebar-tabs-${name}.png`), animations: "disabled" });
    };
    const settings = async (edit: () => Promise<void>) => {
      await page.keyboard.press("Control+Shift+Comma");
      await edit();
      await page.getByRole("button", { name: "Close settings", exact: true }).click();
    };
    const toggle = page.getByRole("switch", { name: "Show all tabs in sidebar", exact: true });
    const tab = (id: string) => page.locator(`.sidebar-tab[data-tab-id="${id}"]`);
    const firstTab = created.root_pane.tab_id;

    await page.goto(`${origin}/?pane=${encodeURIComponent(created.root_pane.pane_id)}`);
    await selected(page, created.root_pane.pane_id);
    assert.equal(await page.locator(".sidebar-tabs").count(), 0, "legacy settings keep one row per workspace");
    await screenshot("off");
    await settings(async () => {
      assert.equal(await toggle.getAttribute("aria-checked"), "false");
      await toggle.click();
      await screenshot("settings");
    });
    await tab(firstTab).waitFor();
    assert.deepEqual(await page.locator(".sidebar-tab-name").allTextContents(), ["Tab 1", "Review", "Docs"]);
    assert.equal(await page.locator(`.workspace:has(.pane-select[title^="${lone.root_pane.pane_id} —"]) .sidebar-tabs`).count(), 0, "a lone tab adds no duplicate row");
    await tab(second.tab.tab_id).locator(".badge", { hasText: "INPUT" }).waitFor();
    assert.equal(await tab(second.tab.tab_id).locator(".badge").textContent(), "INPUT");
    await screenshot("on-dark");

    await tab(second.tab.tab_id).click();
    await selected(page, second.root_pane.pane_id);
    assert.equal(await tab(second.tab.tab_id).getAttribute("aria-current"), "true");
    await tab(firstTab).focus();
    await tab(firstTab).press("Enter");
    await selected(page, created.root_pane.pane_id);
    await page.locator(".tab-strip-item.is-active .tab-strip-panes").click();
    await page.getByRole("menuitem", { name: "Split pane", exact: true }).click();
    await selected(page, split.pane.pane_id);
    await tab(second.tab.tab_id).click();
    await selected(page, second.root_pane.pane_id);
    await tab(firstTab).click();
    await selected(page, split.pane.pane_id);

    await page.reload();
    await tab(firstTab).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr-web-ui:settings")!).showSidebarTabs), true);
    await tabRename(second.tab.tab_id, "Updated review");
    await tab(second.tab.tab_id).locator(".sidebar-tab-name", { hasText: "Updated review" }).waitFor();
    await settings(async () => {
      await page.locator('.segmented[aria-label="Sidebar grouping"]').getByRole("button", { name: "By folder", exact: true }).click();
      await page.locator('.segmented[aria-label="Theme"]').getByRole("button", { name: "Light", exact: true }).click();
    });
    const docs = page.locator(`.directory-group[data-directory="${otherFolder}"]`);
    assert.deepEqual(await docs.locator(".sidebar-tab-name").allTextContents(), ["Docs"]);
    assert.deepEqual(await page.locator(`.directory-group[data-directory="${root}"] .sidebar-tab-name`).allTextContents(), ["Tab 1", "Updated review"]);
    await screenshot("on-light-folders");
    await docs.locator(".sidebar-tab").click();
    await selected(page, third.root_pane.pane_id);
    await settings(async () => { await toggle.click(); });
    assert.equal(await page.locator(".sidebar-tabs").count(), 0);
    await selected(page, third.root_pane.pane_id);
    await page.reload();
    await selected(page, third.root_pane.pane_id);
    assert.equal(await page.locator(".sidebar-tabs").count(), 0, "off survives a reload without changing selection");
    await settings(async () => {
      await toggle.click();
      await page.locator('.segmented[aria-label="Sidebar grouping"]').getByRole("button", { name: "By workspace", exact: true }).click();
    });

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
    try {
      await phone.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", showSidebarTabs: true, defaultView: "chat" })));
      const mobile = await phone.newPage();
      await mobile.goto(`${origin}/?pane=${encodeURIComponent(created.root_pane.pane_id)}`);
      await mobile.locator(".drawer-toggle").click();
      const target = mobile.locator(`.sidebar-tab[data-tab-id="${second.tab.tab_id}"]`);
      await target.waitFor();
      const box = await target.boundingBox();
      assert.ok(box && box.height >= 40, "sidebar tabs keep a touch target");
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (evidence) await mobile.screenshot({ path: join(evidence, "sidebar-tabs-phone.png"), animations: "disabled" });
      await target.tap();
      await mobile.locator('.tab-strip [role="tab"][aria-selected="true"]', { hasText: "Updated review" }).waitFor();
      assert.equal(await mobile.locator("#workspace-drawer.is-open").count(), 0, "a tap switches tabs and closes the drawer");
    } finally { await phone.close(); }

    // Simulate restoration failures in inactive tabs without changing herdr's pane state.
    const restored = await context.newPage();
    restored.setDefaultTimeout(10_000);
    restored.on("pageerror", (error) => errors.push(error.message));
    try {
      await restored.route("**/api/machines/events", (route) => route.abort());
      await restored.route("**/api/machines", async (route) => {
        const response = await route.fetch();
        const body = await response.json() as { machines: Machine[] };
        for (const machine of body.machines) {
          if (machine.id !== "local" || !machine.snapshot) continue;
          for (const pane of machine.snapshot.panes) {
            if (pane.pane_id === second.root_pane.pane_id) pane.restore_error = "Review pane could not be restored";
            if (pane.pane_id === created.root_pane.pane_id) pane.restore_error = "Main pane could not be restored";
          }
          const layout = machine.snapshot.layouts?.find((candidate) => candidate.tab_id === firstTab);
          if (layout) layout.focused_pane_id = split.pane.pane_id;
        }
        await route.fulfill({ response, json: body });
      });
      await restored.goto(`${origin}/?pane=${encodeURIComponent(third.root_pane.pane_id)}`);
      await selected(restored, third.root_pane.pane_id);
      const restoredTab = (id: string) => restored.locator(`.sidebar-tab[data-tab-id="${id}"]`);
      await restoredTab(second.tab.tab_id).locator(".badge-restore-error").waitFor();
      assert.equal(await restoredTab(second.tab.tab_id).locator(".badge").textContent(), "NOT RESTORED", "restoration failure takes precedence over INPUT");
      assert.equal(await restoredTab(second.tab.tab_id).locator(".badge").getAttribute("title"), "Review pane could not be restored");
      assert.equal(await restoredTab(firstTab).locator(".sidebar-tab-pane").textContent(), "Split pane", "the split tab targets its healthy pane");
      assert.equal(await restoredTab(firstTab).locator(".badge").getAttribute("title"), "Main pane could not be restored", "an error in another split pane still marks its tab");
      assert.equal(await restored.locator(".pane-meta .badge-restore-error").count(), 0, "the workspace row can show a healthy pane while inactive tabs have errors");
      assert.equal(await restoredTab(third.tab.tab_id).locator(".badge-restore-error").count(), 0, "healthy tabs keep their status badge");
      if (evidence) await restored.screenshot({ path: join(evidence, "sidebar-tabs-restore-error.png"), animations: "disabled" });
    } finally { await restored.close(); }

    await tabClose(second.tab.tab_id);
    await tab(second.tab.tab_id).waitFor({ state: "detached" });
    await tabClose(third.tab.tab_id);
    await page.locator(".sidebar-tabs").waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    console.log("PASS sidebar tabs: opt-in, order/status, restoration errors, keyboard selection, split-pane memory, reload, grouping, rename/close, themes and touch");
  } finally {
    await context.close();
    try { for (const id of workspaces) await workspaceClose(id); }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
}

if (import.meta.main) {
  assert.notEqual(process.env.HERDR_TEST_LIVE, "1", "Live-session mode is forbidden");
  assert.notEqual(process.env.HERDR_TEST_MODE, "unit", "This check needs isolated herdr");
  const { testSocketPath } = await import("./test-herdr.ts");
  assert.equal(process.env.HERDR_SOCKET, testSocketPath());
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("../server/index.ts");
  const { UsageService } = await import("../server/usage.ts");
  const state = mkdtempSync(join(tmpdir(), "herdr-sidebar-tabs-state-"));
  const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: state, usage: new UsageService(undefined, []) });
  try {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
    try { await checkSidebarTabs(browser, `http://127.0.0.1:${server.port}`); }
    finally { await browser.close(); }
  } finally {
    server.stop();
    rmSync(state, { recursive: true, force: true });
  }
}
