// Local emulator only. Production's entrypoint never imports this file.
import { handle, runnerRoutes } from "./index";
import { authorize } from "./auth";
export { Portfolio, Conversation } from "./index";
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    return handle(
      request,
      env,
      !["127.0.0.1", "localhost"].includes(url.hostname)
        ? null
        : runnerRoutes.has(url.pathname)
          ? await authorize(request, env, false, true)
          : "local",
    );
  },
} satisfies ExportedHandler<Env>;
