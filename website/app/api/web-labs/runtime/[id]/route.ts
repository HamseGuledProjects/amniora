import { dispatchWebLabRuntimeRoute } from "@/lib/web-lab/runtime-route-handler";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return dispatchWebLabRuntimeRoute("status", request, (await params).id);
}

export async function DELETE(request: Request, { params }: Context) {
  return dispatchWebLabRuntimeRoute("destroy", request, (await params).id);
}
