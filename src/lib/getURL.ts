/**
 * Resolves the app origin for auth redirects and callbacks.
 * Localhost is always preferred when running locally, regardless of env vars.
 */
export function getURL(): string {
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  if (isLocalhost) {
    return `${window.location.protocol}//${window.location.host}`;
  }

  let url =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

  url = url.startsWith("http") ? url : `https://${url}`;
  return url.replace(/\/$/, "");
}

/**
 * Full URL to return to after OAuth (preserves path, e.g. /project/[id] on localhost).
 */
export function getOAuthRedirectTo(): string {
  if (typeof window !== "undefined") {
    return window.location.href;
  }
  return `${getURL()}/`;
}
