"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Replay } from "@/components/replay";

function GameFromQuery() {
  const id = Number(useSearchParams().get("id"));
  if (!Number.isInteger(id) || id < 1) {
    return (
      <div className="p-8 text-center">
        <p className="fs-emph font-bold">No game chosen.</p>
        <Link href="/" className="text-gold underline">
          Back to library
        </Link>
      </div>
    );
  }
  return <Replay key={id} id={id} />;
}

export default function GamePage() {
  return (
    <Suspense fallback={<p className="p-8 text-center fs-body">Loading game…</p>}>
      <GameFromQuery />
    </Suspense>
  );
}
