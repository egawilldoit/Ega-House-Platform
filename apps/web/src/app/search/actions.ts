"use server";

import { searchWorkspace, type WorkspaceSearchResults } from "@/lib/services/workspace-search-service";

export async function searchWorkspaceAction(rawQuery: string): Promise<WorkspaceSearchResults> {
  return searchWorkspace(rawQuery);
}
