import { dispatchMyVmProductRoute } from "@/lib/web-lab/byo-runner/product-composition";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) { return dispatchMyVmProductRoute(request, (await params).id); }
export async function POST(request: Request, { params }: Context) { return dispatchMyVmProductRoute(request, (await params).id); }
