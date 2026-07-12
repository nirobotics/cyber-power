import { Form, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/auth.login";
import { ThemeToggle } from "../components/theme-toggle";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const returnTo = String(formData.get("returnTo") || "/");
  throw redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/";

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-4 text-[var(--foreground)]">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <section className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
            NI
          </div>
          <div>
            <h1 className="text-2xl font-semibold">REPLACE_APP_NAME</h1>
            <p className="text-sm text-[var(--muted)]">Sign in with Feishu</p>
          </div>
        </div>
        <Form method="post" className="card grid gap-4 p-5">
          <input type="hidden" name="returnTo" value={returnTo} />
          <button type="submit" className="btn btn-primary w-full">
            Feishu Login
          </button>
        </Form>
      </section>
    </main>
  );
}
