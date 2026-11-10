import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { Mail, Send, ShieldCheck } from "lucide-react";
import { ProductHero, ProductPageShell, ProductSection } from "../components/public/ProductPage";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Textarea from "../components/ui/Textarea";

export const metadata: Metadata = publicPageMetadata({
  title: "Project Contact Status",
  description:
    "Amniora is cancelled. This portfolio preserves the contact interface with its submission controls disabled.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <ProductPageShell>
      <ProductHero
        eyebrow="Support status"
        title="Amniora is cancelled."
        description="This page preserves the original support layout for review. There is no active product support inbox or message service."
        primaryLabel="View project history"
        primaryHref="/development-log"
        secondaryLabel="Open local demo"
        secondaryHref="/dashboard"
      />

      <ProductSection
        eyebrow="Preserved interface"
        title="How support was represented"
        description="The panels below show the original support concepts. No request is sent from this local demo."
      >
        <div className="grid gap-space-5 md:grid-cols-3">
          <article className="border-l border-primary pl-space-5">
            <ShieldCheck size={20} className="text-primary" aria-hidden="true" />
            <h2 className="mt-space-3 type-card-title text-heading">Saved-lab reports</h2>
            <p className="mt-space-2 text-sm leading-6 text-text-secondary">The demo can show a local report confirmation. No report reaches a support team.</p>
          </article>
          <article className="border-l border-border-strong pl-space-5">
            <Mail size={19} aria-hidden="true" className="text-primary" />
            <h2 className="mt-space-3 type-card-title text-heading">Email support unavailable</h2>
            <p className="mt-space-2 break-all text-sm font-medium text-text-secondary">No support address published</p>
            <p className="mt-space-2 text-xs leading-5 text-text-muted">The historical address has been removed from this portfolio.</p>
          </article>
          <article className="border-l border-border-strong pl-space-5">
            <h2 className="type-card-title text-heading">Security reports</h2>
            <p className="mt-space-2 text-sm leading-6 text-text-secondary">For source-review context, see the repository security documentation. This form cannot receive security reports.</p>
          </article>
        </div>
      </ProductSection>

      <ProductSection
        muted
        eyebrow="Disabled"
        title="Message form preview"
        description="The original message form is preserved as a disabled interface example. It does not collect or send messages."
      >
        <div className="grid gap-space-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(240px,0.28fr)] lg:items-start">
          <div className="border-y border-border bg-white px-space-4 py-space-5 sm:px-space-5">
            <div className="flex flex-col gap-space-2 border-b border-border pb-space-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-heading">Send a message</h2>
                <p id="contact-form-status" className="mt-space-1 text-sm leading-6 text-text-secondary">Disabled. The form is disabled.</p>
              </div>
              <Button type="button" disabled aria-disabled="true" leadingIcon={<Send size={16} aria-hidden="true" />}>
                Disabled
              </Button>
            </div>
            <fieldset disabled aria-disabled="true" aria-describedby="contact-form-status" className="mt-space-5 space-y-space-4 opacity-60">
              <div className="grid gap-space-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="contact-name" className="text-sm font-medium text-text">Full name</label>
                  <Input id="contact-name" type="text" placeholder="Your name" autoComplete="name" className="mt-space-2" />
                </div>
                <div>
                  <label htmlFor="contact-email" className="text-sm font-medium text-text">Email address</label>
                  <Input id="contact-email" type="email" placeholder="you@example.com" autoComplete="email" className="mt-space-2" />
                </div>
              </div>
              <div>
                <label htmlFor="contact-subject" className="text-sm font-medium text-text">Subject</label>
                <Input id="contact-subject" type="text" placeholder="How can we help?" className="mt-space-2" />
              </div>
              <div>
                <label htmlFor="contact-message" className="text-sm font-medium text-text">Message</label>
                <Textarea id="contact-message" rows={4} placeholder="Write your message..." className="mt-space-2" />
              </div>
            </fieldset>
          </div>
          <p className="border-l border-border-strong pl-space-4 text-sm leading-6 text-text-secondary">
            This project has ended. The local example does not provide an account, email support or a message queue.
          </p>
        </div>
      </ProductSection>
    </ProductPageShell>
  );
}