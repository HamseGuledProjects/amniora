"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
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
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif", background: "#e7edf5", color: "#0f172a" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", boxSizing: "border-box" }}>
          <section style={{ width: "100%", maxWidth: "520px", border: "1px solid #bcc8d6", borderRadius: "10px", background: "#fff", padding: "32px", textAlign: "center", boxSizing: "border-box", boxShadow: "0 18px 50px rgb(15 23 42 / 0.18)" }}>
            <p style={{ margin: 0, color: "#1267f5", fontSize: "12px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Amniora</p>
            <h1 style={{ margin: "12px 0 0", fontSize: "30px", lineHeight: 1.2 }}>We couldn&apos;t load this page</h1>
            <p style={{ margin: "14px auto 0", maxWidth: "420px", color: "#475569", fontSize: "14px", lineHeight: 1.6 }}>An unexpected error occurred. Try again, or return to the homepage.</p>
            <div style={{ marginTop: "24px", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px" }}>
              <Link href="/" style={{ display: "inline-flex", minHeight: "40px", alignItems: "center", border: "1px solid #bcc8d6", borderRadius: "8px", padding: "0 16px", color: "#0f172a", textDecoration: "none", fontSize: "14px", fontWeight: 600 }}>Return home</Link>
              <button type="button" onClick={reset} style={{ minHeight: "40px", border: "1px solid #1267f5", borderRadius: "8px", background: "#1267f5", padding: "0 16px", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>Try again</button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
