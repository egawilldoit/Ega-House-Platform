import { normalizeAreaFormValues, type AreaFormValues } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { AreaRecord, AreaWriteInput, ProjectsRepository } from "./ports";

/** Area ids are Postgres uuids; reject malformed values before persistence. */
export const AREA_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AreaFormInput = {
  name: unknown;
  icon: unknown;
  color: unknown;
  description: unknown;
};

export type AreaSaveResult =
  | Readonly<{ ok: true; area: AreaRecord }>
  | Readonly<{
      ok: false;
      errorMessage: string;
      values: AreaFormValues;
      notFound?: boolean;
      conflict?: boolean;
    }>;

function toWriteInput(values: AreaFormValues): AreaWriteInput {
  return {
    name: values.name,
    icon: values.icon,
    color: values.color,
    description: values.description || null,
  };
}

function saveFailure(
  errorMessage: string,
  values: AreaFormValues,
  flags: { notFound?: boolean; conflict?: boolean } = {},
): AreaSaveResult {
  return { ok: false, errorMessage, values, ...flags };
}

export async function createArea(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: AreaFormInput,
): Promise<AreaSaveResult> {
  const normalized = normalizeAreaFormValues(input);
  if (!normalized.ok) {
    return saveFailure(normalized.errorMessage, normalized.values);
  }

  const result = await repository.createArea(actor, toWriteInput(normalized.values));
  if (!result.ok) {
    if (result.error.code === "conflict") {
      return saveFailure(
        "An area with that name already exists.",
        normalized.values,
        { conflict: true },
      );
    }

    return saveFailure("Unable to create area right now. Please try again.", normalized.values);
  }

  return { ok: true, area: result.value };
}

export async function updateArea(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: AreaFormInput & { areaId: unknown; now?: Date },
): Promise<AreaSaveResult> {
  const areaId = String(input.areaId ?? "").trim();
  const normalized = normalizeAreaFormValues(input);

  if (!areaId || !AREA_ID_PATTERN.test(areaId)) {
    return saveFailure("Area update request is invalid.", normalized.values);
  }

  if (!normalized.ok) {
    return saveFailure(normalized.errorMessage, normalized.values);
  }

  const result = await repository.updateArea(actor, {
    areaId,
    ...toWriteInput(normalized.values),
    updatedAt: (input.now ?? new Date()).toISOString(),
  });

  if (!result.ok) {
    if (result.error.code === "conflict") {
      return saveFailure(
        "An area with that name already exists.",
        normalized.values,
        { conflict: true },
      );
    }

    return saveFailure("Unable to update area right now. Please try again.", normalized.values);
  }

  if (!result.value) {
    return saveFailure("Area not found.", normalized.values, { notFound: true });
  }

  return { ok: true, area: result.value };
}

/**
 * Delete one owner-scoped Area. The projects.area_id foreign key detaches its
 * projects atomically in the same statement; projects, tasks, goals and
 * historical evidence are never deleted by this operation.
 */
export async function deleteArea(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { areaId: unknown },
): Promise<ApplicationResult<null>> {
  const areaId = String(input.areaId ?? "").trim();

  if (!areaId || !AREA_ID_PATTERN.test(areaId)) {
    return applicationFailure("Area delete request is invalid.", "validation");
  }

  const result = await repository.deleteArea(actor, { areaId });

  if (!result.ok) {
    return applicationFailure("Unable to delete area right now.", "unknown");
  }

  if (!result.value.deleted) {
    return applicationFailure("Area not found.", "notFound");
  }

  return applicationSuccess(null);
}

/**
 * Assign (or clear) the optional Area on one owner-scoped project. A non-null
 * area must resolve to the same owner before the write; the database trigger is
 * the final guarantee against a cross-owner assignment race.
 */
export async function assignProjectArea(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown; areaId: unknown; now?: Date },
): Promise<ApplicationResult<null>> {
  const projectId = String(input.projectId ?? "").trim();
  const rawAreaId = String(input.areaId ?? "").trim();
  const areaId = rawAreaId || null;

  if (!projectId || !AREA_ID_PATTERN.test(projectId)) {
    return applicationFailure("Project area update is invalid.", "validation");
  }

  if (areaId && !AREA_ID_PATTERN.test(areaId)) {
    return applicationFailure("Choose a valid area.", "validation");
  }

  if (areaId) {
    const areaResult = await repository.getAreaById(actor, areaId);
    if (!areaResult.ok) {
      return applicationFailure("Unable to verify the area right now.", "unknown");
    }
    if (!areaResult.value) {
      return applicationFailure("Area not found.", "notFound");
    }
  }

  const result = await repository.assignProjectArea(actor, {
    projectId,
    areaId,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });

  if (!result.ok) {
    return applicationFailure("Unable to update project area right now.", "unknown");
  }

  if (!result.value.updated) {
    return applicationFailure("Project not found.", "notFound");
  }

  return applicationSuccess(null);
}
