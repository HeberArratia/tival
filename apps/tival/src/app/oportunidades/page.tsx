import { redirect } from "next/navigation";

/** Legacy: listado de oportunidades → Contactos (directorio). */
export default function OportunidadesIndexRedirect() {
  redirect("/contactos");
}
