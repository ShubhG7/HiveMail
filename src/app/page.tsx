import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Mail, Sparkles, Shield, Zap } from "lucide-react";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    redirect("/inbox");
  }

  return (
    <div className="min-h-screen bg-gradient-radial">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Mail className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-xl">Hivemail</span>
          </div>
          <Link href="/auth/signin">
            <Button>Sign In</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-4 py-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
          <Sparkles className="w-4 h-4" />
          AI-Powered Email Management
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
          Your Personal
          <br />
          <span className="text-primary">Email CRM</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Automatically categorize, summarize, and search your emails with AI.
          Draft intelligent replies and never miss an important message again.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/auth/signin">
            <Button size="lg" className="text-lg px-8">
              Get Started
            </Button>
          </Link>
          <Link href="#features">
            <Button size="lg" variant="outline" className="text-lg px-8">
              Learn More
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto px-4 py-24">
        <h2 className="text-3xl font-bold text-center mb-12">
          Everything you need to manage your inbox
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          <FeatureCard
            icon={<Sparkles className="w-6 h-6" />}
            title="Smart Categorization"
            description="AI automatically sorts your emails into categories like Hiring, Bills, Receipts, and more."
          />
          <FeatureCard
            icon={<Zap className="w-6 h-6" />}
            title="Instant Summaries"
            description="Get the gist of long email threads in seconds. Know what's important without reading everything."
          />
          <FeatureCard
            icon={<Shield className="w-6 h-6" />}
            title="Privacy First"
            description="Bring your own API key. Your data stays private and secure with encrypted storage."
          />
        </div>
      </section>

      {/* How it works */}
      <section className="container mx-auto px-4 py-24 bg-muted/30">
        <h2 className="text-3xl font-bold text-center mb-12">
          How it works
        </h2>
        <div className="max-w-3xl mx-auto">
          <Step
            number={1}
            title="Connect your Gmail"
            description="Sign in with Google OAuth. We only request read access to your emails."
          />
          <Step
            number={2}
            title="Add your LLM API key"
            description="Bring your own Gemini API key. Your key is encrypted and never shared."
          />
          <Step
            number={3}
            title="Let AI organize"
            description="Watch as your emails are categorized, summarized, and made searchable."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-24 text-center">
        <h2 className="text-3xl font-bold mb-4">Ready to take control?</h2>
        <p className="text-lg text-muted-foreground mb-8">
          Self-host or deploy to Vercel in minutes.
        </p>
        <Link href="/auth/signin">
          <Button size="lg" className="text-lg px-8">
            Start Free
          </Button>
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Hivemail - Open source email CRM</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-xl border bg-card">
      <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-semibold text-lg mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 mb-8 last:mb-0">
      <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold shrink-0">
        {number}
      </div>
      <div>
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
