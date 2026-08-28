import type { InboxPriority, InboxStatus, InboxType, ManualInboxStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export type InboxRecord = Readonly<{
  id: string;
  title: string;
  body: string | null;
  status: InboxStatus;
  type: InboxType;
  projectId: string | null;
  priority: InboxPriority | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  projectName: string | null;
}>;

export type InboxProjectOptionRecord = Readonly<{
  id: string;
  name: string;
}>;

export type InboxScopeRecord = Readonly<{
  projectIds: string[];
}>;

export type InboxQuery = Readonly<{
  view?: "active" | "archived" | "all";
  search?: string | null;
  type?: InboxType | null;
  status?: ManualInboxStatus | null;
  projectId?: string | null;
  // "none" means filter where project_id is null; null means no filter (all)
  projectFilter?: string | "none" | "all" | null;
  priority?: InboxPriority | null;
  priorityFilter?: string | "none" | "all" | null;
  tag?: string | null;
}>;

export type CreateInboxRecordInput = Readonly<{
  title: string;
  body: string | null;
  type: InboxType;
  projectId: string | null;
  priority: InboxPriority | null;
  tags: string[];
  // status defaults to inbox on create
  idempotencyKey?: string | null;
  id?: string | null;
  fingerprint?: string | null;
}>;

export type InboxIdempotencyEntry = Readonly<{
  inboxItemId: string;
  fingerprint: string | null;
}>;

export type UpdateInboxRecordInput = Readonly<{
  id: string;
  title: string;
  body: string | null;
  type: InboxType;
  projectId: string | null;
  priority: InboxPriority | null;
  tags: string[];
  status: ManualInboxStatus;
}>;

export type InboxConversionLinkRecord = Readonly<{
  inboxItemId: string;
  taskId: string;
}>;

export interface InboxRepository {
  getScope(actor: AuthenticatedActor): Promise<RepositoryResult<InboxScopeRecord>>;
  listInboxItems(
    actor: AuthenticatedActor,
    query?: InboxQuery,
  ): Promise<RepositoryResult<InboxRecord[]>>;
  listProjectOptions(
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<InboxProjectOptionRecord[]>>;
  getInboxItem(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<InboxRecord | null>>;
  getInboxItemByIdempotencyKey(
    actor: AuthenticatedActor,
    key: string,
  ): Promise<RepositoryResult<InboxRecord | null>>;
  getInboxIdempotencyEntry?(
    actor: AuthenticatedActor,
    key: string,
  ): Promise<RepositoryResult<InboxIdempotencyEntry | null>>;
  createInboxItem(
    actor: AuthenticatedActor,
    input: CreateInboxRecordInput,
  ): Promise<RepositoryResult<InboxRecord>>;
  updateInboxItem(
    actor: AuthenticatedActor,
    input: UpdateInboxRecordInput,
  ): Promise<RepositoryResult<InboxRecord>>;
  setInboxItemStatus(
    actor: AuthenticatedActor,
    input: Readonly<{ id: string; status: ManualInboxStatus | "archived" | "inbox" }>,
  ): Promise<RepositoryResult<InboxRecord>>;
  // Conversion idempotency via task_external_refs (source='inbox')
  getTaskIdForInboxItem(
    actor: AuthenticatedActor,
    inboxItemId: string,
  ): Promise<RepositoryResult<string | null>>;
  createInboxTaskLink(
    actor: AuthenticatedActor,
    input: Readonly<{ inboxItemId: string; taskId: string }>,
  ): Promise<RepositoryResult<void>>;
  markInboxItemConverted(
    actor: AuthenticatedActor,
    inboxItemId: string,
  ): Promise<RepositoryResult<InboxRecord>>;
}
