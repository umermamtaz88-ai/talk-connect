"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { useAuthStore } from "@/lib/stores/auth";
import { Spinner } from "@/components/ui/primitives";
import { Suspense } from "react";

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const mode = params.get("mode");

  useEffect(() => {
    if (hydrated && user) router.replace("/app");
  }, [hydrated, user, router]);

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Spinner className="h-8 w-8 border-brand-primary border-t-brand-secondary" />
      </div>
    );
  }

  return <AuthForm initialStep={mode === "register" ? "register" : "login"} />;
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-canvas">
          <Spinner className="h-8 w-8 border-brand-primary border-t-brand-secondary" />
        </div>
      }
    >
      <AuthInner />
    </Suspense>
  );
}
