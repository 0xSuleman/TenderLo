import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function QaTasksPage(): never {
  redirect("/admin/sources");
}
