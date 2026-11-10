import { dispatchWebLabRuntimeRoute } from "@/lib/web-lab/runtime-route-handler";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return dispatchWebLabRuntimeRoute("reset", request, (await params).id);
}
