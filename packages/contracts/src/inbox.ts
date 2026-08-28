import { z } from "zod";

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

export const createInboxInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  body: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  tagsInput: z.string().nullable().optional(),
});

export const updateInboxInputSchema = z.object({
  id: z.string().trim().min(1, "Idea is required."),
  title: z.string().trim().min(1, "Title is required."),
  body: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  tagsInput: z.string().nullable().optional(),
  status: z.string().trim().min(1),
});

export const inboxListQuerySchema = z.object({
  view: z.enum(INBOX_LIST_VIEWS).optional(),
  search: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  project: z.string().optional(),
  projectId: z.string().optional(),
  priority: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
});

export type ConvertInboxInput = {
  projectId?: string | null;
  goalId?: string | null;
  priority?: InboxPriority | null;
  dueDate?: string | null;
  title?: string | null;
  description?: string | null;
  remindAt?: string | null;
};

export const convertInboxInputSchema = z.object({
  projectId: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  remindAt: z.string().nullable().optional(),
});

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
