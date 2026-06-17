/** Discriminated union of every transactional email the platform can send. */
export type EmailJob =
  | { template: "verify_email"; to: string; userName: string; verifyUrl: string }
  | { template: "reset_password"; to: string; userName: string; resetUrl: string }
  | {
      template: "org_invitation";
      to: string;
      inviterName: string;
      organizationName: string;
      role: string;
      acceptUrl: string;
    }
  | { template: "welcome"; to: string; userName: string; dashboardUrl: string }
  // Monitoring / incident / status-page emails.
  | {
      template: "alert";
      to: string;
      monitorName: string;
      status: string;
      organizationName: string;
      timestamp: string;
      ctaUrl: string;
    }
  | {
      template: "incident";
      to: string;
      incidentTitle: string;
      severity: string;
      description: string;
      statusPageUrl: string;
    }
  | {
      template: "status_page_update";
      to: string;
      pageName: string;
      incidentTitle: string;
      statusChange: string;
      publicUrl: string;
    }
  // Public status-page subscriber emails (Phase 12).
  | { template: "status_subscribe_confirm"; to: string; pageName: string; confirmUrl: string }
  | {
      template: "status_incident_opened" | "status_incident_updated" | "status_incident_resolved";
      to: string;
      pageName: string;
      incidentTitle: string;
      statusLabel: string;
      body: string;
      publicUrl: string;
      unsubscribeUrl: string;
    };

export type EmailTemplate = EmailJob["template"];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface OutboundEmail extends RenderedEmail {
  to: string;
  /** Template name for provider logging/metrics labels. */
  template?: string;
}

export interface EmailSender {
  /** Resolves with a provider message id when available; throws on failure. */
  send(email: OutboundEmail): Promise<{ providerMessageId: string | null }>;
}
