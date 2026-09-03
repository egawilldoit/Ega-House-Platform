import { getMobileEgaApiClient, unwrapApiResult } from "@/lib/api/ega";
import type { ConvertInboxInput } from "@ega/contracts/inbox";

export type ListInboxParams = {
  view?: string | null;
  search?: string | null;
  type?: string | null;
  status?: string | null;
  project?: string | null;
  priority?: string | null;
  tag?: string | null;
};

export async function listInboxItems(params: ListInboxParams = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return unwrapApiResult(await getMobileEgaApiClient().inbox.list(params as any));
}

export async function createInboxItem(
  input: { title: string; body?: string | null; type?: string | null; projectId?: string | null; priority?: string | null; tags?: string[] },
  idempotencyKey?: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return unwrapApiResult(await getMobileEgaApiClient().inbox.create(input as any, idempotencyKey));
}

export async function updateInboxItem(id: string, input: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return unwrapApiResult(await getMobileEgaApiClient().inbox.update(id, input as any));
}

export async function archiveInboxItem(id: string) {
  return unwrapApiResult(await getMobileEgaApiClient().inbox.archive(id));
}

export async function restoreInboxItem(id: string) {
  return unwrapApiResult(await getMobileEgaApiClient().inbox.restore(id));
}

export async function convertInboxItem(id: string, input: ConvertInboxInput = {}) {
  return unwrapApiResult(await getMobileEgaApiClient().inbox.convert(id, input));
}
