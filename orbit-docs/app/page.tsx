import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center text-center px-4 bg-fd-background">
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center justify-center gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-fd-primary"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M18 12c0 3.31-2.69 6-6 6s-6-2.69-6-6" />
            <path d="M12 2a7 7 0 0 1 7 7" />
            <circle cx="12" cy="12" r="2" />
          </svg>
          <h1 className="text-5xl font-bold tracking-[6px]">
            ORBIT
          </h1>
        </div>
        <p className="text-xl text-fd-muted-foreground">
          Your engineering platform, one portal.
        </p>
        <p className="text-fd-muted-foreground max-w-lg mx-auto">
          Orbit gives platform teams a single pane of glass for services, APIs,
          Kafka topics, and documentation — so developers ship faster with
          guardrails, not gatekeepers.
        </p>
        <div className="flex gap-4 justify-center pt-4">
          <Link
            href="/docs"
            className="rounded-lg px-6 py-3 font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'oklch(0.646 0.222 41.116)', color: 'oklch(0.98 0.016 73.684)' }}
          >
            Get Started →
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
