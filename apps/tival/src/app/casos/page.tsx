import { redirect } from "next/navigation";

/** Alias legacy → home Oportunidades. */
export default function CasosIndexRedirect() {
  redirect("/");
}
