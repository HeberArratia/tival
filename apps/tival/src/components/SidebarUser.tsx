"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UserMenu } from "@/components/UserMenu";

type Me = { id: string; name: string; email: string };

export function SidebarUser() {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "none">("loading");
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json() as Promise<{ user?: Me | null }>;
      })
      .then((data) => {
        if (cancelled) return;
        if (data?.user) {
          setUser(data.user);
          setStatus("ok");
        } else {
          setUser(null);
          setStatus("none");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setStatus("none");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function goLogin() {
    setRecovering(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // ignore
    }
    router.replace("/login");
    router.refresh();
  }

  if (status === "loading") {
    return (
      <div className="user-menu">
        <div className="user-menu-meta">
          <small>Cargando sesión…</small>
        </div>
      </div>
    );
  }

  if (!user || status === "none") {
    return (
      <div className="user-menu">
        <div className="user-menu-meta">
          <strong>Sesión inválida</strong>
          <small>Volvé a entrar para operar</small>
        </div>
        <button
          type="button"
          className="btn btn-ghost user-menu-logout"
          disabled={recovering}
          onClick={() => void goLogin()}
        >
          {recovering ? "…" : "Entrar"}
        </button>
      </div>
    );
  }

  return <UserMenu user={user} />;
}
