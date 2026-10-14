import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ago, hostName, type PortfolioView, type Snapshot } from "./model";
import { api } from "./overview-query";
import {
  archiveKey,
  type ArchiveEntry,
  type ArchiveTarget,
} from "./archive-model";
import { projectSearch } from "./navigation";
import { ProjectConversations } from "./run-view";

export function ArchiveButton({
  target,
  archived,
  name,
}: {
  target: ArchiveTarget;
  archived: boolean;
  name: string;
}) {
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: () =>
      api<{ archives: ArchiveEntry[] }>("/api/archive", {
        target,
        archived: !archived,
      }),
    onSuccess: async ({ archives }) => {
      client.setQueryData<PortfolioView>(["overview"], (old) =>
        old ? { ...old, archives } : old,
      );
      await client.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  return (
    <div className="archive-control">
      <button
        className="archive-button"
        aria-label={`${archived ? "Restore" : "Archive"} ${name}`}
        disabled={change.isPending}
        onClick={() => change.mutate()}
      >
        {change.isPending ? "Saving…" : archived ? "Restore" : "Archive"}
      </button>
      {change.error && (
        <span role="alert" className="error">
          {change.error.message === "SIGN_IN"
            ? "Sign in again to save this change."
            : change.error.message}
        </span>
      )}
    </div>
  );
}
export function ArchiveView({
  archives,
  snapshots,
  projectId,
}: {
  archives: ArchiveEntry[];
  snapshots: Snapshot[];
  projectId?: string;
}) {
  const entries = archives.filter(
    (a) => !projectId || a.projectId === projectId,
  );
  const projects = entries.filter((a) => a.target.kind === "project");
  const sessions = entries.filter((a) => a.target.kind === "session");
  return (
    <section className="archive-page" aria-label="Archived items">
      <p className="subtle">
        Kept out of the main lists, with history intact. Restore any time.
      </p>
      {projectId && (
        <p>
          <Link to="/" search={projectSearch(projectId)}>
            ← Back to project
          </Link>{" "}
          ·{" "}
          <Link to="/" search={{ view: "archive" }}>
            All archived items
          </Link>
        </p>
      )}
      <ProjectConversations
        snapshots={snapshots}
        archives={archives}
        projectId={projectId}
        archived
      />
      <h2>
        Archived projects <span className="count">{projects.length}</span>
      </h2>
      {!projects.length && <p className="subtle">No archived projects.</p>}
      {projects.map((entry) => (
        <article className="archive-item" key={archiveKey(entry.target)}>
          <div>
            <Link to="/" search={projectSearch(entry.projectId!)}>
              {entry.title}
            </Link>
            <p className="subtle">{entry.projectId}</p>
          </div>
          <ArchiveButton target={entry.target} archived name={entry.title} />
        </article>
      ))}
      <h2>
        Archived native sessions{" "}
        <span className="count">{sessions.length}</span>
      </h2>
      {!sessions.length && (
        <p className="subtle">No archived native sessions.</p>
      )}
      {sessions.map((entry) => (
        <article className="archive-item" key={archiveKey(entry.target)}>
          <div>
            <strong>{entry.title}</strong>
            {entry.target.kind === "session" && (
              <p className="subtle">
                {entry.target.app} on{" "}
                {hostName(entry.target.host)} · Archived{" "}
                {ago(entry.archivedAt, Date.now())}
              </p>
            )}
            {entry.projectId && (
              <Link to="/" search={projectSearch(entry.projectId)}>
                Open project
              </Link>
            )}
          </div>
          <ArchiveButton target={entry.target} archived name={entry.title} />
        </article>
      ))}
    </section>
  );
}
