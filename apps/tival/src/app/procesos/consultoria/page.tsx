import { redirect } from "next/navigation";

/** Legacy → canvas de la iniciativa Diagnóstico. */
export default function ConsultoriaCanvasRedirect() {
  redirect("/procesos/diagnostico");
}
