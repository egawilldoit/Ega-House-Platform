import { NextResponse } from "next/server";

import { getMcpRuntimeConfig } from "@/lib/mcp/config";
import {
  buildConsentLoginPath,
  parseAuthorizationId,
  parseConsentDecision,
  requireSameOrigin,
} from "@/lib/oauth/consent";
import {
  processOAuthConsentDecision,
  type OAuthDecisionClient,
} from "@/lib/oauth/decision-service";
import { getCurrentIdentity } from "@/lib/services/auth-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirectToConsentError(
  request: Request,
  authorizationId: string,
): NextResponse {
  const target = new URL("/oauth/consent", request.url);
  target.searchParams.set("authorization_id", authorizationId);
  target.searchParams.set("error", "authorization_failed");
  return NextResponse.redirect(target, 303);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireSameOrigin(request);
  } catch {
    return NextResponse.json(
      { error: "Invalid OAuth consent origin." },
      { status: 403 },
    );
  }

  let authorizationId: string;
  let decision: "approve" | "deny";

  try {
    const formData = await request.formData();
    authorizationId = parseAuthorizationId(formData.get("authorization_id"));
    decision = parseConsentDecision(formData.get("decision"));
  } catch {
    return NextResponse.json(
      { error: "Invalid OAuth consent request." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const identity = await getCurrentIdentity({ supabase });

  if (!identity) {
    return NextResponse.redirect(
      new URL(buildConsentLoginPath(authorizationId), request.url),
      303,
    );
  }

  try {
    const config = decision === "approve" ? getMcpRuntimeConfig() : null;
    if (config && !config.enabled) {
      return redirectToConsentError(request, authorizationId);
    }

    const redirectUrl = await processOAuthConsentDecision({
      decision,
      authorizationId,
      ownerUserId: identity.id,
      resourceUri: config?.resource ?? "",
      oauth: supabase.auth.oauth as OAuthDecisionClient,
      admin: config ? createAdminClient() : undefined,
    });

    return NextResponse.redirect(redirectUrl, 303);
  } catch {
    return redirectToConsentError(request, authorizationId);
  }
}
