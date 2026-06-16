/** Well-known audit actions emitted in Phase 1. Later phases append here. */
export const AUDIT_ACTIONS = [
  "user.signed_up",
  "user.signed_in",
  "user.password_reset",
  "user.two_factor_enabled",
  "user.two_factor_disabled",
  "organization.created",
  "organization.updated",
  "organization.deleted",
  "member.invited",
  "member.joined",
  "member.role_updated",
  "member.removed",
  "invitation.cancelled",
  "invitation.rejected",
  "monitor.down",
  "monitor.recovered",
  "monitor.flapping",
  "incident.opened",
  "incident.acknowledged",
  "incident.resolved",
  "incident.commented",
  "billing.checkout_started",
  "billing.portal_opened",
  "billing.plan_changed",
  "billing.canceled",
  "billing.checkout_completed",
  "billing.subscription_created",
  "billing.subscription_updated",
  "billing.subscription_deleted",
  "billing.payment_succeeded",
  "billing.payment_failed",
] as const;

export type KnownAuditAction = (typeof AUDIT_ACTIONS)[number];
/** Open union: known actions get autocomplete, future actions still type-check. */
export type AuditAction = KnownAuditAction | (string & {});

export type AuditActorType = "user" | "system" | "api_key";

export interface AuditEvent {
  organizationId?: string | null;
  actorId?: string | null;
  actorType: AuditActorType;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}
