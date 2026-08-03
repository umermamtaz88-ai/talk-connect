"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/stores/auth";
import { Spinner } from "@/components/ui/primitives";

export default function HomePage() {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!hydrated) return;
    router.replace(user ? "/app" : "/auth");
  }, [hydrated, user, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-canvas">
      <Spinner className="h-8 w-8 border-brand-primary border-t-brand-secondary" />
    </div>
  );
}
