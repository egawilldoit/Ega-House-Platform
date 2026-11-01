"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { moveFavorite, toggleFavorite, type FavoriteKind } from "@/lib/services/favorite-service";

function returnPath(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/favorites";
  return value;
}

function kindFrom(raw: unknown): FavoriteKind {
  return String(raw ?? "") === "task" ? "task" : "project";
}

export async function toggleFavoriteAction(formData: FormData): Promise<never> {
  const target = returnPath(formData.get("returnTo"));
  const kind = kindFrom(formData.get("kind"));
  const entityId = String(formData.get("entityId") ?? "").trim();
  const result = await toggleFavorite(kind, entityId);

  if (result.errorMessage) {
    redirect(`${target}?actionError=${encodeURIComponent(result.errorMessage)}`);
  }

  revalidatePath("/favorites");
  revalidatePath(target.split("?")[0] ?? "/");
  redirect(
    `${target}?actionSuccess=${encodeURIComponent(
      result.favorited ? "Added to favourites." : "Removed from favourites.",
    )}`,
  );
}

export async function moveFavoriteAction(formData: FormData): Promise<never> {
  const kind = kindFrom(formData.get("kind"));
  const entityId = String(formData.get("entityId") ?? "").trim();
  const direction = String(formData.get("direction") ?? "") === "up" ? "up" : "down";
  const result = await moveFavorite(kind, entityId, direction);

  if (result.errorMessage) {
    redirect(`/favorites?actionError=${encodeURIComponent(result.errorMessage)}`);
  }
  revalidatePath("/favorites");
  redirect("/favorites");
}
