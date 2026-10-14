import { queryOptions } from "@tanstack/react-query";
import { setMachineNames, type PortfolioView } from "./model";

export async function api<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!response.ok)
    throw Error(
      response.status === 401
        ? "SIGN_IN"
        : (value?.error ?? `Request failed (${response.status}). Try again.`),
    );
  return value as T;
}

async function load(): Promise<PortfolioView> {
  const response = await fetch("/api/overview", { cache: "no-store" });
  if (response.status === 401) throw new Error("SIGN_IN");
  if (!response.ok)
    throw new Error(
      "Project updates are unavailable. Previously loaded information may be old.",
    );
  const view = (await response.json()) as PortfolioView;
  setMachineNames(view.machines ?? []);
  return view;
}

export const privateQueryPolicy = (interval: number) => ({
  // An unauthenticated refetch changes error -> pending -> error and would
  // unmount the code-entry form. Resume only after successful sign-in.
  refetchInterval: (query: { state: { error: Error | null } }) =>
    query.state.error?.message === "SIGN_IN" ? (false as const) : interval,
  refetchOnWindowFocus: (query: { state: { error: Error | null } }) =>
    query.state.error?.message !== "SIGN_IN",
  refetchOnReconnect: (query: { state: { error: Error | null } }) =>
    query.state.error?.message !== "SIGN_IN",
  retry: (count: number, error: Error) =>
    error.message !== "SIGN_IN" && count < 1,
});
export const overviewQueryOptions = queryOptions({
  queryKey: ["overview"],
  queryFn: load,
  ...privateQueryPolicy(30_000),
});
