"use server";

import {
  searchWorkspace,
  type WorkspaceSearchResults,
} from "@/lib/services/workspace-search-service";

export async function searchWorkspaceAction(
  rawQuery: string,
  scope?: string,
): Promise<WorkspaceSearchResults> {
  return searchWorkspace(rawQuery, { scope });
}
