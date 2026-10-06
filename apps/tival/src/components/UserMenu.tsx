"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MemberAvatar } from "@/components/MemberAvatar";

export function UserMenu({
  user,
}: {
  user: { id: string; name: string; email: string };
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="user-menu">
      <MemberAvatar memberId={user.id} name={user.name} size="sm" />
      <div className="user-menu-meta">
        <strong>{user.name}</strong>
        <small>{user.email}</small>
      </div>
      <button
        type="button"
        className="btn btn-ghost user-menu-logout"
        disabled={loading}
        onClick={() => void logout()}
      >
        {loading ? "…" : "Salir"}
      </button>
    </div>
  );
}
