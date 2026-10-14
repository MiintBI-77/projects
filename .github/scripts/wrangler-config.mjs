import { unstable_readConfig } from "wrangler";
export function requiredSecretNames() {
  const names = unstable_readConfig({}).secrets?.required;
  if (!Array.isArray(names) || !names.length)
    throw Error("Missing secrets.required");
  return names;
}
