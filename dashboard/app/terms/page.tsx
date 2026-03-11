import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service — Agentobox",
  description: "Agentobox terms of service",
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-[13px] text-text-link hover:text-text-link-hover transition-colors mb-10"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to login
        </Link>

        <h1 className="text-2xl font-semibold text-default tracking-tight mb-2">Terms of Service</h1>
        <p className="text-[13px] text-muted mb-12">Last updated: March 2026</p>

        <div className="space-y-10 text-[14px] text-secondary leading-relaxed">
          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Agentobox ("the Service"), you agree to be bound by these Terms of Service.
              If you do not agree to these terms, do not use the Service. These terms apply to all users,
              including visitors, registered users, and anyone who accesses the Service.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">2. Description of Service</h2>
            <p>
              Agentobox is an AI agent management platform that provisions containerized AI agents with
              desktop environments, enables real-time observation via VNC, and coordinates multi-agent
              workflows. The Service provides a dashboard for managing, monitoring, and orchestrating
              these agents.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">3. User Accounts</h2>
            <p className="mb-2">
              You are responsible for maintaining the security of your account credentials and for all
              activity that occurs under your account. You agree to:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-secondary/90">
              <li>Provide accurate and complete registration information</li>
              <li>Keep your account credentials secure and confidential</li>
              <li>Notify us immediately of any unauthorized access or use of your account</li>
              <li>Accept responsibility for all activities conducted through your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">4. Acceptable Use</h2>
            <p className="mb-2">You agree not to use the Service to:</p>
            <ul className="list-disc pl-5 space-y-1.5 text-secondary/90">
              <li>Violate any applicable law, regulation, or third-party rights</li>
              <li>Engage in illegal activity or facilitate illegal transactions</li>
              <li>Circumvent, disable, or interfere with security features of the Service</li>
              <li>Attempt to gain unauthorized access to other users' accounts or data</li>
              <li>Distribute malware, viruses, or other harmful code</li>
              <li>Abuse, overload, or disrupt the Service infrastructure</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">5. Bring Your Own Key (BYOK)</h2>
            <p>
              The Service operates on a bring-your-own-key model. You provide your own API keys for
              third-party AI providers (e.g., Anthropic, OpenAI). You are solely responsible for your
              API key usage, associated costs, and compliance with the respective provider's terms of
              service. Agentobox does not control or assume liability for charges incurred through your
              API keys.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">6. Intellectual Property</h2>
            <p>
              You retain all rights to your data, code, and content processed through the Service.
              Agentobox owns all rights to the platform, including its software, design, branding,
              and documentation. Nothing in these terms transfers ownership of either party's
              intellectual property to the other.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">7. Service Availability</h2>
            <p>
              We strive to maintain high availability but do not guarantee uninterrupted or error-free
              operation. The Service is provided on a best-effort basis. We may perform maintenance,
              updates, or modifications that temporarily affect availability. We are not liable for
              any downtime, data loss, or service interruptions.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Agentobox and its officers, employees, and
              affiliates shall not be liable for any indirect, incidental, special, consequential, or
              punitive damages, including loss of profits, data, or business opportunities, arising
              from your use of the Service. Our total liability for any claim shall not exceed the
              amount you paid us in the twelve months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">9. Disclaimer of Warranties</h2>
            <p>
              The Service is provided "as is" and "as available" without warranties of any kind,
              whether express or implied, including but not limited to warranties of merchantability,
              fitness for a particular purpose, and non-infringement.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">10. Termination</h2>
            <p>
              We may suspend or terminate your access to the Service at any time, with or without cause,
              with or without notice. You may terminate your account at any time by contacting us.
              Upon termination, your right to use the Service ceases immediately. Provisions that by
              their nature should survive termination will survive, including ownership, warranty
              disclaimers, and limitations of liability.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">11. Changes to Terms</h2>
            <p>
              We may update these terms from time to time. Material changes will be communicated
              through the Service or via email. Your continued use of the Service after changes
              take effect constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">12. Governing Law</h2>
            <p>
              These terms are governed by the laws of the State of Delaware, United States, without
              regard to conflict of law principles. Any disputes arising from these terms or the
              Service shall be resolved in the courts located in Delaware.
            </p>
          </section>

          <section>
            <h2 className="text-[15px] font-medium text-default mb-3">13. Contact</h2>
            <p>
              If you have questions about these terms, contact us at{" "}
              <a href="mailto:support@agentobox.com" className="text-text-link hover:text-text-link-hover underline decoration-text-link/30 hover:decoration-text-link/60 transition-colors">
                support@agentobox.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
