import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
test("release and secret upload share Wrangler JSONC parsing", () => {
  const result = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {requiredSecretNames} from './.github/scripts/wrangler-config.mjs'; console.log(JSON.stringify(requiredSecretNames()));`,
    ],
    { encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(result), ["ALLOWED_EMAILS", "VAPID_PRIVATE_KEY"]);
});
