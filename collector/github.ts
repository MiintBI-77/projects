import { createSign } from "node:crypto";
// An optional read-only GitHub App installed on the account that owns the
// repositories. Installation tokens are restricted further to the selected
// repositories and read scopes. Without one, the signed-in GitHub CLI reads.
export async function githubToken(repositories: string[]) {
  const key = process.env.GITHUB_APP_PRIVATE_KEY,
    id = process.env.GITHUB_APP_ID;
  if (!key || !id) return;
  if (!repositories.length) return;
  const owners = new Set(repositories.map((r) => r.split("/")[0]));
  if (owners.size !== 1) throw Error("App repository scope unavailable");
  const now = Math.floor(Date.now() / 1000),
    header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
      "base64url",
    ),
    payload = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: id }),
    ).toString("base64url");
  const message = `${header}.${payload}`,
    signature = createSign("RSA-SHA256").update(message).sign(key, "base64url");
  const headers = {
    Authorization: `Bearer ${message}.${signature}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const r = await fetch(`https://api.github.com/repos/${repositories[0]}/installation`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error("GitHub App installation unavailable");
  const installation = (await r.json()) as { id: number };
  const issued = await fetch(
    `https://api.github.com/app/installations/${installation.id}/access_tokens`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        repositories: repositories.map((r) => r.split("/")[1]),
        permissions: {
          contents: "read",
          issues: "read",
          pull_requests: "read",
          checks: "read",
          actions: "read",
          statuses: "read",
          metadata: "read",
        },
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!issued.ok) throw Error("GitHub read-only token unavailable");
  const result = (await issued.json()) as { token: string };
  if (!result.token) throw Error("GitHub token missing");
  process.env.GH_TOKEN = result.token;
}
