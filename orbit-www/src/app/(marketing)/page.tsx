import Link from 'next/link'
import {
  Orbit,
  Sparkles,
  ArrowRight,
  Workflow,
  BookOpen,
  FileText,
  GitBranch,
} from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-10 py-4 backdrop-blur-md bg-[#0A0A0B]/80 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Orbit className="h-7 w-7 text-[var(--color-primary)]" />
          <span className="text-xl font-bold tracking-[4px] text-white">
            ORBIT
          </span>
        </div>
        <nav className="hidden md:flex items-center gap-8">
          <a
            href="#features"
            className="text-sm font-medium text-[#ADADB0] hover:text-white transition-colors"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="text-sm font-medium text-[#ADADB0] hover:text-white transition-colors"
          >
            How It Works
          </a>
          <a
            href="#get-started"
            className="text-sm font-medium text-[#ADADB0] hover:text-white transition-colors"
          >
            Get Started
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-medium text-white hover:text-[#ADADB0] transition-colors"
          >
            Log In
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-[var(--color-primary)] px-[18px] py-2 text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex flex-col items-center px-8 pt-20 pb-16 md:px-[120px] md:pt-20 md:pb-[60px] gap-8">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#1A1520_0%,_#0A0A0B_70%)]" />
        <div className="relative z-10 flex flex-col items-center gap-8 stagger-reveal">
          {/* Badge */}
          <div className="stagger-item flex items-center gap-2 rounded-full border border-[#FF5C0033] bg-[#FF5C0018] px-4 py-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-primary)]" />
            <span className="text-xs font-semibold tracking-wider text-[var(--color-primary)]">
              Internal Developer Portal
            </span>
          </div>

          {/* Headline */}
          <h1 className="stagger-item max-w-[900px] text-center font-[family-name:var(--font-instrument-serif)] text-5xl leading-tight tracking-tight md:text-[64px] md:leading-[1.1] md:tracking-[-1px]">
            Your engineering platform,
            <br />
            one portal.
          </h1>

          {/* Subheadline */}
          <p className="stagger-item max-w-[700px] text-center text-base leading-relaxed text-[#ADADB0] md:text-[19px] md:leading-[1.6]">
            Orbit gives platform teams a single pane of glass for services,
            APIs, Kafka topics, and documentation — so developers ship faster
            with guardrails, not gatekeepers.
          </p>

          {/* CTAs */}
          <div className="stagger-item flex items-center gap-4">
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-[10px] bg-[var(--color-primary)] px-7 py-3.5 text-[15px] font-semibold text-white hover:opacity-90 transition-opacity"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#how-it-works"
              className="rounded-[10px] border border-white/10 px-7 py-3.5 text-[15px] font-medium text-[#ADADB0] hover:border-white/20 hover:text-white transition-colors"
            >
              See How It Works
            </a>
          </div>

          {/* Screenshot Placeholder */}
          <div className="stagger-item mt-4 flex h-[400px] w-full max-w-[1100px] items-center justify-center rounded-xl border border-white/5 bg-[#141417] shadow-[0_20px_60px_-4px_rgba(255,92,0,0.08)] md:h-[620px]">
            <span className="text-base font-medium text-[#4A4A4E]">
              Product Screenshot
            </span>
          </div>
        </div>
      </section>

      {/* Gradient Divider */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Features */}
      <FeaturesSection />

      {/* Gradient Divider */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* How It Works */}
      <HowItWorksSection />

      {/* Gradient Divider */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Final CTA */}
      <FinalCTASection />

      {/* Footer */}
      <FooterSection />
    </div>
  )
}

/* --- Features Section --- */

const features = [
  {
    icon: Workflow,
    title: 'Kafka Self-Service',
    description:
      'Provision virtual clusters, manage topics, and enforce policies — without waiting on platform tickets.',
    color: 'var(--color-primary)',
    bgColor: '#FF5C0018',
  },
  {
    icon: BookOpen,
    title: 'API Catalog',
    description:
      'Discover, document, and govern every API across your organization with OpenAPI and AsyncAPI support.',
    color: '#3B82F6',
    bgColor: '#3B82F618',
  },
  {
    icon: FileText,
    title: 'Knowledge Hub',
    description:
      'Collaborative wikis with full-text search, so tribal knowledge becomes shared knowledge.',
    color: '#22C55E',
    bgColor: '#22C55E18',
  },
  {
    icon: GitBranch,
    title: 'GitOps Native',
    description:
      'Bidirectional sync with GitHub. Changes in UI commit to code, changes in code reflect in Orbit.',
    color: '#A855F7',
    bgColor: '#A855F718',
  },
] as const

function FeaturesSection() {
  return (
    <section
      id="features"
      className="flex flex-col items-center gap-12 px-8 py-20 md:px-[120px] md:py-20"
    >
      <div className="flex flex-col items-center gap-4">
        <span className="text-xs font-semibold tracking-[2px] text-[var(--color-primary)]">
          CAPABILITIES
        </span>
        <h2 className="text-center font-[family-name:var(--font-instrument-serif)] text-3xl tracking-tight md:text-[40px] md:tracking-[-0.5px]">
          Everything your platform team needs
        </h2>
        <p className="text-center text-[17px] text-[#8B8B90]">
          From Kafka provisioning to API documentation — one portal to rule them
          all.
        </p>
      </div>

      <div className="grid w-full max-w-[1200px] grid-cols-1 gap-4 md:grid-cols-2">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="flex flex-col gap-4 rounded-xl border border-white/5 bg-[#141417] p-7"
          >
            <div
              className="flex h-11 w-11 items-center justify-center rounded-[10px]"
              style={{ backgroundColor: feature.bgColor }}
            >
              <feature.icon
                className="h-[22px] w-[22px]"
                style={{ color: feature.color }}
              />
            </div>
            <h3 className="text-lg font-semibold">{feature.title}</h3>
            <p className="text-sm leading-relaxed text-[#8B8B90]">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* --- How It Works Section --- */

const steps = [
  {
    number: '1',
    title: 'Connect',
    description: 'Link your GitHub repos and infrastructure in minutes.',
    color: 'var(--color-primary)',
    bgColor: '#FF5C0018',
    borderColor: '#FF5C0033',
  },
  {
    number: '2',
    title: 'Catalog',
    description:
      'Orbit discovers your APIs, services, and Kafka topics automatically.',
    color: '#3B82F6',
    bgColor: '#3B82F618',
    borderColor: '#3B82F633',
  },
  {
    number: '3',
    title: 'Govern',
    description:
      'Set policies, manage access, and let developers self-serve safely.',
    color: '#22C55E',
    bgColor: '#22C55E18',
    borderColor: '#22C55E33',
  },
] as const

function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="flex flex-col items-center gap-14 px-8 py-20 md:px-[120px] md:py-20"
    >
      <div className="flex flex-col items-center gap-4">
        <span className="text-xs font-semibold tracking-[2px] text-[var(--color-primary)]">
          HOW IT WORKS
        </span>
        <h2 className="font-[family-name:var(--font-instrument-serif)] text-3xl tracking-tight md:text-[40px] md:tracking-[-0.5px]">
          Up and running in minutes
        </h2>
      </div>

      <div className="grid w-full max-w-[1000px] grid-cols-1 gap-8 md:grid-cols-3">
        {steps.map((step) => (
          <div
            key={step.number}
            className="flex flex-col items-center gap-5"
          >
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full border"
              style={{
                backgroundColor: step.bgColor,
                borderColor: step.borderColor,
              }}
            >
              <span
                className="text-[22px] font-bold"
                style={{ color: step.color }}
              >
                {step.number}
              </span>
            </div>
            <h3 className="text-xl font-semibold">{step.title}</h3>
            <p className="max-w-[280px] text-center text-[15px] leading-relaxed text-[#8B8B90]">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* --- Final CTA Section --- */

function FinalCTASection() {
  return (
    <section
      id="get-started"
      className="relative flex flex-col items-center gap-8 px-8 py-24 md:px-[120px] md:py-[100px]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#1A1218_0%,_#0A0A0B_70%)]" />
      <div className="relative z-10 flex flex-col items-center gap-8">
        <h2 className="max-w-[700px] text-center font-[family-name:var(--font-instrument-serif)] text-3xl leading-tight md:text-5xl md:leading-[1.15] md:tracking-[-0.5px]">
          Ready to bring order
          <br />
          to your platform?
        </h2>
        <p className="text-center text-lg text-[#8B8B90]">
          Start building your Internal Developer Portal today.
        </p>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-[10px] bg-[var(--color-primary)] px-8 py-4 text-base font-semibold text-white hover:opacity-90 transition-opacity"
          >
            Get Started
            <ArrowRight className="h-[18px] w-[18px]" />
          </Link>
          <Link
            href="/login"
            className="text-[15px] font-medium text-[#ADADB0] hover:text-white transition-colors"
          >
            or Log In →
          </Link>
        </div>
      </div>
    </section>
  )
}

/* --- Footer --- */

function FooterSection() {
  return (
    <footer className="flex flex-col gap-6 px-10 py-8">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <Orbit className="h-5 w-5 text-[#6B6B70]" />
          <span className="text-sm font-semibold text-[#6B6B70]">Orbit</span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="#"
            className="text-[13px] text-[#4A4A4E] hover:text-[#8B8B90] transition-colors"
          >
            Privacy
          </a>
          <a
            href="#"
            className="text-[13px] text-[#4A4A4E] hover:text-[#8B8B90] transition-colors"
          >
            Terms
          </a>
          <a
            href="#"
            className="text-[13px] text-[#4A4A4E] hover:text-[#8B8B90] transition-colors"
          >
            Documentation
          </a>
        </div>
      </div>
      <div className="h-px w-full bg-[#1F1F23]" />
      <p className="text-xs text-[#4A4A4E]">
        © 2026 Orbit. All rights reserved.
      </p>
    </footer>
  )
}
