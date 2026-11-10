import { dispatchLocalRunnerProductRoute } from "@/lib/web-lab/local-runner-product-composition";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return dispatchLocalRunnerProductRoute("eligibility", request, (await params).id);
}
