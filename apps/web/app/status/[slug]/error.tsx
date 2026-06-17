"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-text">
        Couldn’t load status
      </h1>
      <p className="mt-2 text-sm text-muted">
        We hit a problem fetching this status page. Please try again in a moment.
      </p>
      <button
        onClick={reset}
        className="mt-6 inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-semibold text-ink hover:brightness-110"
      >
        Retry
      </button>
    </main>
  );
}
