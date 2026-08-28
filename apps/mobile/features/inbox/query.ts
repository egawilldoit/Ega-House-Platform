import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createInboxItem, listInboxItems, archiveInboxItem, restoreInboxItem } from "@/lib/api/inbox";
import type { InboxListResponse } from "@ega/contracts/inbox";

export const inboxQueryKeys = {
  all: ["inbox"] as const,
  list: (params: Record<string, string | null | undefined> = {}) => ["inbox", "list", params] as const,
};

export function useInboxListQuery(params: Record<string, string | null | undefined> = {}) {
  return useQuery({
    queryKey: inboxQueryKeys.list(params),
    queryFn: () => listInboxItems(params as any),
    placeholderData: (prev) => prev,
  });
}

export function useCreateInboxMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body?: string | null }) => createInboxItem(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all });
    },
  });
}

export function useArchiveInboxMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveInboxItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all });
    },
  });
}

export function useRestoreInboxMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreInboxItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all });
    },
  });
}
