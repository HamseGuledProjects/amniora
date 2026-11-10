import { dispatchPairingApprovalRoute } from "@/lib/web-lab/local-first-product/composition";
export const runtime = "nodejs";
export async function GET(request: Request) { return dispatchPairingApprovalRoute(request); }
export async function POST(request: Request) { return dispatchPairingApprovalRoute(request); }
