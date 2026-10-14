import React, { useState } from "react";
import { hostName, restart, type Session } from "./model";
// A session lives on one machine, so its link and command only work there.
export function Restart({
  app,
  id,
  host,
}: {
  app: Session["app"];
  id: string;
  host?: string;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const how = restart(app, id);
  if (!how) return null;
  return (
    <span className="restart">
      {how.link && <a href={how.link}>Open in Codex</a>}
      <button
        className="more"
        title={`${how.command}${app === "Codex" ? ` (an archived task needs "codex unarchive ${id}" first)` : ""}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(how.command);
            setCopy("copied");
            setTimeout(() => setCopy("idle"), 2000);
          } catch {
            setCopy("failed");
          }
        }}
      >
        {copy === "copied" ? "Copied" : "Copy resume command"}
      </button>
      {copy === "failed" && <code>{how.command}</code>}
      {host && <span className="subtle">on {hostName(host)}</span>}
    </span>
  );
}
