import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseCookieOptions } from "@/lib/supabase/cookie-options";

const ROOT_HOSTS = new Set(["egawilldoit.online", "www.egawilldoit.online"]);
const PROTECTED_HOSTS = new Set([
  "goals.egawilldoit.online",
  "tasks.egawilldoit.online",
  "timer.egawilldoit.online",
  "review.egawilldoit.online",
]);
const LOGIN_HOST = "www.egawilldoit.online";
const PROTECTED_ROOT_PATH_PREFIXES: Array<`/${string}`> = [
  "/dashboard",
  "/goals",
  "/shutdown",
  "/startup",
  "/tasks",
  "/today",
  "/timer",
  "/review",
];

const SUBDOMAIN_PREFIXES: Record<string, `/${string}`> = {
  "goals.egawilldoit.online": "/goals",
  "tasks.egawilldoit.online": "/tasks",
  "timer.egawilldoit.online": "/timer",
  "review.egawilldoit.online": "/review",
};

function getEnv(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing env.${name}`);
  }

  return value;
}

function normalizeHostname(hostname: string | null) {
  if (!hostname) {
    return null;
  }

  return hostname
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
}

function getRequestHostname(request: NextRequest) {
  return normalizeHostname(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  );
}

function shouldSkipRewrite(pathname: string, prefix: `/${string}`) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isProtectedRootPath(pathname: string) {
  return PROTECTED_ROOT_PATH_PREFIXES.some((prefix) =>
    shouldSkipRewrite(pathname, prefix),
  );
}

function copySupabaseResponse(
  source: NextResponse,
  target: NextResponse
) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });

  source.headers.forEach((value, key) => {
    if (key === "x-middleware-next") {
      return;
    }

    target.headers.set(key, value);
  });

  return target;
}

function createLoginRedirect(request: NextRequest, hostname: string) {
  const redirectUrl = new URL("/login", `https://${LOGIN_HOST}`);
  const originalUrl = new URL(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
    `https://${hostname}`
  );

  redirectUrl.searchParams.set("next", originalUrl.toString());

  return redirectUrl;
}

async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-current-path", request.nextUrl.pathname);

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const hostname = getRequestHostname(request);
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabasePublishableKey = getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookieOptions: getSupabaseCookieOptions(hostname),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });

        Object.entries(headersToSet).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();

  return {
    error,
    hasSession: Boolean(data?.claims),
    response,
  };
}

export async function middleware(request: NextRequest) {
  const hostname = getRequestHostname(request);

  if (!hostname) {
    return NextResponse.next();
  }

  if (ROOT_HOSTS.has(hostname)) {
    if (!isProtectedRootPath(request.nextUrl.pathname)) {
      return NextResponse.next();
    }

    const { error, hasSession, response } = await updateSession(request);

    if (error || !hasSession) {
      return copySupabaseResponse(
        response,
        NextResponse.redirect(createLoginRedirect(request, hostname))
      );
    }

    return copySupabaseResponse(response, NextResponse.next());
  }

  const prefix = SUBDOMAIN_PREFIXES[hostname];

  if (!prefix) {
    return NextResponse.next();
  }

  if (PROTECTED_HOSTS.has(hostname)) {
    const { error, hasSession, response } = await updateSession(request);

    if (error || !hasSession) {
      return copySupabaseResponse(
        response,
        NextResponse.redirect(createLoginRedirect(request, hostname))
      );
    }

    if (shouldSkipRewrite(request.nextUrl.pathname, prefix)) {
      return copySupabaseResponse(response, NextResponse.next());
    }

    const url = request.nextUrl.clone();
    url.pathname =
      request.nextUrl.pathname === "/"
        ? prefix
        : `${prefix}${request.nextUrl.pathname}`;

    return copySupabaseResponse(response, NextResponse.rewrite(url));
  }

  if (shouldSkipRewrite(request.nextUrl.pathname, prefix)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname =
    request.nextUrl.pathname === "/"
      ? prefix
      : `${prefix}${request.nextUrl.pathname}`;

  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!api|_next/|favicon.ico|.*\\..*).*)"],
};
