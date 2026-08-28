import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type {
  CreateProjectInput,
  ProjectStatus,
  ProjectViewFilter,
} from '@ega/api-client';
import {
  archiveMobileProject,
  createMobileProject,
  getMobileProjectBySlug,
  listMobileProjects,
  unarchiveMobileProject,
  updateMobileProjectStatus,
} from '@/lib/api/projects';

export const projectQueryKeys = {
  all: ['projects'] as const,
  lists: () => ['projects', 'list'] as const,
  list: (view: ProjectViewFilter = 'active') => ['projects', 'list', view] as const,
  details: () => ['projects', 'detail'] as const,
  detail: (slug: string) => ['projects', 'detail', slug] as const,
};

export function useProjectListQuery(view: ProjectViewFilter = 'active') {
  return useQuery({
    queryKey: projectQueryKeys.list(view),
    queryFn: () => listMobileProjects(view),
    // Keep previous view visible during active→archived→all switch (no blank). Shows stale + “Refreshing…” until network.
    // Caveat: placeholder makes isPending false while fetching new view → stale list appears under new view header.
    // Audit (Wave 10.11): benefit outweighs risk — empty→empty still shows counter 0, and Refreshing + FeedbackBanner
    // on error signals staleness. `isPending && !data` still shows skeleton on true cold start.
    placeholderData: (previousData) => previousData,
  });
}

export function useProjectBySlugQuery(slug: string) {
  return useQuery({
    enabled: Boolean(slug),
    queryKey: projectQueryKeys.detail(slug),
    queryFn: () => getMobileProjectBySlug(slug),
  });
}

function invalidateProjectLists(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: projectQueryKeys.lists() }).catch(() => {
    // Best-effort background refresh.
  });
}

function invalidateProjectDetails(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: projectQueryKeys.details() }).catch(() => {
    // Best-effort background refresh.
  });
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) => createMobileProject(input),
    onSuccess: () => {
      invalidateProjectLists(queryClient);
    },
  });
}

export function useUpdateProjectStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, status }: { projectId: string; status: ProjectStatus }) =>
      updateMobileProjectStatus(projectId, status),
    onSuccess: () => {
      invalidateProjectLists(queryClient);
      invalidateProjectDetails(queryClient);
    },
  });
}

export function useArchiveProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => archiveMobileProject(projectId),
    onSuccess: () => {
      invalidateProjectLists(queryClient);
      invalidateProjectDetails(queryClient);
    },
  });
}

export function useUnarchiveProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => unarchiveMobileProject(projectId),
    onSuccess: () => {
      invalidateProjectLists(queryClient);
      invalidateProjectDetails(queryClient);
    },
  });
}
