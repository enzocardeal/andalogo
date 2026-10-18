import { Suspense } from "react";
import { TransitMap } from "@/components/transit-map";

export default function Home() {
  return (
    <main className="relative flex-1">
      <Suspense>
        <TransitMap />
      </Suspense>
    </main>
  );
}
