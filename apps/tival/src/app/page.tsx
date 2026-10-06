import { redirect } from "next/navigation";

/** Home operativo = iniciativa activa (Diagnóstico). */
export default function HomeRedirect() {
  redirect("/procesos/diagnostico");
}
