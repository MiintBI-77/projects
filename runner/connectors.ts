import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { nativeEnv } from "./native";

const exec = promisify(execFile);
// The user's connected accounts, as each native app offers them to a helper.
// The user approved helpers reading and writing every connector, except email
// sending, permanent email deletion and account administration. The master and
// read-only recovery get no connector approvals.
export type ConnectorAccess = {
  // Claude permission rules: whole claude.ai connector servers to allow, and
  // tools or local MCP servers to hide (hidden tools are never offered).
  // Null when Claude's connectors could not be listed.
  claude: { allow: string[]; deny: string[] } | null;
  // Codex configuration overrides for its app connectors; null when unknown.
  codex: string[] | null;
};
// Claude Code's tool prefix for an MCP server name.
export const mcpName = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, "_");
// `claude mcp list` prints "<name>: <target> - <status>"; claude.ai connectors
// are named "claude.ai <Connector>". Everything else is a local MCP server.
export function parseMcpList(raw: string) {
  const connectors: string[] = [],
    local: string[] = [];
  for (const line of raw.split("\n")) {
    const at = line.indexOf(": ");
    if (at <= 0 || !/ - [✔✘!]/.test(line)) continue;
    const name = line.slice(0, at).trim();
    if (name.startsWith("claude.ai ")) connectors.push(mcpName(name));
    else local.push(mcpName(name));
  }
  return { connectors: [...new Set(connectors)], local: [...new Set(local)] };
}
// Any mail connector, by name: sending, replying and forwarding stay with
// the user. The lists cover the tool names mail connectors use; blocking a
// name a connector lacks is harmless. The user's own rule still binds every agent.
const MAIL = /mail|outlook|inbox|exchange/i;
const CLAUDE_BLOCKED = [
  "send_message", "send_email", "send_draft", "reply", "reply_message",
  "reply_to_message", "reply_email", "forward", "forward_email",
  "forward_emails", "forward_message",
];
// Codex mail tools that send or permanently delete email, and connectors that
// administer the account itself.
const CODEX_MAIL_BLOCKED = [
  "send_email", "send_draft", "send_message", "reply_email", "reply_to_email",
  "forward_email", "forward_emails", "delete_email", "delete_emails",
];
const CODEX_ADMIN = ["connector_openai_safety_settings", "connector_openai_plugin_management"];
// From the machine's config: the local MCP servers its owner approved for
// Claude helpers, and further tools to hide from them. Other local servers
// stay hidden. Codex keeps its own default for its MCP servers, which refuses
// every tool that is not read-only.
export type HelperPolicy = { localServers: string[]; deniedTools: string[] };
export function claudeRules(
  list: ReturnType<typeof parseMcpList>,
  policy: HelperPolicy = { localServers: [], deniedTools: [] },
) {
  if (!list.connectors.length) return null;
  const approved = new Set(policy.localServers.map(mcpName));
  const local = list.local.filter((server) => approved.has(server));
  return {
    allow: [...list.connectors, ...local].map((server) => `mcp__${server}`),
    deny: [
      ...list.local
        .filter((server) => !approved.has(server))
        .map((server) => `mcp__${server}`),
      ...policy.deniedTools,
      ...list.connectors
        .filter((server) => MAIL.test(server))
        .flatMap((server) => CLAUDE_BLOCKED.map((tool) => `mcp__${server}__${tool}`)),
    ],
  };
}
export function codexConfig(apps: { id: string; runtimeName: string }[]) {
  return [
    'apps._default.default_tools_approval_mode="approve"',
    "apps._default.destructive_enabled=true",
    "apps._default.open_world_enabled=true",
    ...CODEX_ADMIN.map((id) => `apps.${id}.enabled=false`),
    ...apps
      .filter((app) => MAIL.test(app.runtimeName) && /^[\w-]+$/.test(app.id))
      .flatMap((app) =>
        CODEX_MAIL_BLOCKED.map((tool) => `apps.${app.id}.tools.${tool}.enabled=false`),
      ),
  ].flatMap((value) => ["-c", value]);
}
async function claudeList() {
  const { stdout } = await exec("claude", ["mcp", "list"], {
    cwd: homedir(),
    env: nativeEnv(),
    timeout: 60_000,
    maxBuffer: 1_000_000,
  });
  return parseMcpList(stdout);
}
// The installed Codex app connectors, from a short-lived app server.
function codexApps(): Promise<{ id: string; runtimeName: string }[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
      cwd: homedir(),
      env: nativeEnv(),
      stdio: "pipe",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Codex app list timed out."));
    }, 30_000);
    let buffer = "";
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
    child.on("error", reject);
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message: { id?: number; result?: { apps?: unknown } };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "app/installed", params: {} });
        }
        if (message.id === 2) {
          clearTimeout(timer);
          child.kill();
          const data = Array.isArray(message.result?.apps) ? message.result.apps : [];
          resolve(
            data.flatMap((app) =>
              app && typeof app.id === "string" && typeof app.runtimeName === "string"
                ? [{ id: app.id, runtimeName: app.runtimeName }]
                : [],
            ),
          );
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "projects_runner", title: "Projects", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      },
    });
  });
}
let cached: { at: number; access: Promise<ConnectorAccess> } | null = null;
// Discovered once an hour. If an app cannot be asked, its helpers keep the
// master's setup (Claude the browser only, Codex its own defaults), which is
// never broader than approved.
export function connectorAccess(policy?: HelperPolicy): Promise<ConnectorAccess> {
  if (cached && Date.now() - cached.at < 3600_000) return cached.access;
  const access = Promise.all([
    claudeList().then((list) => claudeRules(list, policy), () => null),
    codexApps().then(codexConfig, () => null),
  ]).then(([claude, codex]) => ({ claude, codex }));
  cached = { at: Date.now(), access };
  return access;
}
