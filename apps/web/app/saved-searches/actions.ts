"use server";

import { revalidatePath } from "next/cache";
import { getPageContext } from "@/lib/page-context";

export async function createSavedSearchAction(formData: FormData): Promise<void> {
  const context = await getPageContext();
  if (!context) throw new Error("Authentication required.");
  const filters = {
    province: formData.get("province") || undefined,
    sector: formData.get("sector") || undefined
  };
  await context.admin.from("saved_searches").insert({
    organization_id: context.organizationId,
    user_id: context.userId,
    name: formData.get("name"),
    query: formData.get("query") ?? "",
    filters
  });
  revalidatePath("/saved-searches");
}
