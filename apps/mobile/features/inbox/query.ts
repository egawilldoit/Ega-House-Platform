import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  archiveInboxItem,
  convertInboxItem,
  createInboxItem,
  listInboxItems,
  restoreInboxItem,
  updateInboxItem,
} from "@/lib/api/inbox";
import type { ConvertInboxInput, InboxListResponse, UpdateInboxInput } from "@ega/contracts/inbox";

type InboxUpdateInput = Omit<UpdateInboxInput, "id">;

export const inboxQueryKeys = {
  all: ["inbox"] as const,
  list: (params: Record<string, string | null | undefined> = {}) => ["inbox", "list", params] as const,
};

export function useInboxListQuery(params: Record<string, string | null | undefined> = {}): ReturnType<typeof useQuery<InboxListResponse>> {
  const requestedView = params.view ?? "active";

  return useQuery<InboxListResponse>({
    queryKey: inboxQueryKeys.list(params),
    queryFn: () => listInboxItems(params as unknown as Parameters<typeof listInboxItems>[0]),
    placeholderData: (prev) => (prev?.filters.view === requestedView ? prev : undefined),
  });
}

export function useCreateInboxMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body?: string | null; idempotencyKey?: string }) =>
      createInboxItem({ title: input.title, body: input.body }, input.idempotencyKey),
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

export function useUpdateInboxMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: InboxUpdateInput }) => updateInboxItem(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all });
    },
  });
}

export function useConvertInboxMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ConvertInboxInput }) => convertInboxItem(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["today"] });
    },
  });
}
