import { dispatchRunnerProtocolRoute } from "@/lib/web-lab/local-first-product/composition";
export const runtime = "nodejs";
const OPERATIONS = new Set(["pairing-begin", "pairing-complete", "redeem", "result", "unpair", "presence"] as const);
type RunnerOperation = "pairing-begin" | "pairing-complete" | "redeem" | "result" | "unpair" | "presence";
type Context = { params: Promise<{ operation: string }> };
export async function POST(request: Request, { params }: Context) {
  const operation = (await params).operation;
  if (!OPERATIONS.has(operation as RunnerOperation)) {
    return Response.json({ data: null, error: { code: "REQUEST_INVALID" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return dispatchRunnerProtocolRoute(operation as RunnerOperation, request);
}
