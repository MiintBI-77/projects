#!/usr/bin/env node
// Deletes every secret bound on the Worker that the wrangler config does not declare
// in `secrets.required`. Runs after `wrangler deploy --secrets-file`, whose
// upload is additive — this is the half that makes it subtractive too, so
// `wrangler secret list` equals the allowlist after every deploy and drift is
// not a state that can exist.
//
// Deletion is `{"NAME": null}` through `wrangler secret bulk` (wrangler >= 4.97).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { requiredSecretNames } from "./wrangler-config.mjs";

const required = new Set(requiredSecretNames());

const bound = JSON.parse(
  execFileSync("npx", ["wrangler", "secret", "list", "--format", "json"], {
    encoding: "utf8",
  }),
);

const extra = bound
  .map((secret) => secret.name)
  .filter((name) => !required.has(name));

if (extra.length === 0) {
  console.log(
    "Bound secrets already equal secrets.required — nothing to prune.",
  );
  process.exit(0);
}

console.log(
  `Pruning ${extra.length} secret(s) not in secrets.required: ${extra.join(", ")}`,
);

// Keep this marker across retries: a timed-out bulk update may have succeeded.
// The caller then publishes the reviewed code again to obtain its final version.
if (process.argv[2]) writeFileSync(process.argv[2], "changed", { mode: 0o600 });

execFileSync("npx", ["wrangler", "secret", "bulk"], {
  input: JSON.stringify(Object.fromEntries(extra.map((name) => [name, null]))),
  stdio: ["pipe", "inherit", "inherit"],
});
