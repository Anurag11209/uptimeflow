import type { EmailJob, RenderedEmail } from "../types.js";

const BRAND = {
  name: "Backend Uptime",
  ink: "#0A0F1C",
  panel: "#101725",
  line: "#22304A",
  text: "#E7ECF5",
  muted: "#94A1B8",
  accent: "#FFB224",
};

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${BRAND.ink};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.ink};padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:12px;">
          <tr><td style="padding:28px 32px 0;">
            <div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:12px;letter-spacing:0.14em;color:${BRAND.accent};text-transform:uppercase;">Backend Uptime</div>
            <h1 style="margin:14px 0 0;font-size:21px;line-height:1.35;color:${BRAND.text};font-weight:600;">${title}</h1>
          </td></tr>
          <tr><td style="padding:18px 32px 28px;color:${BRAND.muted};font-size:14px;line-height:1.65;">
            ${bodyHtml}
          </td></tr>
        </table>
        <p style="max-width:520px;margin:16px auto 0;color:#5B677C;font-size:12px;line-height:1.6;">
          You received this email because of activity on a ${BRAND.name} account.
          If this wasn't you, you can safely ignore it.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="background:${BRAND.accent};border-radius:8px;">
    <a href="${url}" style="display:inline-block;padding:11px 22px;color:#1A1304;font-size:14px;font-weight:600;text-decoration:none;">${label}</a>
  </td></tr></table>
  <p style="margin:0;color:#5B677C;font-size:12px;word-break:break-all;">Or paste this link into your browser:<br/>${url}</p>`;
}

export function renderEmail(job: EmailJob): RenderedEmail {
  switch (job.template) {
    case "verify_email":
      return {
        subject: "Verify your email address",
        html: layout(
          "Confirm it's you",
          `<p style="margin:0;">Hi ${escapeHtml(job.userName)}, confirm your email address to finish setting up your ${BRAND.name} account. The link expires in 1 hour.</p>${button("Verify email", job.verifyUrl)}`,
        ),
        text: `Hi ${job.userName},\n\nConfirm your email address to finish setting up your ${BRAND.name} account (link expires in 1 hour):\n${job.verifyUrl}\n\nIf this wasn't you, ignore this email.`,
      };
    case "reset_password":
      return {
        subject: "Reset your password",
        html: layout(
          "Reset your password",
          `<p style="margin:0;">Hi ${escapeHtml(job.userName)}, we received a request to reset your password. The link expires in 1 hour. If this wasn't you, no action is needed — your password is unchanged.</p>${button("Choose a new password", job.resetUrl)}`,
        ),
        text: `Hi ${job.userName},\n\nReset your ${BRAND.name} password (link expires in 1 hour):\n${job.resetUrl}\n\nIf this wasn't you, no action is needed.`,
      };
    case "org_invitation":
      return {
        subject: `${job.inviterName} invited you to ${job.organizationName}`,
        html: layout(
          `Join ${escapeHtml(job.organizationName)}`,
          `<p style="margin:0;">${escapeHtml(job.inviterName)} invited you to join <strong style="color:${BRAND.text};">${escapeHtml(job.organizationName)}</strong> on ${BRAND.name} as <span style="font-family:Menlo,Consolas,monospace;color:${BRAND.accent};">${escapeHtml(job.role)}</span>. The invitation expires in 7 days.</p>${button("Accept invitation", job.acceptUrl)}`,
        ),
        text: `${job.inviterName} invited you to join ${job.organizationName} on ${BRAND.name} as ${job.role}.\n\nAccept (expires in 7 days):\n${job.acceptUrl}`,
      };
    case "welcome":
      return {
        subject: "Your monitoring command center is ready",
        html: layout(
          "Welcome aboard",
          `<p style="margin:0;">Hi ${escapeHtml(job.userName)}, your account is verified. Create your first organization, invite your team, and you'll be ready to add monitors the moment monitoring ships.</p>${button("Open dashboard", job.dashboardUrl)}`,
        ),
        text: `Hi ${job.userName},\n\nYour account is verified. Open your dashboard:\n${job.dashboardUrl}`,
      };
    case "alert":
      return {
        subject: `[${job.status}] ${job.monitorName}`,
        html: layout(
          `${escapeHtml(job.monitorName)} is ${escapeHtml(job.status)}`,
          `<p style="margin:0 0 6px;">Monitor <strong style="color:${BRAND.text};">${escapeHtml(job.monitorName)}</strong> in <strong style="color:${BRAND.text};">${escapeHtml(job.organizationName)}</strong> changed status.</p>
           <p style="margin:0;">Status: <span style="font-family:Menlo,Consolas,monospace;color:${BRAND.accent};">${escapeHtml(job.status)}</span><br/>At: ${escapeHtml(job.timestamp)}</p>${button("View monitor", job.ctaUrl)}`,
        ),
        text: `${job.monitorName} is ${job.status}\nOrganization: ${job.organizationName}\nAt: ${job.timestamp}\n\nView monitor: ${job.ctaUrl}`,
      };
    case "incident":
      return {
        subject: `[${job.severity}] ${job.incidentTitle}`,
        html: layout(
          escapeHtml(job.incidentTitle),
          `<p style="margin:0 0 6px;">Severity: <span style="font-family:Menlo,Consolas,monospace;color:${BRAND.accent};">${escapeHtml(job.severity)}</span></p>
           <p style="margin:0;">${escapeHtml(job.description)}</p>${button("View status page", job.statusPageUrl)}`,
        ),
        text: `${job.incidentTitle} [${job.severity}]\n\n${job.description}\n\nStatus page: ${job.statusPageUrl}`,
      };
    case "status_page_update":
      return {
        subject: `${job.pageName}: ${job.incidentTitle}`,
        html: layout(
          escapeHtml(job.incidentTitle),
          `<p style="margin:0 0 6px;">Update on <strong style="color:${BRAND.text};">${escapeHtml(job.pageName)}</strong>.</p>
           <p style="margin:0;">Status: <span style="font-family:Menlo,Consolas,monospace;color:${BRAND.accent};">${escapeHtml(job.statusChange)}</span></p>${button("View status page", job.publicUrl)}
           <p style="margin:14px 0 0;color:#5B677C;font-size:12px;">You're receiving this because you subscribed to status updates.</p>`,
        ),
        text: `${job.pageName} — ${job.incidentTitle}\nStatus: ${job.statusChange}\n\n${job.publicUrl}\n\nYou subscribed to status updates for this page.`,
      };
    case "status_subscribe_confirm":
      return {
        subject: `Confirm your subscription to ${job.pageName}`,
        html: layout(
          "Confirm your subscription",
          `<p style="margin:0;">Confirm your email to get status updates for <strong style="color:${BRAND.text};">${escapeHtml(job.pageName)}</strong>. If you didn't request this, you can ignore this email.</p>${button("Confirm subscription", job.confirmUrl)}`,
        ),
        text: `Confirm your subscription to ${job.pageName} status updates:\n${job.confirmUrl}\n\nIf you didn't request this, ignore this email.`,
      };
    case "status_incident_opened":
    case "status_incident_updated":
    case "status_incident_resolved": {
      const prefix =
        job.template === "status_incident_resolved"
          ? "Resolved"
          : job.template === "status_incident_opened"
            ? "Incident"
            : "Update";
      return {
        subject: `[${prefix}] ${job.pageName}: ${job.incidentTitle}`,
        html: layout(
          escapeHtml(job.incidentTitle),
          `<p style="margin:0 0 6px;">${escapeHtml(job.pageName)} — status: <span style="font-family:Menlo,Consolas,monospace;color:${BRAND.accent};">${escapeHtml(job.statusLabel)}</span></p>
           <p style="margin:0;">${escapeHtml(job.body)}</p>${button("View status page", job.publicUrl)}
           <p style="margin:14px 0 0;color:#5B677C;font-size:12px;">You're receiving this because you subscribed to ${escapeHtml(job.pageName)} status updates. <a href="${job.unsubscribeUrl}" style="color:#5B677C;">Unsubscribe</a>.</p>`,
        ),
        text: `[${prefix}] ${job.pageName}: ${job.incidentTitle}\nStatus: ${job.statusLabel}\n\n${job.body}\n\nView: ${job.publicUrl}\nUnsubscribe: ${job.unsubscribeUrl}`,
      };
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
