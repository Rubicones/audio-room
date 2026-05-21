const AUTH_RETURN_TO_KEY = "foam_auth_return_to";

export function storeAuthReturnTo(url?: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AUTH_RETURN_TO_KEY, url ?? window.location.href);
}

export function readAuthReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(AUTH_RETURN_TO_KEY);
}

export function clearAuthReturnTo() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
}
