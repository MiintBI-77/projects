import { test } from "node:test";
import assert from "node:assert/strict";
import { applyClose } from "../collector/close";
import { isDone, type Close } from "../src/work-model";
import { agenda, openWork, rows, unclassified } from "../src/work-view";
import type { Snapshot } from "../src/model";
import { issue } from "./work-fixtures";

const request = { issue: 7, requestedAt: 1_000 };

test("Mark done closes only an open work issue this scan read", async () => {
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    return "";
  };
  assert.deepEqual(await applyClose(request, [issue(7)], "acme/work", gh), {
    ...request,
    state: "done",
    message: null,
  });
  assert.deepEqual(calls, [
    [
      "issue",
      "close",
      "7",
      "--repo",
      "acme/work",
      "--reason",
      "completed",
    ],
  ]);
  calls.length = 0;
  // Already closed on GitHub: done without another write.
  assert.equal(
    (await applyClose(request, [issue(7, { open: false })], "acme/work", gh)).state,
    "done",
  );
  // Not in the work list: refused without touching GitHub.
  assert.equal((await applyClose(request, [issue(8)], "acme/work", gh)).state, "failed");
  assert.deepEqual(calls, []);
  await assert.rejects(
    applyClose(request, [issue(7)], "acme/work", async () => {
      throw Error("offline");
    }),
  );
});

test("an issue is done when closed on GitHub, or closed here after the scan; a reopen shows as open", () => {
  const closed: Close = {
    ...request,
    state: "done",
    message: null,
    updatedAt: 20,
  };
  assert.equal(isDone(issue(7, { open: false }), 10), true);
  assert.equal(isDone(issue(7), 10), false);
  assert.equal(isDone(issue(7), 10, closed), true);
  assert.equal(isDone(issue(7), 30, closed), false);
  assert.equal(isDone(issue(7), 10, { ...closed, state: "queued" }), false);
  assert.equal(isDone(issue(7), 10, { ...closed, state: "failed" }), false);
});

test("rows join issues with close requests; initiatives are milestones", () => {
  const now = Date.now();
  const reporting = { title: "Reporting", capability: "Reports for Acme" };
  const work = {
    observedAt: now - 5000,
    issues: [
      issue(7, { initiative: reporting, customers: ["Acme"] }),
      issue(8, { initiative: reporting, open: false }),
      issue(9),
    ],
  };
  const snapshot: Snapshot = {
    version: 1,
    host: "studio",
    collectedAt: work.observedAt,
    projects: [],
    unassignedSessions: [],
    work: {
      issues: work.issues,
      associationsState: "ok",
      associations: [
        {
          app: "Claude",
          sessionId: "s",
          cwd: "/x",
          repo: "org/repo",
          branch: "feature/x",
          issue: 7,
          selection: "confirmed",
          by: "assistant",
          state: "idle",
          updatedAt: now - 1000,
        },
      ],
    },
  };
  const close: Close = {
    ...request,
    state: "done",
    message: null,
    updatedAt: now - 1000,
  };
  const open = rows([snapshot], work, now);
  assert.deepEqual(
    open.map((r) => r.done),
    [false, true, false],
  );
  assert.equal(open[0].sessions.length, 1);
  assert.equal(open[0].recent, true);
  const [pending] = rows([snapshot], work, now, [close]);
  assert.equal(pending.done, true);
  assert.equal(pending.close, close);
  const [reopened] = rows([snapshot], { ...work, observedAt: now }, now, [
    close,
  ]);
  assert.equal(reopened.done, false);
  assert.deepEqual(open.map(agenda), ["review", "history", "review"]);
});

test("the Mark done confirmation names work still linked to the item", () => {
  assert.deepEqual(openWork({ pulls: [], checkouts: [], live: false }), []);
  assert.deepEqual(
    openWork({
      pulls: [{}, {}] as never[],
      checkouts: [{}] as never[],
      live: true,
    }),
    [
      "2 open PRs",
      "1 checkout with uncommitted or unpushed changes",
      "a session working now",
    ],
  );
});

test("only open, recently active sessions wait for classification", () => {
  const now = Date.now();
  const record = (sessionId: string, over = {}) => ({
    app: "Codex" as const,
    sessionId,
    cwd: "/x",
    repo: null,
    branch: null,
    issue: null,
    selection: "unassigned" as const,
    state: "idle" as const,
    updatedAt: now - 1000,
    ...over,
  });
  const snapshot: Snapshot = {
    version: 1,
    host: "laptop",
    collectedAt: now,
    projects: [],
    unassignedSessions: [],
    work: {
      issues: null,
      associationsState: "ok",
      associations: [
        record("waiting"),
        record("ended", { state: "ended" }),
        record("stale", { updatedAt: now - 8 * 86400_000 }),
        record("linked", { issue: 7, selection: "confirmed" }),
        record("untracked", { selection: "untracked", by: "assistant" }),
      ],
    },
  };
  assert.deepEqual(
    unclassified([snapshot], now).map((a) => a.sessionId),
    ["waiting"],
  );
});
