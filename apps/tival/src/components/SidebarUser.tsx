"use client";

import { useEffect, useState } from "react";
import { UserMenu } from "@/components/UserMenu";

type Me = { id: string; name: string; email: string };

export function SidebarUser() {
  const [user, setUser] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.user) setUser(data.user);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;
  return <UserMenu user={user} />;
}
