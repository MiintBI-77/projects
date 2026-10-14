import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const home = homedir();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(home, ".local/share/project-overview");
const bundle = path.join(root, ".local/work-item.mjs");
if (!existsSync(bundle))
  throw Error("Run npm run collector:build before installation");
const backup = path.join(
  home,
  "agent-config-backups",
  `work-hooks-${Date.now()}`,
);
mkdirSync(path.join(base, "work/sessions"), { recursive: true, mode: 0o700 });
mkdirSync(backup, { recursive: true, mode: 0o700 });
// Preserve other hooks/settings; only replace our own installed command.
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const script = path.join(base, "work-item.mjs");
const events = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"];
// Homebrew deletes a versioned node keg after an upgrade, so use the formula's
// stable opt link. Codex must re-trust hooks whenever this command changes.
const keg = /^(.+)\/Cellar\/([^/]+)\/[^/]+\/(bin\/node)$/.exec(
  process.execPath,
);
const stable = keg && path.join(keg[1], "opt", keg[2], keg[3]);
const node = stable && existsSync(stable) ? stable : process.execPath;
const writes = [];
for (const [app, file] of [
  ["Codex", path.join(home, ".codex/hooks.json")],
  ["Claude", path.join(home, ".claude/settings.json")],
]) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const command = `${quote(node)} ${quote(script)} ${app}`;
  // Ours whatever node path an earlier installation used.
  const ours = (h) =>
    typeof h.command === "string" &&
    h.command.endsWith(` ${quote(script)} ${app}`);
  data.hooks ??= {};
  for (const event of events) {
    const groups = data.hooks[event] ?? [];
    data.hooks[event] = groups
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter((h) => !ours(h)),
      }))
      .filter((group) => group.hooks.length);
    data.hooks[event].push({
      hooks: [
        { type: "command", command, timeout: event === "SessionEnd" ? 3 : 5 },
      ],
    });
  }
  writes.push([file, JSON.stringify(data, null, 2) + "\n"]);
}
for (const file of [script, ...writes.map(([file]) => file)]) {
  if (existsSync(file))
    copyFileSync(file, path.join(backup, file.replaceAll("/", "_")));
}
copyFileSync(bundle, script);
for (const [file, content] of writes) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + ".work-hooks.tmp";
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, file);
}
console.log(
  `Installed work association hooks. Previous files preserved at ${backup}.`,
);
console.log(
  "Codex: trust the new hooks before use (ChatGPT app: Settings > Coding > Hooks > Trust; CLI: /hooks). Claude: start a new session to load changed hooks.",
);
