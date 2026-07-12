import { data, redirect } from "react-router";
import type { Route } from "./+types/auth.logout";
import {
  destroyAuthSession,
  getAuthSession,
  getExpiredAuthCookie,
} from "../lib/auth.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export function loader() {
  throw redirect("/", { headers: NO_STORE_HEADERS });
}

export async function action({ request }: Route.ActionArgs) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if ((origin && origin !== requestUrl.origin) || fetchSite === "cross-site") {
    return data({ error: "Cross-site logout is not allowed." }, { status: 403, headers: NO_STORE_HEADERS });
  }

  let cookie = getExpiredAuthCookie();
  try {
    cookie = await destroyAuthSession(await getAuthSession(request));
  } catch {
    // The unsigned expiry still clears a stale cookie when server auth is misconfigured.
  }
  throw redirect("/auth/login?signedOut=1", {
    headers: {
      ...NO_STORE_HEADERS,
      "Clear-Site-Data": '"cache"',
      "Set-Cookie": cookie,
    },
  });
}
