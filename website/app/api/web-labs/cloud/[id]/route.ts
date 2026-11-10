import { dispatchCloudProductRoute } from "@/lib/web-lab/cloud-runtime/product-composition";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return dispatchCloudProductRoute(request, (await params).id);
}
export async function POST(request: Request, { params }: Context) {
  return dispatchCloudProductRoute(request, (await params).id);
}
