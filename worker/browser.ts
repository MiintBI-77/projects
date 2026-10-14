import { createHmac } from "node:crypto";
import { z } from "zod";
import { equal } from "./auth";
import { trace } from "./telemetry";
import { telemetry } from "../src/telemetry";
import type { ConversationRecord } from "./runs";
import { RUNNER_STALE_MS } from "../src/run-model";

const IDLE_MS = 5 * 60_000;
const MAX_MS = 30 * 60_000;
const GRANT_MS = 60 * 60_000;
const claimSchema = z
  .object({
    id: z.uuid(),
    owner: z.uuid(),
    generation: z.number().int().positive(),
    expires: z.number().int().positive(),
  })
  .strict();
type Claim = z.infer<typeof claimSchema>;
type Session = {
  id: string | null;
  started: number;
  expires: number;
  pausedUntil?: number;
  closing?: boolean;
  retryAt?: number;
};
export const browserPath = /^\/api\/browser\/([a-f0-9-]{36})\/cdp$/;

// Domain-separated, short-lived capabilities are not runner credentials. The
// current durable claim is checked on EVERY connection, including reconnects.
function signature(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`projects-browser-v1:${payload}`)
    .digest("hex");
}
export function signBrowserClaim(claim: Claim, secret: string) {
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}
export function verifyBrowserClaim(
  value: string,
  secret: string,
  now = Date.now(),
): Claim | null {
  if (!secret || value.length > 1024) return null;
  const [payload, mac, extra] = value.split(".");
  if (!payload || !mac || extra || !equal(mac, signature(payload, secret)))
    return null;
  try {
    const claim = claimSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    return claim.expires > now && claim.expires <= now + GRANT_MS
      ? claim
      : null;
  } catch {
    return null;
  }
}

// Owned by the existing conversation object. Only this private table contains
// provider identifiers; capabilities and Live View URLs are never persisted.
export class ConversationBrowser {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private storage: DurableObjectStorage,
    private env: Env,
    private record: () => ConversationRecord | null,
    private changed: () => void,
  ) {
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS browser_session (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)",
    );
  }
  // Capabilities are signed with this conversation's own key, never a
  // machine's token, and checked only here.
  private key(): string {
    const saved = this.storage.kv.get<string>("browserKey");
    if (saved) return saved;
    const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    this.storage.kv.put("browserKey", key);
    return key;
  }
  private read(): Session | null {
    const row = this.storage.sql
      .exec<{ payload: string }>(
        "SELECT payload FROM browser_session WHERE id=1",
      )
      .toArray()[0];
    return row ? (JSON.parse(row.payload) as Session) : null;
  }
  private save(value: Session | null) {
    if (value)
      this.storage.sql.exec(
        "INSERT OR REPLACE INTO browser_session(id,payload) VALUES(1,?)",
        JSON.stringify(value),
      );
    else this.storage.sql.exec("DELETE FROM browser_session WHERE id=1");
    this.changed();
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action, action).catch(() => {
      throw Error("Browser provider operation failed.");
    });
    this.pending = next.catch(() => {});
    return next;
  }
  private fields() {
    const run = this.record()?.run;
    return run ? { runId: run.id, generation: run.generation } : {};
  }
  private async getSession(id: string) {
    try {
      return await this.env.BROWSER.getSession(id);
    } catch (error) {
      // The live binding throws this exact error for expired sessions, despite
      // its documented nullable result. Only normalize the observed absence;
      // authorization, transport and other provider failures remain failures.
      if (
        error instanceof Error &&
        /^(?:BrowserBindingError: )?Session not found \(status=404\)$/.test(
          error.message,
        )
      ) return null;
      telemetry("conversation", "browser_failed", {
        ...this.fields(), browserOperation: "lookup", reason: "unexpected",
      }, "warn");
      throw error;
    }
  }
  private valid(claim: Claim) {
    const record = this.record();
    return (
      claim.expires > Date.now() &&
      record?.owner === claim.owner &&
      record.run.id === claim.id &&
      record.run.generation === claim.generation &&
      record.run.state === "running" &&
      record.run.connection !== "disconnected" &&
      Date.now() - record.run.heartbeatAt < RUNNER_STALE_MS
    );
  }
  private configured() {
    const hosts =
      this.env.BROWSER_HOSTS?.split(",").map((host) => host.trim()) ?? [];
    return (
      !!this.env.BROWSER &&
      hosts.length > 0 &&
      hosts.every((host) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host))
    );
  }
  grant(owner: string, generation: number) {
    const id = this.record()?.run.id;
    const claim = {
      id: id ?? "",
      owner,
      generation,
      expires: Date.now() + GRANT_MS,
    };
    return this.configured() && this.valid(claim)
      ? {
          capability: signBrowserClaim(claim, this.key()),
          expiresAt: claim.expires,
        }
      : null;
  }
  nextAlarm(): number {
    const session = this.read();
    if (!session) return Infinity;
    const state = this.record()?.run.state;
    if (session.closing) return session.retryAt ?? Date.now() + 1;
    if (!["running", "queued", "blocked"].includes(state ?? ""))
      return Date.now() + 1;
    if (state === "blocked" && !session.pausedUntil) return Date.now() + 1;
    return Math.min(session.expires, session.pausedUntil ?? Infinity);
  }
  private async close(session: Session) {
    if (session.closing && (session.retryAt ?? 0) > Date.now()) return;
    // Mark before I/O. An eviction or failed close must not permit replacement
    // of an existing paid session until its bounded cleanup retry succeeds.
    this.save({ ...session, closing: true, retryAt: Date.now() + 30_000 });
    if (session.id) {
      const live = await this.getSession(session.id);
      if (live && !live.endTime) {
        const result = await trace("browser.close", this.fields(), () =>
          this.env.BROWSER.closeSession(session.id!),
        );
        if (result.status === "closing") return;
      }
    } else if (Date.now() < session.expires) {
      return; // Lost acquisition reply: let the provider idle timeout expire.
    }
    this.save(null);
    telemetry("conversation", "browser_closed", {
      ...this.fields(),
      durationMs: Math.max(0, Date.now() - session.started),
    });
  }
  async reconcile() {
    return this.serial(async () => {
      let session = this.read();
      if (!session) return;
      const state = this.record()?.run.state;
      if (state === "blocked" && !session.pausedUntil) {
        session = {
          ...session,
          pausedUntil: Math.min(session.expires, Date.now() + IDLE_MS),
        };
        this.save(session);
      }
      if (state === "running" && session.pausedUntil) {
        delete session.pausedUntil;
        this.save(session);
      }
      if (
        session.closing ||
        Date.now() >=
          Math.min(session.expires, session.pausedUntil ?? Infinity) ||
        !["running", "queued", "blocked"].includes(state ?? "")
      )
        await this.close(session);
    });
  }
  async status() {
    await this.reconcile();
    return this.serial(async () => {
      let session = this.read();
      if (session?.id && !session.closing) {
        const live = await this.getSession(session.id);
        if (!live || live.endTime) {
          this.save(null);
          session = null;
        }
      }
      return {
        enabled: this.configured(),
        state: !session
          ? "idle"
          : session.closing
            ? "closing"
            : session.id
              ? "ready"
              : "starting",
        expiresAt: session
          ? Math.min(session.expires, session.pausedUntil ?? Infinity)
          : null,
      };
    });
  }
  async liveView(readonly: boolean) {
    await this.reconcile();
    return this.serial(async () => {
      const session = this.read();
      if (!session?.id || session.closing || Date.now() >= session.expires)
        return null;
      const live = await this.getSession(session.id);
      if (!live || live.endTime) {
        this.save(null);
        return null;
      }
      // Never cache or log this credential URL. Closing the browser revokes it.
      const view = await trace("browser.view", this.fields(), () =>
        this.env.BROWSER.getLiveView(session.id!, {
          mode: "full",
          expiresInMs: 60_000,
          ...(readonly ? { guardrails: { mode: "readonly" as const } } : {}),
        }),
      );
      if (
        !["running", "queued", "blocked"].includes(
          this.record()?.run.state ?? "",
        )
      )
        return null;
      return { url: view.devtoolsFrontendUrl, expiresAt: Date.now() + 60_000 };
    });
  }
  async connect(request: Request): Promise<Response> {
    const id = browserPath.exec(new URL(request.url).pathname)?.[1];
    const value =
      request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    const claim = verifyBrowserClaim(value, this.key());
    if (!claim || claim.id !== id || !this.valid(claim))
      return new Response("Browser access expired", { status: 403 });
    if (
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    )
      return new Response("WebSocket required", { status: 426 });
    if (!this.configured())
      return new Response("Browser is unavailable", { status: 503 });
    return this.serial(async () => {
      try {
        if (!this.valid(claim))
          return new Response("Browser access expired", { status: 403 });
        let session = this.read();
        if (session && (session.closing || Date.now() >= session.expires)) {
          await this.close(session);
          session = this.read();
        }
        if (session?.closing || (session && !session.id))
          return new Response("Browser start is unconfirmed; try later", {
            status: 503,
          });
        const live = session?.id
          ? await this.getSession(session.id)
          : null;
        if (session?.id && (!live || live.endTime)) {
          this.save(null);
          // Reconnect is explicit; no CDP command or browser mutation is replayed.
          return new Response(
            "Browser expired; reconnect to start a new browser",
            { status: 410 },
          );
        }
        if (!session) {
          const started = Date.now();
          // Persist before acquisition. Unknown replies are bounded by provider
          // inactivity and this quarantine, including after object eviction.
          this.save({ id: null, started, expires: started + IDLE_MS + 60_000 });
          const acquired = await trace("browser.acquire", this.fields(), () =>
            this.env.BROWSER.acquire({
              keepAlive: IDLE_MS,
              recording: false,
              guardrails: {
                allowedDomains: this.env.BROWSER_HOSTS.split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            }),
          );
          session = {
            id: acquired.sessionId,
            started,
            expires: Math.min(started + MAX_MS, claim.expires),
          };
          this.save(session);
          telemetry("conversation", "browser_created", {
            ...this.fields(),
            durationMs: Date.now() - started,
          });
        }
        if (!this.valid(claim)) {
          await this.close(session);
          return new Response("Browser access expired", { status: 403 });
        }
        const connection = await this.env.BROWSER.connectSession(session.id!);
        const response = await trace("browser.connect", this.fields(), () =>
          connection.webSocket.fetch("https://browser-binding.invalid", {
            headers: { Upgrade: "websocket" },
          }),
        );
        if (!response.webSocket)
          return new Response("Browser connection failed", { status: 503 });
        if (!this.valid(claim)) {
          response.webSocket.accept();
          response.webSocket.close(1000, "Claim ended");
          await this.close(session);
          return new Response("Browser access expired", { status: 403 });
        }
        telemetry("conversation", "browser_connected", this.fields());
        return new Response(null, {
          status: 101,
          webSocket: response.webSocket,
        });
      } catch {
        telemetry(
          "conversation",
          "browser_failed",
          { ...this.fields(), browserOperation: "connect", reason: "unexpected" },
          "warn",
        );
        return new Response(
          "Browser is temporarily unavailable; no action was replayed",
          { status: 503 },
        );
      }
    });
  }
}
