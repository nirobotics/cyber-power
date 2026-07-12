import { useEffect, useState } from "react";
import { fetchCurrentUser } from "../lib/feishu";
import type { SessionUser } from "../lib/auth-types";

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCurrentUser()
      .then((nextUser) => {
        if (alive) setUser(nextUser);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { loading, user };
}
