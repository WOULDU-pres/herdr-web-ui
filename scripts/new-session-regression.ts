import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import type { Machine, WorkspaceCreated } from "../shared/protocol.ts";
import { sessionSnapshot, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

/** Real tabs in owned workspaces; the remote PC is a fixture and launches nothing. */
export async function checkNewSession(browser: Browser, origin: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-new-session-"));
  const workspaces: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let releaseTab = () => {};
  try {
    const owned = [];
    for (const name of ["first", "second"]) {
      const cwd = join(root, name);
      mkdirSync(cwd);
      const created = await workspaceCreate({ cwd, label: `tab-qa-${name}` });
      workspaces.push(created.workspace.workspace_id);
      owned.push(created);
    }
    const [first, second] = owned as [typeof owned[number], typeof owned[number]];
    await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", sidebarGrouping: "workspace" })));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?pane=${encodeURIComponent(first.root_pane.pane_id)}`);
    await page.locator(`.pane-item.is-selected .pane-select[title^="${first.root_pane.pane_id} —"]`).waitFor();
    const dialog = page.getByRole("dialog", { name: /^New session/ });
    const target = dialog.getByLabel("Target", { exact: true });
    const open = page.getByRole("button", { name: "New session", exact: true });
    const targetIs = async (value: string) => {
      await page.waitForFunction((value) => document.querySelector<HTMLSelectElement>("#new-session-target")?.value === value, value);
      assert.equal(await target.inputValue(), value);
    };

    // An unselected workspace's + uses that workspace, without changing the current pane.
    await page.getByRole("button", { name: "New tab in tab-qa-second", exact: true }).click();
    await targetIs("tab");
    assert.equal(await dialog.getByLabel("Directory", { exact: true }).inputValue(), second.root_pane.cwd);
    assert.equal(await dialog.locator(".field-hint").filter({ hasText: "Workspace: tab-qa-second" }).count(), 1);
    if (process.env.UI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "new-tab-workspace.png") });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });

    await open.click();
    await targetIs("workspace"); // the global + keeps new workspace as default
    await target.selectOption("tab");
    assert.equal(await dialog.getByLabel("Directory", { exact: true }).inputValue(), first.root_pane.cwd);
    await dialog.getByLabel(/^Name/).fill("sibling tab");
    const before = await sessionSnapshot();
    let requests = 0;
    const gate = new Promise<void>((resolve) => { releaseTab = resolve; });
    await page.route("**/api/tab/create", async (route) => {
      requests += 1;
      assert.equal(route.request().postDataJSON().workspace_id, first.workspace.workspace_id);
      await gate;
      await route.continue();
    });
    const response = page.waitForResponse((response) => response.url().endsWith("/api/tab/create"));
    await dialog.getByRole("button", { name: "Start session", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Starting shell…" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await target.isDisabled(), true);
    releaseTab();
    const created = await (await response).json() as WorkspaceCreated;
    await dialog.waitFor({ state: "hidden" });
    await page.locator(`.pane-item.is-selected .pane-select[title^="${created.pane_id} —"]`).waitFor();
    assert.equal(requests, 1);
    const after = await sessionSnapshot();
    assert.deepEqual(after.workspaces.map((w) => w.workspace_id), before.workspaces.map((w) => w.workspace_id));
    assert.equal(after.panes.find((p) => p.pane_id === created.pane_id)?.workspace_id, first.workspace.workspace_id);
    assert.equal(after.panes.find((p) => p.pane_id === created.pane_id)?.cwd, first.root_pane.cwd);
    assert.equal(await page.locator(".workspace", { has: page.locator(`.pane-select[title^="${created.pane_id} —"]`) }).locator(".pane-item").count(), 2);
    await page.unroute("**/api/tab/create");

    // A failed launch opens the tab that already exists instead of creating another.
    await open.click();
    await targetIs("workspace");
    await target.selectOption("tab");
    await dialog.getByRole("combobox", { name: "Agent", exact: true }).click();
    await page.getByRole("option", { name: /Claude Code/ }).click();
    await page.route("**/api/tab/create", async (route) => {
      requests += 1;
      const response = await route.fetch({ postData: JSON.stringify({ ...route.request().postDataJSON(), agent: null }) });
      await route.fulfill({ response, json: { ...await response.json(), agent_started: false, error: { code: "agent_start_failed", message: "QA agent unavailable" } } });
    });
    const failedResponse = page.waitForResponse((response) => response.url().endsWith("/api/tab/create"));
    await dialog.getByRole("button", { name: "Start session", exact: true }).click();
    const failed = await (await failedResponse).json() as WorkspaceCreated;
    await dialog.getByRole("alert").filter({ hasText: "QA agent unavailable" }).waitFor();
    assert.equal(await target.isDisabled(), true);
    await dialog.getByRole("button", { name: "Open session", exact: true }).click();
    await page.locator(`.pane-item.is-selected .pane-select[title^="${failed.pane_id} —"]`).waitFor();
    assert.equal(requests, 2);

    // Folder grouping merges single-pane workspaces into the pane row, including its +.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('.segmented[aria-label="Sidebar grouping"]').getByRole("button", { name: "By folder", exact: true }).click();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.getByRole("button", { name: "New tab in tab-qa-second", exact: true }).click();
    await targetIs("tab");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open workspace list", exact: true }).click();
    await open.click();
    await target.selectOption("tab");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.UI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "new-tab-mobile.png") });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.deepEqual(errors, []);

    // Remote workspace IDs can match local IDs: only the owning PC's endpoint may be called.
    const remote = { id: "qa-tab-remote", name: "Tab QA remote", kind: "ssh", state: "connected", snapshot: after } as Machine;
    const remotePage = await context.newPage();
    await remotePage.route("**/api/machines", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { machines: [...body.machines, remote] } });
    });
    await remotePage.route("**/api/machines/qa-tab-remote/agents", (route) => route.fulfill({ json: { agents: [] } }));
    let remoteRequest: unknown;
    await remotePage.route("**/api/machines/qa-tab-remote/tab/create", async (route) => {
      remoteRequest = route.request().postDataJSON();
      await route.fulfill({ status: 400, json: { error: { code: "invalid_cwd", message: "QA directory validation" } } });
    });
    await remotePage.goto(`${origin}/?pane=${encodeURIComponent(first.root_pane.pane_id)}`);
    const remoteGroup = remotePage.locator(".machine-group", { has: remotePage.locator(".machine-name", { hasText: remote.name }) });
    await remoteGroup.getByRole("button", { name: "New tab in tab-qa-second", exact: true }).click();
    const remoteDialog = remotePage.getByRole("dialog", { name: "New session · Tab QA remote", exact: true });
    assert.equal(await remoteDialog.getByLabel("Target", { exact: true }).inputValue(), "tab");
    await remoteDialog.getByRole("button", { name: "Start session", exact: true }).click();
    await remoteDialog.getByRole("alert").filter({ hasText: "Directory not found" }).waitFor();
    assert.equal((remoteRequest as { workspace_id: string }).workspace_id, second.workspace.workspace_id);
    console.log("PASS new tabs keep workspace/cwd, pending and failed launches, folder/mobile actions, and remote PC ownership");
  } finally {
    releaseTab();
    await context.close();
    for (const id of workspaces) await workspaceClose(id);
    rmSync(root, { recursive: true, force: true });
  }
}
