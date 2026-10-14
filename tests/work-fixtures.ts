import type { Issue } from "../src/work-model";
export const issue = (number: number, over: Partial<Issue> = {}): Issue => ({
  number,
  title: `Issue ${number}`,
  body: "",
  url: `https://github.com/acme/work/issues/${number}`,
  open: true,
  kind: "feature",
  initiative: null,
  customers: [],
  repos: ["org/repo"],
  updatedAt: 1,
  ...over,
});
