import { useEffect, useState } from "react";
import { api } from "./overview-query";

// Push notifications when a conversation becomes the owner's move. iPhones allow
// them only for Projects opened from the Home Screen.
type Status = "hidden" | "home-screen" | "offer" | "working";
const DISMISSED = "projects.notifications.dismissed";
const SYNCED = "projects.notifications.synced";
const supported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
const iosBrowser = () =>
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
  !matchMedia("(display-mode: standalone)").matches;
const keyBytes = (key: string) =>
  Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const sameKey = (current: ArrayBuffer | null, key: Uint8Array) =>
  !!current &&
  current.byteLength === key.length &&
  new Uint8Array(current).every((byte, i) => byte === key[i]);

// Keep this device subscribed with the current key and known to Projects.
async function subscribe() {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { key } = await api<{ key: string }>("/api/push/key");
  const applicationServerKey = keyBytes(key);
  let subscription = await registration.pushManager.getSubscription();
  // After a key change the old subscription can no longer be reached.
  if (
    subscription &&
    !sameKey(subscription.options.applicationServerKey, applicationServerKey)
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  const known = !!subscription;
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  // Remind Projects of a known device at most daily; register a new one now.
  const today = new Date().toDateString();
  if (known && localStorage.getItem(SYNCED) === today) return;
  await api("/api/push/subscribe", { endpoint: subscription.endpoint });
  localStorage.setItem(SYNCED, today);
}

export function NotificationPrompt() {
  const [status, setStatus] = useState<Status>("hidden");
  const [error, setError] = useState<string | null>(null);
  const dismissed = () => !!localStorage.getItem(DISMISSED);
  useEffect(() => {
    if (!supported()) {
      if (iosBrowser() && !dismissed()) setStatus("home-screen");
      return;
    }
    if (Notification.permission === "granted")
      subscribe().catch(() => {
        if (!dismissed()) setStatus("offer");
      });
    else if (Notification.permission === "default" && !dismissed())
      setStatus("offer");
  }, []);
  if (status === "hidden") return null;
  const turnOn = async () => {
    setError(null);
    setStatus("working");
    try {
      // The permission request must come straight from the tap.
      if ((await Notification.requestPermission()) !== "granted")
        return setStatus("hidden");
      await subscribe();
      setStatus("hidden");
    } catch (e) {
      setStatus("offer");
      setError(
        e instanceof Error && e.message !== "SIGN_IN"
          ? e.message
          : "Notifications could not be turned on. Try again.",
      );
    }
  };
  const later = () => {
    localStorage.setItem(DISMISSED, "1");
    setStatus("hidden");
  };
  return (
    <p className="notify-offer" role="status">
      {status === "home-screen"
        ? "For notifications on this phone, add Projects to your Home Screen (Share, then Add to Home Screen) and open it from there."
        : "Get a notification when a conversation is ready or needs you."}{" "}
      {status !== "home-screen" && (
        <button
          className="link-button"
          disabled={status === "working"}
          onClick={turnOn}
        >
          Turn on notifications
        </button>
      )}{" "}
      <button className="link-button" onClick={later}>
        Not now
      </button>
      {error && <span className="error-inline"> {error}</span>}
    </p>
  );
}
