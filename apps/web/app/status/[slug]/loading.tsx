export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14" aria-busy="true" aria-label="Loading status">
      <div className="h-4 w-32 animate-pulse rounded bg-line-soft" />
      <div className="mt-4 h-8 w-2/3 animate-pulse rounded bg-line-soft" />
      <div className="mt-6 h-20 animate-pulse rounded-lg bg-panel" />
      <div className="mt-8 flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-panel" />
        ))}
      </div>
    </main>
  );
}
