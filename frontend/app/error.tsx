"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <h1 className="font-display text-xl font-semibold text-text-primary">
        Something went wrong
      </h1>
      <p className="max-w-sm text-sm text-text-muted">
        {error.message || "This screen failed to load. You can try again."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-medium text-white"
      >
        Try again
      </button>
    </div>
  );
}
