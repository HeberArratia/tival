import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser().catch(() => null);
  if (user) redirect("/procesos/diagnostico");

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>tival</strong>
            <small>Alfondo</small>
          </div>
        </div>
        <h1>Iniciar sesión</h1>
        <LoginForm />
      </div>
    </div>
  );
}
