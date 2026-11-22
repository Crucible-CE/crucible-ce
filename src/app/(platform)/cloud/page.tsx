import { Radio, Scale, Smartphone, Bot, Gauge, Sparkles, FileStack, ListChecks, FileText, MessagesSquare, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ScreenshotLightbox, type Shot } from "@/components/cloud/screenshot-lightbox";
import { cloudTrialUrl } from "@/lib/cloud/notes";
import { CloudCallToAction } from "@/components/cloud/cloud-cta";

// The one Cloud showcase page in CE. Screenshots, not locked buttons: CE
// stays fully functional, and this page says plainly what the hosted
// platform adds on top. Exercises, after-action reports and improvement plans
// are in CE; Cloud adds the AI. The call to action links to CLOUD_TRIAL_URL
// (read on the server at request time) and reads "Coming soon" without it.
// Each card has an id so Cloud notes in the app can link to it.

export const dynamic = "force-dynamic";

interface Feature {
  id: string;
  icon: typeof Radio;
  title: string;
  blurb: string;
  shot: string;
  alt: string;
  /** Not in Cloud yet: the card always reads Coming soon. */
  roadmap?: true;
}

const PLATFORM: Feature[] = [
  {
    id: "hosted-delivery",
    icon: Radio,
    title: "Hosted out-of-band delivery",
    blurb: "Crucible Cloud hosts Crucible outside your network, with managed SMS and voice paging.",
    shot: "/cloud/messaging-dark.png",
    alt: "Managed paging in Crucible Cloud",
  },
  {
    id: "exo",
    icon: Bot,
    title: "Exo incident assistant",
    blurb: "Suggests next actions from your playbooks and drafts SITREPs, handovers, postmortems and stakeholder messages for you to review.",
    shot: "/cloud/war-room-dark.png",
    alt: "Incident view with a runbook and AI drafts",
  },
  {
    id: "regulatory",
    icon: Scale,
    title: "Regulatory response",
    blurb: "Notification deadlines (SEC, GDPR, HIPAA, state laws) and prefilled filing drafts from breach facts.",
    shot: "/cloud/filing-wizard.png",
    alt: "The regulatory filing wizard",
  },
  {
    id: "ai-posture",
    icon: Gauge,
    title: "AI posture insights",
    blurb: "Assesses likely threats from your organization profile, finds gaps in your documents and drafts new ones.",
    shot: "/cloud/executive-dashboard.png",
    alt: "Readiness with document analysis and generation",
  },
  {
    id: "mobile",
    icon: Smartphone,
    title: "Mobile companion",
    blurb: "Mobile app with push paging.",
    shot: "/cloud/mobile-companion.png",
    alt: "The mobile companion app",
  },
];

// Screenshots for these cards show Crucible Cloud (public/cloud/ai-*.png).
const EXERCISE_AI: Feature[] = [
  {
    id: "ai-crisis-sim",
    icon: Sparkles,
    title: "Crisis Sim generation",
    blurb: "Builds a full Crisis Sim from your organization profile, ready to edit.",
    shot: "/cloud/ai-crisis-sim.png",
    alt: "A Crisis Sim being generated",
  },
  {
    id: "ai-playbook",
    icon: FileStack,
    title: "Playbook to exercise",
    blurb: "Turns a playbook into modules, questions and criteria, and checks answers against your SOP.",
    shot: "/cloud/ai-playbook.png",
    alt: "A playbook turned into exercise modules",
  },
  {
    id: "ai-grading",
    icon: ListChecks,
    title: "AI grading",
    blurb: "Grades answers against the criteria and quotes the evidence.",
    shot: "/cloud/ai-grading.png",
    alt: "An answer graded with matched criteria and quotes",
  },
  {
    id: "ai-aar-draft",
    icon: FileText,
    title: "After-action report drafting",
    blurb: "Drafts strengths, areas for improvement and the summary from the exercise record for evaluators to review.",
    shot: "/cloud/ai-aar-draft.png",
    alt: "A drafted after-action report with evidence",
  },
  {
    id: "ai-transcript",
    icon: MessagesSquare,
    title: "Transcript reconciliation",
    blurb: "Matches a meeting transcript to the report and proposes work items with verified quotes.",
    shot: "/cloud/ai-transcript.png",
    alt: "Transcript proposals with quotes",
    roadmap: true,
  },
  {
    id: "ai-strategic-inject",
    icon: ShieldCheck,
    title: "AI injects held for review",
    blurb: "Writes the next Strategic TTX inject from how teams answered. A controller releases it.",
    shot: "/cloud/ai-strategic-inject.png",
    alt: "An AI inject waiting for controller review",
    roadmap: true,
  },
];

const ALL = [...PLATFORM, ...EXERCISE_AI];
const SHOTS: Shot[] = ALL.map((f) => ({ src: f.shot, alt: f.alt, title: f.title }));

function FeatureCard({ f }: { f: Feature }) {
  const Icon = f.icon;
  return (
    <Card id={f.id} className="scroll-mt-24 overflow-hidden" data-testid={`cloud-card-${f.id}`}>
      <ScreenshotLightbox shots={SHOTS} index={ALL.indexOf(f)} />
      <CardContent className="space-y-1.5 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-[color:var(--mist-indigo)]" />
          {f.title}
          {f.roadmap && (
            <span
              data-testid="cloud-card-roadmap"
              className="ml-auto rounded-full border border-[color:var(--mist-warn)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--mist-warn)]"
            >
              Coming soon
            </span>
          )}
        </h3>
        <p className="text-[12.5px] leading-relaxed text-[color:var(--color-muted-foreground)]">{f.blurb}</p>
      </CardContent>
    </Card>
  );
}

export default function CloudPage() {
  const trialUrl = cloudTrialUrl();
  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <div className="space-y-2">
        <h1 className="headline flex flex-wrap items-center gap-3">
          Crucible Cloud
          {!trialUrl && (
            <span
              data-testid="cloud-status"
              className="rounded-full border border-[color:var(--mist-warn)] px-2.5 py-0.5 text-[12px] font-semibold text-[color:var(--mist-warn)]"
            >
              Coming soon
            </span>
          )}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
          The hosted version of Crucible. Exercises, after-action reports and improvement plans are in CE. Cloud adds the features below.
        </p>
        <CloudCallToAction trialUrl={trialUrl} />
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Platform</h2>
        <div className="grid gap-5 md:grid-cols-2">
          {PLATFORM.map((f) => (
            <FeatureCard key={f.id} f={f} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">AI for exercises</h2>
        <p className="max-w-3xl text-[13px] text-[color:var(--color-muted-foreground)]">In CE these steps are done by hand. Cloud does them with AI, and people review the result.</p>
        <div className="grid gap-5 md:grid-cols-2">
          {EXERCISE_AI.map((f) => (
            <FeatureCard key={f.id} f={f} />
          ))}
        </div>
      </section>
    </div>
  );
}
