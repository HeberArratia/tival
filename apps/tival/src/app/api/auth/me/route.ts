import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  destroySession,
  getSessionUser,
  readSessionToken,
} from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    // Cookie huérfana (sesión borrada/expirada): limpiar para que middleware
    // redirija a /login y el menú no quede vacío sin "Salir".
    const token = await readSessionToken();
    if (token) {
      await destroySession(token);
      await clearSessionCookie();
    }
    return NextResponse.json({ ok: false, user: null }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roles,
    },
  });
}
