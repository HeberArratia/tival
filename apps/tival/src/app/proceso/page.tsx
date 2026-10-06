import { redirect } from "next/navigation";

/** Legacy → index de playbooks. */
export default function ProcesoRedirect() {
  redirect("/playbooks");
}
