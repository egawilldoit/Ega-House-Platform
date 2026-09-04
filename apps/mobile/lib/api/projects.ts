/**
 * Mobile project API — typed wrappers over the @ega/api-client projects
 * surface (PR5 Hono transport contract), bound to the mobile session token.
 *
 *   GET  /api/projects?view=active|archived|all -> ProjectsReadModel
 *   GET  /api/projects/:slug                    -> ProjectIdentityReadModel
 *   POST /api/projects                          -> { ok: true, values }
 *   PATCH /api/projects/:id/status              -> { ok: true }
 *   POST /api/projects/:id/archive|unarchive    -> { ok: true }
 *
 * Errors are thrown as `Error` with the server envelope message (see
 * `unwrapApiResult` in `lib/api/ega.ts`).
 */
import type {
  CreateProjectInput,
  ProjectFormValues,
  ProjectIdentityReadModel,
  ProjectStatus,
  ProjectViewFilter,
  ProjectsReadModel,
} from '@ega/api-client';
import { getMobileEgaApiClient, unwrapApiResult } from '@/lib/api/ega';

export async function listMobileProjects(
  view?: ProjectViewFilter,
): Promise<ProjectsReadModel> {
  return unwrapApiResult(await getMobileEgaApiClient().projects.list(view));
}

export async function getMobileProjectBySlug(
  slug: string,
): Promise<ProjectIdentityReadModel> {
  return unwrapApiResult(await getMobileEgaApiClient().projects.getBySlug(slug));
}

export async function createMobileProject(
  input: CreateProjectInput,
): Promise<ProjectFormValues> {
  const result = await getMobileEgaApiClient().projects.create(input);
  return unwrapApiResult(result).values;
}

export async function updateMobileProjectStatus(
  projectId: string,
  status: ProjectStatus,
): Promise<void> {
  unwrapApiResult(await getMobileEgaApiClient().projects.updateStatus(projectId, status));
}

export async function archiveMobileProject(projectId: string): Promise<void> {
  unwrapApiResult(await getMobileEgaApiClient().projects.archive(projectId));
}

export async function unarchiveMobileProject(projectId: string): Promise<void> {
  unwrapApiResult(await getMobileEgaApiClient().projects.unarchive(projectId));
}
