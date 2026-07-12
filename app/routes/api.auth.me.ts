import { data } from "react-router";
import type { Route } from "./+types/api.auth.me";
import { getOptionalCurrentUser } from "../lib/auth.server";
import { toPublicUser } from "../lib/auth-types";

const HEADERS = { "Cache-Control": "no-store" };

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const user = await getOptionalCurrentUser(request);
    return data({ user: user ? toPublicUser(user) : null }, { headers: HEADERS });
  } catch {
    return data({ user: null }, { status: 503, headers: HEADERS });
  }
}
