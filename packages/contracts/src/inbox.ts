import type { InboxPriority, InboxStatus, InboxType, ManualInboxStatus } from "@ega/domain";

export type { InboxPriority, InboxStatus, InboxType, ManualInboxStatus };

export const INBOX_LIST_VIEWS = ["active", "archived", "all"] as const;
export type InboxListView = (typeof INBOX_LIST_VIEWS)[number];

export type InboxItem = {
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
};

export type InboxProjectOption = {
  id: string;
  name: string;
};

export type InboxListFilters = {
  view: InboxListView;
  search: string;
  type: InboxType | "all";
  status: ManualInboxStatus | "all";
  projectId: string | "none" | "all";
  priority: InboxPriority | "none" | "all";
  tag: string;
};

export type InboxListResponse = {
  ok: true;
  items: InboxItem[];
  projects: InboxProjectOption[];
  filters: InboxListFilters;
  total: number;
};

export type InboxMutationResponse = {
  ok: true;
  item: InboxItem;
};

export type CreateInboxInput = {
  title: string;
  body?: string | null;
  type?: InboxType | null;
  projectId?: string | null;
  priority?: InboxPriority | null;
  tags?: string[] | string | null;
  tagsInput?: string | null;
};

export type UpdateInboxInput = {
  id: string;
  title: string;
  body?: string | null;
  type?: InboxType | null;
  projectId?: string | null;
  priority?: InboxPriority | null;
  tags?: string[] | string | null;
  tagsInput?: string | null;
  status: ManualInboxStatus;
};

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; error: { issues: Array<{ message: string; path: string[] }> } };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

function fail(message: string, path: string[] = []): ParseFailure {
  return { success: false, error: { issues: [{ message, path }] } };
}

function validateTitle(title: unknown): string | null {
  const normalized = String(title ?? "").trim();
  return normalized ? normalized : null;
}

export const createInboxInputSchema = {
  safeParse(input: unknown): ParseResult<CreateInboxInput> {
    const obj = (input ?? {}) as Record<string, unknown>;
    const title = validateTitle(obj.title);
    if (!title) return fail("Title is required.", ["title"]);
    const data = {
      title,
      body: obj.body !== undefined ? (obj.body as string | null) : undefined,
      type: obj.type !== undefined ? (obj.type as unknown as InboxType | null) : undefined,
      projectId: obj.projectId !== undefined ? (obj.projectId as string | null) : undefined,
      priority: obj.priority !== undefined ? (obj.priority as unknown as InboxPriority | null) : undefined,
      tags: obj.tags !== undefined ? (obj.tags as string[] | null) : undefined,
      tagsInput: obj.tagsInput !== undefined ? (obj.tagsInput as string | null) : undefined,
    } as CreateInboxInput;
    return { success: true, data };
  },
};

export const updateInboxInputSchema = {
  safeParse(input: unknown): ParseResult<UpdateInboxInput> {
    const obj = (input ?? {}) as Record<string, unknown>;
    const id = String(obj.id ?? "").trim();
    if (!id) return fail("Idea is required.", ["id"]);
    const title = validateTitle(obj.title);
    if (!title) return fail("Title is required.", ["title"]);
    const status = String(obj.status ?? "").trim();
    if (!status) return fail("Status is required.", ["status"]);
    const data = {
      id,
      title,
      body: obj.body !== undefined ? (obj.body as string | null) : undefined,
      type: obj.type !== undefined ? (obj.type as unknown as InboxType | null) : undefined,
      projectId: obj.projectId !== undefined ? (obj.projectId as string | null) : undefined,
      priority: obj.priority !== undefined ? (obj.priority as unknown as InboxPriority | null) : undefined,
      tags: obj.tags !== undefined ? (obj.tags as string[] | null) : undefined,
      tagsInput: obj.tagsInput !== undefined ? (obj.tagsInput as string | null) : undefined,
      status: status as ManualInboxStatus,
    } as UpdateInboxInput;
    return { success: true, data };
  },
};

export const inboxListQuerySchema = {
  safeParse(input: unknown): ParseResult<Record<string, string | undefined>> {
    const obj = (input ?? {}) as Record<string, unknown>;
    const view = obj.view !== undefined ? String(obj.view) : undefined;
    if (view !== undefined && !(INBOX_LIST_VIEWS as readonly string[]).includes(view)) {
      return fail("Invalid view", ["view"]);
    }
    const result: Record<string, string | undefined> = {};
    for (const key of ["view", "search", "type", "status", "project", "projectId", "priority", "tag", "q"]) {
      if (obj[key] !== undefined) result[key] = String(obj[key]);
    }
    return { success: true, data: result };
  },
};

export type ConvertInboxInput = {
  projectId?: string | null;
  goalId?: string | null;
  priority?: InboxPriority | null;
  dueDate?: string | null;
  title?: string | null;
  description?: string | null;
  remindAt?: string | null;
};

export const convertInboxInputSchema = {
  safeParse(input: unknown): ParseResult<ConvertInboxInput> {
    const obj = (input ?? {}) as Record<string, unknown>;
    const data: Record<string, string | null> = {};
    for (const key of ["projectId", "goalId", "priority", "dueDate", "title", "description", "remindAt"] as const) {
      const val = obj[key];
      if (val === undefined) continue;
      if (val === null) data[key] = null;
      else data[key] = String(val);
    }
    return { success: true, data: data as ConvertInboxInput };
  },
};

export type InboxConversionResponse = {
  ok: true;
  item: InboxItem;
  task: {
    id: string;
    title: string;
    projectId: string;
    goalId: string | null;
    priority: InboxPriority;
    dueDate: string | null;
  };
};
