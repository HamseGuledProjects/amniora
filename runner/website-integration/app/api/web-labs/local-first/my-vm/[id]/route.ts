import { dispatchOwnerProductRoute } from "@/lib/web-lab/local-first-product/composition";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) { return dispatchOwnerProductRoute(request, (await params).id); }
export async function POST(request: Request, { params }: Context) { return dispatchOwnerProductRoute(request, (await params).id); }
