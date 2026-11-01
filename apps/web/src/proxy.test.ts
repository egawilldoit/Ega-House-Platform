import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetClaims = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: mockGetClaims },
  }),
}));

import { isProtectedRootPath, proxy } from "./proxy";

const PRODUCTION_HOST = "www.egawilldoit.online";

function requestFor(pathname: string) {
  return new NextRequest(`https://${PRODUCTION_HOST}${pathname}`, {
    headers: { host: PRODUCTION_HOST },
  });
}

describe("proxy protected root paths", () => {
  it.each([
    "/settings",
    "/settings/",
    "/settings/account",
    "/settings/appearance",
    "/settings/preferences",
    "/settings/areas",
    "/settings/account/integrations",
  ])("protects %s", (pathname) => {
    expect(isProtectedRootPath(pathname)).toBe(true);
  });

  it("keeps existing protected routes protected", () => {
    expect(isProtectedRootPath("/tasks")).toBe(true);
    expect(isProtectedRootPath("/tasks/projects/example")).toBe(true);
    expect(isProtectedRootPath("/review/sessions/1")).toBe(true);
  });

  it.each([
    "/settings-public",
    "/settingsfoo",
    "/setting",
    "/settings2",
    "/dashboard-public",
  ])("does not protect the similarly named route %s", (pathname) => {
    expect(isProtectedRootPath(pathname)).toBe(false);
  });
});

describe("proxy request handling", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
  });

  beforeEach(() => {
    mockGetClaims.mockReset();
  });

  it("redirects a signed-out nested settings request to login", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });

    const response = await proxy(requestFor("/settings/account"));
    const location = response.headers.get("location");

    expect(response.status).toBe(307);
    expect(location).not.toBeNull();
    expect(new URL(location as string).pathname).toBe("/login");
    expect(new URL(location as string).searchParams.get("next")).toBe(
      `https://${PRODUCTION_HOST}/settings/account`,
    );
  });

  it("passes an authenticated settings request through", async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });

    const response = await proxy(requestFor("/settings/areas"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets a signed-out similarly named route through without auth lookup", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });

    const response = await proxy(requestFor("/settings-public"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(mockGetClaims).not.toHaveBeenCalled();
  });
});
