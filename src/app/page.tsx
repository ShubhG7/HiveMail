import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { 
  Mail, Sparkles, Shield, Zap, Search, MessageSquare, 
  Settings, CheckCircle2, ArrowRight, Key, BarChart3,
  FileText, Send, Filter, BookOpen
} from "lucide-react";

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
              Get Started Free
            </Button>
          </Link>
          <Link href="#onboarding">
            <Button size="lg" variant="outline" className="text-lg px-8">
              How It Works
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto px-4 py-24">
        <h2 className="text-3xl font-bold text-center mb-4">
          Everything you need to manage your inbox
        </h2>
        <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
          Powerful AI features that work with your own API key for privacy and cost control
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={<Sparkles className="w-6 h-6" />}
            title="Smart Categorization"
            description="AI automatically sorts your emails into categories like Hiring, Bills, Receipts, Newsletters, and more. Never lose track of important messages."
          />
          <FeatureCard
            icon={<Zap className="w-6 h-6" />}
            title="Instant Summaries"
            description="Get the gist of long email threads in seconds. Know what's important without reading everything. Perfect for catching up on long conversations."
          />
          <FeatureCard
            icon={<Search className="w-6 h-6" />}
            title="Natural Language Search"
            description="Ask questions about your emails in plain English. 'Show me invoices from last month' or 'What did Sarah say about the meeting?'"
          />
          <FeatureCard
            icon={<FileText className="w-6 h-6" />}
            title="Entity Extraction"
            description="Automatically extract tasks, deadlines, people, organizations, and key facts from your emails. Never miss an action item."
          />
          <FeatureCard
            icon={<Send className="w-6 h-6" />}
            title="AI Reply Drafts"
            description="Get intelligent reply suggestions based on email context. Review, edit, and send - all with your preferred tone and style."
          />
          <FeatureCard
            icon={<Shield className="w-6 h-6" />}
            title="Privacy First"
            description="Bring your own API key. Your data stays private and secure with AES-256-GCM encryption. You control your costs and data."
          />
          <FeatureCard
            icon={<BarChart3 className="w-6 h-6" />}
            title="Email Analytics"
            description="See your email patterns at a glance. Category breakdowns, reply rates, and priority insights help you stay organized."
          />
          <FeatureCard
            icon={<Filter className="w-6 h-6" />}
            title="Smart Filtering"
            description="Filter by category, priority, date range, or sender. Find exactly what you need with powerful search and filter options."
          />
          <FeatureCard
            icon={<MessageSquare className="w-6 h-6" />}
            title="Thread Management"
            description="View complete email threads with all participants. See the full conversation context and reply history in one place."
          />
        </div>
      </section>

      {/* Onboarding Guide */}
      <section id="onboarding" className="container mx-auto px-4 py-24 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            Getting Started Guide
          </h2>
          <p className="text-center text-muted-foreground mb-12">
            Follow these steps to set up and start using Hivemail
          </p>

          {/* Step 1: Sign In */}
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg shrink-0">
                1
              </div>
              <h3 className="text-2xl font-bold">Sign In with Google</h3>
            </div>
            <div className="ml-16 space-y-4">
              <p className="text-muted-foreground">
                Connect your Gmail account to get started. We use Google OAuth for secure authentication.
              </p>
              <div className="bg-card border rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium mb-1">What we access:</p>
                    <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                      <li>Read your emails (for categorization and search)</li>
                      <li>Send emails (only if you enable AI reply drafts)</li>
                    </ul>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ArrowRight className="w-4 h-4" />
                <span>Click &quot;Get Started&quot; above to begin</span>
              </div>
            </div>
          </div>

          {/* Step 2: Add API Key */}
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg shrink-0">
                2
              </div>
              <h3 className="text-2xl font-bold">Add Your LLM API Key</h3>
            </div>
            <div className="ml-16 space-y-4">
              <p className="text-muted-foreground">
                Hivemail uses your own API key for AI features. This keeps your data private and gives you control over costs.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-card border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Key className="w-5 h-5 text-primary" />
                    <h4 className="font-semibold">Supported Providers</h4>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Google Gemini (2.5 Flash/Pro)</li>
                    <li>• OpenAI (GPT-4, GPT-3.5)</li>
                    <li>• Anthropic (Claude 3.5 Sonnet)</li>
                    <li>• Custom OpenAI-compatible APIs</li>
                  </ul>
                </div>
                <div className="bg-card border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-5 h-5 text-primary" />
                    <h4 className="font-semibold">Security</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Your API key is encrypted with AES-256-GCM and stored securely. We never see your key in plain text.
                  </p>
                </div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm">
                  <strong>Where to find API keys:</strong>
                </p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1 ml-4 list-disc">
                  <li>Gemini: <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google AI Studio</a></li>
                  <li>OpenAI: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OpenAI Platform</a></li>
                  <li>Anthropic: <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Anthropic Console</a></li>
                </ul>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ArrowRight className="w-4 h-4" />
                <span>Go to Settings → LLM Configuration to add your key</span>
              </div>
            </div>
          </div>

          {/* Step 3: Sync Emails */}
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg shrink-0">
                3
              </div>
              <h3 className="text-2xl font-bold">Sync Your Emails</h3>
            </div>
            <div className="ml-16 space-y-4">
              <p className="text-muted-foreground">
                After adding your API key, trigger your first email sync. We&apos;ll fetch and process your recent emails.
              </p>
              <div className="bg-card border rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium mb-1">What happens during sync:</p>
                    <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                      <li>Emails are fetched from Gmail</li>
                      <li>AI categorizes each email automatically</li>
                      <li>Threads are summarized for quick scanning</li>
                      <li>Entities (people, dates, tasks) are extracted</li>
                      <li>Emails are made searchable with vector embeddings</li>
                    </ul>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ArrowRight className="w-4 h-4" />
                <span>Go to Dashboard and click &quot;Sync Emails&quot; to start</span>
              </div>
            </div>
          </div>

          {/* Step 4: Using Features */}
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg shrink-0">
                4
              </div>
              <h3 className="text-2xl font-bold">Using Hivemail Features</h3>
            </div>
            <div className="ml-16 space-y-6">
              <FeatureGuide
                icon={<Mail className="w-5 h-5" />}
                title="Inbox"
                description="View all your emails organized by category. Click any email to see full details, summary, and extracted information."
                tips={[
                  "Use the category filter to find specific types of emails",
                  "Click on an email to see AI-generated summary and extracted entities",
                  "Star important emails for quick access"
                ]}
              />
              <FeatureGuide
                icon={<Search className="w-5 h-5" />}
                title="Chat Interface"
                description="Ask questions about your emails in natural language. The AI searches through your emails and provides answers with citations."
                tips={[
                  "Try: 'Show me emails from last week about invoices'",
                  "Ask: 'What did John say about the project deadline?'",
                  "Search: 'Find all emails mentioning the conference'"
                ]}
              />
              <FeatureGuide
                icon={<BarChart3 className="w-5 h-5" />}
                title="Dashboard"
                description="See overview statistics, category breakdown, and recent activity. Monitor your email health at a glance."
                tips={[
                  "Check category distribution to understand your email patterns",
                  "Review priority emails that need replies",
                  "Monitor sync status and processing jobs"
                ]}
              />
              <FeatureGuide
                icon={<Send className="w-5 h-5" />}
                title="AI Reply Drafts"
                description="Get AI-generated reply suggestions based on the email thread. Review and edit before sending."
                tips={[
                  "Enable in Settings → AI Reply Drafts",
                  "Review all drafts before sending",
                  "Customize tone and instructions per reply"
                ]}
              />
            </div>
          </div>

          {/* Tips & Best Practices */}
          <div className="bg-card border rounded-xl p-8">
            <div className="flex items-center gap-3 mb-6">
              <BookOpen className="w-6 h-6 text-primary" />
              <h3 className="text-2xl font-bold">Tips & Best Practices</h3>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-2">Cost Management</h4>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                  <li>Start with Gemini 2.5 Flash for cost-effective processing</li>
                  <li>Monitor your API usage in your provider dashboard</li>
                  <li>Use redaction modes to reduce token usage</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Privacy Settings</h4>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                  <li>Enable redaction to protect sensitive data</li>
                  <li>Use &quot;Summaries Only&quot; mode for maximum privacy</li>
                  <li>Review extracted entities before sharing</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Sync Settings</h4>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                  <li>Initial sync processes last 30 days by default</li>
                  <li>Incremental syncs run automatically</li>
                  <li>Exclude SPAM and TRASH labels for cleaner data</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Troubleshooting</h4>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                  <li>Check API key status in Settings</li>
                  <li>Review error messages for rate limits</li>
                  <li>Verify Gmail permissions if sync fails</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-24 text-center">
        <h2 className="text-3xl font-bold mb-4">Ready to transform your inbox?</h2>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
          Join users who are already managing their emails smarter with AI. 
          Get started in minutes - just sign in and add your API key.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/auth/signin">
            <Button size="lg" className="text-lg px-8">
              Get Started Free
            </Button>
          </Link>
          <Link href="#onboarding">
            <Button size="lg" variant="outline" className="text-lg px-8">
              Review Setup Guide
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Hivemail - AI-powered email CRM</p>
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

function FeatureGuide({
  icon,
  title,
  description,
  tips,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  tips: string[];
}) {
  return (
    <div className="bg-card border rounded-lg p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
        <h4 className="font-semibold text-lg">{title}</h4>
      </div>
      <p className="text-muted-foreground mb-4">{description}</p>
      <div className="bg-muted/50 rounded-lg p-4">
        <p className="text-sm font-medium mb-2">Quick tips:</p>
        <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
          {tips.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
