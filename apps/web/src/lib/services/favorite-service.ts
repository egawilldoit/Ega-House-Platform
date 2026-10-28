import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUserId } from "./task-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type FavoriteKind = "project" | "task";

export type FavoriteItem = {
  favoriteId: string;
  kind: FavoriteKind;
  entityId: string;
  position: number;
  label: string;
  href: `/${string}`;
  subtitle: string | null;
  archived: boolean;
};

async function resolve(supabase?: SupabaseServerClient) {
  const client = supabase ?? (await createClient());
  const ownerUserId = await getAuthenticatedUserId(client);
  return { client, ownerUserId };
}

/**
 * Owner-scoped favourites, ordered by position, with archived entities hidden
 * from the list without deleting the favourite (restoring the entity makes it
 * visible again).
 */
export async function listFavorites(options?: {
  supabase?: SupabaseServerClient;
}): Promise<{ items: FavoriteItem[]; errorMessage: string | null }> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { items: [], errorMessage: null };

  const { data: rows, error } = await client
    .from("favorites")
    .select("id, entity_kind, entity_id, position")
    .eq("owner_user_id", ownerUserId)
    .order("position", { ascending: true });

  if (error) return { items: [], errorMessage: "Unable to load favourites right now." };

  const taskIds = (rows ?? [])
    .filter((row) => row.entity_kind === "task")
    .map((row) => row.entity_id);
  const projectIds = (rows ?? [])
    .filter((row) => row.entity_kind === "project")
    .map((row) => row.entity_id);

  const [tasks, projects] = await Promise.all([
    taskIds.length
      ? client
          .from("tasks")
          .select("id, title, status, archived_at, projects(name)")
          .in("id", taskIds)
          .eq("owner_user_id", ownerUserId)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? client
          .from("projects")
          .select("id, name, slug, status")
          .in("id", projectIds)
          .eq("owner_user_id", ownerUserId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (tasks.error || projects.error) {
    return { items: [], errorMessage: "Unable to load favourites right now." };
  }

  const taskMap = new Map((tasks.data ?? []).map((task) => [task.id, task]));
  const projectMap = new Map((projects.data ?? []).map((project) => [project.id, project]));

  const items: FavoriteItem[] = [];
  for (const row of rows ?? []) {
    if (row.entity_kind === "task") {
      const task = taskMap.get(row.entity_id);
      if (!task) continue;
      items.push({
        favoriteId: row.id,
        kind: "task",
        entityId: task.id,
        position: row.position,
        label: task.title,
        href: `/tasks?task=${task.id}`,
        subtitle: task.projects?.name ?? null,
        archived: task.archived_at !== null,
      });
    } else {
      const project = projectMap.get(row.entity_id);
      if (!project) continue;
      items.push({
        favoriteId: row.id,
        kind: "project",
        entityId: project.id,
        position: row.position,
        label: project.name,
        href: project.slug ? `/tasks/projects/${project.slug}` : "/tasks/projects",
        subtitle: null,
        // Projects use status='archived' rather than an archived_at column.
        archived: project.status === "archived",
      });
    }
  }

  return {
    items: items.filter((item) => !item.archived),
    errorMessage: null,
  };
}

export async function isFavorite(
  kind: FavoriteKind,
  entityId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<boolean> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return false;
  const { data } = await client
    .from("favorites")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .eq("entity_kind", kind)
    .eq("entity_id", entityId)
    .maybeSingle();
  return Boolean(data);
}

/** Idempotent star toggle: a retry cannot create a duplicate favourite. */
export async function toggleFavorite(
  kind: FavoriteKind,
  entityId: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<{ favorited: boolean; errorMessage: string | null }> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { favorited: false, errorMessage: "Task was not found." };

  const { data: existing } = await client
    .from("favorites")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .eq("entity_kind", kind)
    .eq("entity_id", entityId)
    .maybeSingle();

  if (existing) {
    const { error } = await client
      .from("favorites")
      .delete()
      .eq("id", existing.id)
      .eq("owner_user_id", ownerUserId);
    return { favorited: false, errorMessage: error ? "Unable to update favourites." : null };
  }

  const { data: last } = await client
    .from("favorites")
    .select("position")
    .eq("owner_user_id", ownerUserId)
    .eq("entity_kind", kind)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await client.from("favorites").insert({
    owner_user_id: ownerUserId,
    entity_kind: kind,
    entity_id: entityId,
    position: (last?.position ?? -1) + 1,
  });

  // A unique-key race means the item is already favourited: success, not error.
  if (!error) return { favorited: true, errorMessage: null };
  if (error.code === "23505") return { favorited: true, errorMessage: null };
  return { favorited: false, errorMessage: "Unable to update favourites." };
}

/** Move one favourite one slot within its kind and renumber densely. */
export async function moveFavorite(
  kind: FavoriteKind,
  entityId: string,
  direction: "up" | "down",
  options?: { supabase?: SupabaseServerClient },
): Promise<{ errorMessage: string | null }> {
  const { client, ownerUserId } = await resolve(options?.supabase);
  if (!ownerUserId) return { errorMessage: "Favourite was not found." };

  const { data: rows } = await client
    .from("favorites")
    .select("id, entity_id, position")
    .eq("owner_user_id", ownerUserId)
    .eq("entity_kind", kind)
    .order("position", { ascending: true });

  const list = rows ?? [];
  const index = list.findIndex((row) => row.entity_id === entityId);
  if (index === -1) return { errorMessage: "Favourite was not found." };
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= list.length) return { errorMessage: null };

  const reordered = [...list];
  const [item] = reordered.splice(index, 1);
  if (!item) return { errorMessage: null };
  reordered.splice(target, 0, item);

  for (const [position, row] of reordered.entries()) {
    if (row.position === position) continue;
    const { error } = await client
      .from("favorites")
      .update({ position, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("owner_user_id", ownerUserId);
    if (error) return { errorMessage: "Unable to reorder favourites right now." };
  }

  return { errorMessage: null };
}
