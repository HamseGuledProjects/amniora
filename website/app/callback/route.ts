import { NextResponse } from "next/server";
import { createClient } from "../../lib/supabase/server";
import {
  PASSWORD_RECOVERY_INVALID_PARAM,
  PASSWORD_RECOVERY_PATH,
  PASSWORD_RECOVERY_VERIFIED_PARAM,
  sanitizePasswordRecoveryReturnPath,
} from "../../lib/auth/passwordRecovery";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const recoveryPath = sanitizePasswordRecoveryReturnPath(
    requestUrl.searchParams.get("next"),
  );
  const destination = new URL(
    recoveryPath ?? "/dashboard",
    requestUrl.origin,
  );

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error && recoveryPath === PASSWORD_RECOVERY_PATH) {
      destination.searchParams.set("recovery", PASSWORD_RECOVERY_INVALID_PARAM);
    } else if (recoveryPath === PASSWORD_RECOVERY_PATH) {
      destination.searchParams.set("recovery", PASSWORD_RECOVERY_VERIFIED_PARAM);
    }
  } else if (recoveryPath === PASSWORD_RECOVERY_PATH) {
    destination.searchParams.set("recovery", PASSWORD_RECOVERY_INVALID_PARAM);
  }

  return NextResponse.redirect(destination);
}
