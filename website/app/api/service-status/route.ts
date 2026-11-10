import { NextResponse } from "next/server";
import { getServiceStatus } from "@/lib/serviceStatus";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getServiceStatus();
    return NextResponse.json(status, {
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json(
      {
        status: "unknown",
        message: null,
        detail: null,
        source: "none",
        checkedAt: new Date().toISOString(),
        cacheTtlSeconds: 180,
      },
      { status: 200 },
    );
  }
}
