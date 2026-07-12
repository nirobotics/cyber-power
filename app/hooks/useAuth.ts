import { useEffect, useState } from "react";
import { fetchCurrentUser } from "../lib/feishu";
import type { PublicUser } from "../lib/auth-types";

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<PublicUser | null>(null);

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
