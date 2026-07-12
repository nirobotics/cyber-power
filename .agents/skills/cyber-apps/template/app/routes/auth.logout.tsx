import { redirect } from "react-router";
import type { Route } from "./+types/auth.logout";

export async function loader({ request }: Route.LoaderArgs) {
  await destroySession(request);
  throw redirect("/auth/login");
}

async function destroySession(_request: Request) {
  return null;
}

export default function LogoutRoute() {
  return null;
}
