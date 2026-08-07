"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { HeroSequence } from "@/components/marketing/HeroSequence";
import { Spinner } from "@/components/ui/primitives";
import { useAuthStore } from "@/lib/stores/auth";

export default function HomePage() {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!hydrated) return;
    if (user) router.replace("/app");
  }, [hydrated, user, router]);

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Spinner className="h-8 w-8 border-brand-primary border-t-brand-secondary" />
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Spinner className="h-8 w-8 border-brand-primary border-t-brand-secondary" />
      </div>
    );
  }

  return (
    <HeroSequence
      onSignIn={() => router.push("/auth")}
      onCreate={() => router.push("/auth?mode=register")}
    />
  );
}
