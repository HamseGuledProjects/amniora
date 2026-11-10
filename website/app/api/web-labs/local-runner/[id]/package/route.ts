import { dispatchLocalRunnerProductRoute } from "@/lib/web-lab/local-runner-product-composition";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return dispatchLocalRunnerProductRoute("package", request, (await params).id);
}
