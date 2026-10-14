import { z } from "zod";
import { machineIdSchema, projectSchema, sessionSchema } from "./model";

// Viewer choices are separate from snapshots: a collector refresh must not
// restore an archived item or change what was observed on a machine.
export const archiveTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("project"), projectId: projectSchema.shape.id })
    .strict(),
  z
    .object({
      kind: z.literal("session"),
      host: machineIdSchema,
      app: sessionSchema.shape.app,
      sessionId: sessionSchema.shape.id,
    })
    .strict(),
]);
export const archiveInputSchema = z
  .object({
    target: archiveTargetSchema,
    archived: z.boolean(),
  })
  .strict();
export type ArchiveTarget = z.infer<typeof archiveTargetSchema>;
export type ArchiveEntry = {
  target: ArchiveTarget;
  title: string;
  projectId: string | null;
  archivedAt: number;
};
export function archiveKey(target: ArchiveTarget) {
  return JSON.stringify(
    target.kind === "project"
      ? [target.kind, target.projectId]
      : [target.kind, target.host, target.app, target.sessionId],
  );
}
export const isArchived = (entries: ArchiveEntry[], target: ArchiveTarget) =>
  entries.some((entry) => archiveKey(entry.target) === archiveKey(target));
export const sessionArchived = (
  entries: ArchiveEntry[],
  host: string,
  app: string,
  id: string,
) =>
  entries.some(
    ({ target }) =>
      target.kind === "session" &&
      target.host === host &&
      target.app === app &&
      target.sessionId === id,
  );
