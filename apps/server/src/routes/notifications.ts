import { Hono } from "hono";

import {
  getNotificationPreferences,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationOpened,
  markNotificationRead,
  registerNotificationDevice,
  unregisterNotificationDevice,
  updateNotificationPreferences,
} from "@ega/application/notifications/service";
import {
  SupabaseNotificationDeviceRepository,
  SupabaseNotificationPreferenceRepository,
  SupabaseNotificationRepository,
} from "@ega/data-access/notifications";

import type { ServerDependencies, ServerVariables } from "../app";
import { readJsonBody } from "../app";

export function createNotificationsRoutes(
  _dependencies: ServerDependencies,
): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  routes.get("/", async (c) => {
    const { actor, client } = c.var;
    const limitParam = c.req.query("limit");
    const cursor = c.req.query("cursor") ?? null;
    let limit: number | undefined;
    if (limitParam) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return c.json({ error: { code: "VALIDATION", message: "limit must be a positive number" } }, 400);
      }
      limit = parsed;
    }

    const repo = new SupabaseNotificationRepository(client as never);
    const result = await listNotifications(actor, repo, { limit, cursor });
    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }
    // Map to contracts shape
    const notifications = result.data.notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      target: n.targetType && n.targetId ? { type: n.targetType as "task", id: n.targetId } : null,
      readAt: n.readAt,
      openedAt: n.openedAt,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));
    return c.json({ ok: true as const, notifications, nextCursor: result.data.nextCursor });
  });

  routes.get("/unread-count", async (c) => {
    const { actor, client } = c.var;
    const repo = new SupabaseNotificationRepository(client as never);
    const result = await getUnreadCount(actor, repo);
    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }
    return c.json({ ok: true as const, unreadCount: result.data.unreadCount });
  });

  routes.patch("/:id/read", async (c) => {
    const { actor, client } = c.var;
    const id = c.req.param("id");
    const repo = new SupabaseNotificationRepository(client as never);
    const result = await markNotificationRead(actor, repo, id);
    if (!result.ok) {
      const isNotFound = result.errorMessage.toLowerCase().includes("not found");
      return c.json({ error: { code: isNotFound ? "NOT_FOUND" : "VALIDATION", message: result.errorMessage } }, isNotFound ? 404 : 400);
    }
    const n = result.data;
    return c.json({
      ok: true as const,
      notification: {
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        target: n.targetType && n.targetId ? { type: n.targetType as "task", id: n.targetId } : null,
        readAt: n.readAt,
        openedAt: n.openedAt,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      },
    });
  });

  routes.patch("/:id/opened", async (c) => {
    const { actor, client } = c.var;
    const id = c.req.param("id");
    const repo = new SupabaseNotificationRepository(client as never);
    const result = await markNotificationOpened(actor, repo, id);
    if (!result.ok) {
      const isNotFound = result.errorMessage.toLowerCase().includes("not found");
      return c.json({ error: { code: isNotFound ? "NOT_FOUND" : "VALIDATION", message: result.errorMessage } }, isNotFound ? 404 : 400);
    }
    const n = result.data;
    return c.json({
      ok: true as const,
      notification: {
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        target: n.targetType && n.targetId ? { type: n.targetType as "task", id: n.targetId } : null,
        readAt: n.readAt,
        openedAt: n.openedAt,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      },
    });
  });

  routes.post("/read-all", async (c) => {
    const { actor, client } = c.var;
    const repo = new SupabaseNotificationRepository(client as never);
    const result = await markAllNotificationsRead(actor, repo);
    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }
    return c.json({ ok: true as const, updatedCount: result.data.updatedCount });
  });

  routes.post("/devices", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    }
    const installationId = String(body.installationId ?? "").trim();
    const platform = String(body.platform ?? "").trim();
    const provider = String(body.provider ?? "").trim();
    const providerToken = String(body.providerToken ?? "").trim();

    if (!installationId || !platform || !provider || !providerToken) {
      return c.json({ error: { code: "VALIDATION", message: "installationId, platform, provider, providerToken are required." } }, 400);
    }
    if (platform !== "android" || provider !== "fcm") {
      return c.json({ error: { code: "VALIDATION", message: "Unsupported platform or provider." } }, 400);
    }

    const repo = new SupabaseNotificationDeviceRepository(client as never);
    const result = await registerNotificationDevice(actor, repo, {
      installationId,
      platform: "android",
      provider: "fcm",
      providerToken,
    });
    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }
    // Do not echo token back beyond what is necessary; return id and installationId
    return c.json({
      ok: true as const,
      device: {
        id: result.data.id,
        installationId: result.data.installationId,
        platform: result.data.platform,
        provider: result.data.provider,
        isActive: result.data.isActive,
      },
    }, { status: 201 });
  });

  routes.delete("/devices/:installationId", async (c) => {
    const { actor, client } = c.var;
    const installationId = c.req.param("installationId");
    const repo = new SupabaseNotificationDeviceRepository(client as never);
    const result = await unregisterNotificationDevice(actor, repo, installationId);
    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    return c.json({ ok: true as const });
  });

  routes.get("/preferences", async (c) => {
    const { actor, client } = c.var;
    const repo = new SupabaseNotificationPreferenceRepository(client as never);
    const result = await getNotificationPreferences(actor, repo);
    if (!result.ok) {
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
    }
    return c.json({ ok: true as const, preferences: result.data });
  });

  routes.patch("/preferences", async (c) => {
    const { actor, client } = c.var;
    const body = await readJsonBody(c);
    if (!body) {
      return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
    }
    // Accept either single object or { preferences: [...] }? For V1 we accept single object with notificationType
    const notificationType = String(body.notificationType ?? "").trim();
    const pushEnabled = body.pushEnabled as boolean | undefined;
    const emailEnabled = body.emailEnabled as boolean | undefined;

    if (!notificationType) {
      return c.json({ error: { code: "VALIDATION", message: "notificationType is required." } }, 400);
    }

    const repo = new SupabaseNotificationPreferenceRepository(client as never);
    const result = await updateNotificationPreferences(actor, repo, {
      notificationType: notificationType as "task_reminder",
      pushEnabled: typeof pushEnabled === "boolean" ? pushEnabled : undefined,
      emailEnabled: typeof emailEnabled === "boolean" ? emailEnabled : undefined,
    });
    if (!result.ok) {
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 400);
    }
    return c.json({ ok: true as const, preference: result.data });
  });

  return routes;
}
