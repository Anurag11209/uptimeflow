import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="font-[family-name:var(--font-mono)] text-sm uppercase tracking-wide text-brand">404</p>
      <h1 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold text-text">
        Status page not found
      </h1>
      <p className="mt-2 text-sm text-muted">
        This status page does not exist, is private, or has been removed.
      </p>
      <Link href="/" className="mt-6 text-sm font-medium text-brand hover:underline">
        Go home
      </Link>
    </main>
  );
}
