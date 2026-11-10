import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isAiContentConsentFeature,
  type AiContentConsentFeature,
} from "@/lib/ai/contentSharingConsent";
import { createAiContentConsentRecord } from "@/lib/ai/contentSharingConsentServer";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) {
      return betaAccessErrorResponse(authorization);
    }
    const { user } = authorization;

    const body = await req.json();
    const feature = body.feature as AiContentConsentFeature;

    if (!isAiContentConsentFeature(feature)) {
      return NextResponse.json(
        { error: "Invalid AI content sharing consent feature." },
        { status: 400 }
      );
    }

    const consent = await createAiContentConsentRecord({
      userId: user.id,
      feature,
      request: req,
    });

    return NextResponse.json(consent);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to record AI content sharing consent.",
      },
      { status: 500 }
    );
  }
}
