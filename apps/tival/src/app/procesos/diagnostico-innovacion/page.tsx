import { redirect } from "next/navigation";

/** Alias legacy → /procesos/diagnostico */
export default function DiagnosticoInnovacionRedirect() {
  redirect("/procesos/diagnostico");
}
