import {
  PROGRESS_UPDATE_LIMIT,
  PROGRESS_UPDATE_MS,
  RUNNER_STALE_MS,
  type Progress,
  type ProgressNote,
  type ProgressUpdate,
  type Run,
} from "../src/run-model";

// The alarm and receipt path share this bounded accumulator. It is stored beside
// the conversation so evictions/retries never lose a window or count it twice.
export type ProgressWindow = {
  generation: number;
  from: number;
  done: string[];
  note: ProgressNote | null;
  operations: ProgressUpdate["operations"];
  failed: number;
};
export function startWindow(run: Run, now: number): ProgressWindow {
  run.nextUpdateAt = now + PROGRESS_UPDATE_MS;
  return {
    generation: run.generation,
    from: now,
    done: [],
    note: null,
    operations: {},
    failed: 0,
  };
}
export function collectProgress(
  window: ProgressWindow,
  previous: Progress | null,
  incoming: Progress | null,
) {
  if (!incoming || incoming.seq <= (previous?.seq ?? 0)) return;
  const seen = new Set(previous?.activity?.map((e) => e.id) ?? []);
  for (const event of incoming.activity ?? []) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.state === "failed") window.failed++;
    if (
      event.state === "finished" &&
      !["turn", "response"].includes(event.kind)
    )
      window.operations[event.kind] = (window.operations[event.kind] ?? 0) + 1;
  }
  const notes = new Set(previous?.notes?.map((n) => n.id) ?? []);
  for (const note of incoming.notes ?? []) {
    if (notes.has(note.id)) continue;
    notes.add(note.id);
    window.note = note;
    // Notes describe only work since the prior note. Keep a bounded, deduplicated
    // list of reports received in this window, not the entire task history.
    window.done = [...new Set([...window.done, ...note.done])].slice(-12);
  }
}
export function closeWindow(run: Run, window: ProgressWindow, now: number) {
  const update: ProgressUpdate = {
    id: `${run.generation}:${window.from}`,
    generation: run.generation,
    from: window.from,
    to: now,
    done: window.done,
    note: window.note,
    operations: window.operations,
    failed: window.failed,
    state: run.state,
    disconnected:
      run.connection === "disconnected" ||
      now - run.heartbeatAt >= RUNNER_STALE_MS,
  };
  run.updates = [...(run.updates ?? []), update].slice(-PROGRESS_UPDATE_LIMIT);
  run.nextUpdateAt = now + PROGRESS_UPDATE_MS;
  // Keep the last plan with its original timestamp. A quiet window must never
  // repeat previous work as newly completed, or silently refresh a stale plan.
  window.from = now;
  window.done = [];
  window.operations = {};
  window.failed = 0;
  return update;
}
