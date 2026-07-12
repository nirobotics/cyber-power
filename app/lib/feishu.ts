import type { SessionUser } from "./auth-types";

export function startFeishuLogin(returnTo = "/") {
  const url = new URL("/api/auth/login", location.origin);
  url.searchParams.set("returnTo", returnTo);
  location.assign(url.toString());
}

export async function fetchCurrentUser(): Promise<SessionUser | null> {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    const data = await res.json() as { user: SessionUser | null };
    return data.user;
  } catch {
    return null;
  }
}
