"use client";

import { useEffect } from "react";
import PublicErrorPage from "./components/errors/PublicErrorPage";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PublicErrorPage
      label="Something went wrong"
      title="We couldn't load this page"
      description="An unexpected error occurred. Try again, or return to the homepage."
      onRetry={reset}
      secondaryHref="/"
      secondaryLabel="Return home"
    />
  );
}
