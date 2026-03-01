import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center text-center px-4">
      <div className="max-w-2xl space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">
          🛸 Orbit
        </h1>
        <p className="text-xl text-fd-muted-foreground">
          The open-source Internal Developer Portal that gives platform teams
          self-service infrastructure with guardrails.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-6 py-3 text-fd-primary-foreground font-medium hover:bg-fd-primary/90 transition-colors"
          >
            Read the Docs
          </Link>
          <Link
            href="https://github.com/drewpayment/orbit"
            className="rounded-lg border border-fd-border px-6 py-3 font-medium hover:bg-fd-accent transition-colors"
          >
            GitHub
          </Link>
        </div>
      </div>
    </main>
  );
}
