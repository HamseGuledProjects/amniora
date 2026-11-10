import { dispatchWebLabRuntimeRoute } from "@/lib/web-lab/runtime-route-handler";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return dispatchWebLabRuntimeRoute("exchange", request);
}
