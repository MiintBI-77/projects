import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { overviewQueryOptions } from "../src/overview-query";
import type { PortfolioView } from "../src/model";
test("401 stops retry, polling and focus/reconnect refresh until authentication succeeds", async () => {
  const client = new QueryClient();
  const observer = new QueryObserver(client, overviewQueryOptions);
  let attempts = 0;
  try {
    await assert.rejects(
      client.fetchQuery({
        ...overviewQueryOptions,
        queryFn: async () => {
          attempts++;
          throw Error("SIGN_IN");
        },
      }),
    );
    assert.equal(attempts, 1);
    const query = observer.getCurrentQuery();
    const interval = overviewQueryOptions.refetchInterval;
    assert.equal(typeof interval, "function");
    if (typeof interval !== "function") throw Error("Polling policy missing");
    assert.equal(interval(query), false);
    const focus = overviewQueryOptions.refetchOnWindowFocus;
    const reconnect = overviewQueryOptions.refetchOnReconnect;
    if (typeof focus !== "function" || typeof reconnect !== "function") throw Error("Focus policy missing");
    assert.equal(focus(query), false);
    assert.equal(reconnect(query), false);
    const data: PortfolioView = {
      snapshots: [],
      closes: [],
      machines: [],
      serverTime: Date.now(),
    };
    await client.resetQueries({ queryKey: ["overview"] });
    await client.fetchQuery({
      ...overviewQueryOptions,
      queryFn: async () => data,
    });
    assert.equal(interval(query), 30000);
    assert.equal(focus(query), true);
    assert.equal(reconnect(query), true);
    assert.deepEqual(client.getQueryData(["overview"]), data);
  } finally {
    client.clear();
  }
});
