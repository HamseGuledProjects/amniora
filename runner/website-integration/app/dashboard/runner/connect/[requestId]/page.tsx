import { Suspense } from "react";
import PairingApprovalClient from "./PairingApprovalClient";

export default function RunnerPairingPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#03101d] p-12 text-slate-300">Loading Runner connection…</main>}>
    <PairingApprovalClient />
  </Suspense>;
}
