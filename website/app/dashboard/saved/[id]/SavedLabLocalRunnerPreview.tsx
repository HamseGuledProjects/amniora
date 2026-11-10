"use client";

import { useSearchParams } from "next/navigation";
import SavedLabLocalRunner from "./SavedLabLocalRunner";

// Mounted only by the development branch of the real Saved page.
export default function SavedLabLocalRunnerPreview({ savedLabId, topic, onExecutableChange }: {
  savedLabId: string;
  topic: string;
  onExecutableChange?: (executable: boolean) => void;
}) {
  const searchParams = useSearchParams();
  const previewState = process.env.NODE_ENV === "development" && searchParams.getAll("runnerPreview").length === 1
    ? searchParams.get("runnerPreview") : null;
  return <SavedLabLocalRunner savedLabId={savedLabId} topic={topic} previewState={previewState} onExecutableChange={onExecutableChange} />;
}
