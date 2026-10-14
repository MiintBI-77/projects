// Web Push (RFC 8030) signed with VAPID (RFC 8292) and sent without a payload.
// The device then asks Projects what to show, with the owner's own sign-in, so no
// conversation title, text or ID crosses Apple's, Google's or Mozilla's servers.
const PUSH_HOSTS = [
  "web.push.apple.com",
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
];
// The Worker posts to stored endpoints, so only the browsers' push services
// qualify; anything else could turn a subscription into a request forger.
export function pushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      value.length <= 1000 &&
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      (PUSH_HOSTS.includes(url.hostname) ||
        /^wns2-[a-z0-9]+\.notify\.windows\.com$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}
type PushKey = { kty: "EC"; crv: "P-256"; x: string; y: string; d: string };
function pushKey(secret: string): PushKey {
  const key = JSON.parse(secret) as PushKey;
  if (key.kty !== "EC" || key.crv !== "P-256" || !key.x || !key.y || !key.d)
    throw Error("The push key is not a P-256 private key.");
  return key;
}
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const bytes = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
// Browsers subscribe with the uncompressed public point.
export function vapidPublicKey(secret: string) {
  const key = pushKey(secret);
  return base64url(new Uint8Array([4, ...bytes(key.x), ...bytes(key.y)]));
}
// The subject is this site's address, the contact push services expect.
export async function vapidAuthorization(
  endpoint: string,
  secret: string,
  subject: string,
  now = Date.now(),
) {
  const signer = await crypto.subtle.importKey(
    "jwk",
    { ...pushKey(secret), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const part = (value: object) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signer,
    new TextEncoder().encode(unsigned),
  );
  return `vapid t=${unsigned}.${base64url(new Uint8Array(signature))}, k=${vapidPublicKey(secret)}`;
}
// "gone" means the browser dropped this subscription; forget the device.
export async function sendPush(
  endpoint: string,
  secret: string,
  subject: string,
  fetcher: typeof fetch = fetch,
): Promise<"sent" | "gone" | "failed"> {
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(endpoint, secret, subject),
        TTL: "86400",
        Urgency: "high",
      },
      body: "",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404 || response.status === 410) return "gone";
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
