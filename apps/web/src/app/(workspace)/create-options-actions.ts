"use server";

import { getCreateOptions, type CreateOptions } from "@/lib/services/create-options-service";

/** Loads create-sheet options on first open instead of charging every shell request. */
export async function loadCreateOptionsAction(): Promise<CreateOptions> {
  return getCreateOptions();
}
