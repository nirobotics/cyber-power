import type { PublicUser } from "./auth-types";

export function startFeishuLogin(returnTo = "/") {
  const url = new URL("/auth/login", location.origin);
  url.searchParams.set("returnTo", returnTo);
  location.assign(url.toString());
}

export async function fetchCurrentUser(): Promise<PublicUser | null> {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    const data = await res.json() as { user: PublicUser | null };
    return data.user;
  } catch {
    return null;
  }
}
