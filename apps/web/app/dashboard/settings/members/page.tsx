"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Mail, Trash2, UserPlus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { RoleBadge } from "@/components/role-badge";
import { useToast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";
import {
  useActiveOrg,
  useInvalidateOrg,
  useInvitations,
  useMembers,
} from "@/lib/queries";
import {
  ROLE_LABELS,
  assignableRoles,
  hasPermission,
  type OrgRole,
} from "@backend-uptime/shared";

interface MemberItem {
  id: string;
  role: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

interface InvitationItem {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
}

export default function MembersPage() {
  const { data: activeOrg, me, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const invalidateOrg = useInvalidateOrg();
  const { toast } = useToast();

  const canReadMembers = role ? hasPermission(role, "member", ["read"]) : false;
  const canManageMembers = role
    ? hasPermission(role, "member", ["create", "update", "delete"])
    : false;

  const { data: members, isPending: membersPending } = useMembers(
    orgId,
    canReadMembers,
  );
  const { data: invitations } = useInvitations(orgId, canManageMembers);

  const assignable = useMemo(
    () => (role ? assignableRoles(role) : []),
    [role],
  );

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Destructive action state
  const [memberToRemove, setMemberToRemove] = useState<MemberItem | null>(null);
  const [invitationToCancel, setInvitationToCancel] = useState<InvitationItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  if (orgPending) {
    return <div className="h-64 animate-pulse rounded-lg bg-panel" />;
  }

  if (!canReadMembers) {
    return (
      <Alert tone="info">
        Your role ({role ? ROLE_LABELS[role] : "unknown"}) doesn&apos;t have
        access to the member directory.
      </Alert>
    );
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error: inviteError } = await authClient.organization.inviteMember({
      email,
      role: inviteRole,
      organizationId: orgId,
    });
    setPending(false);

    if (inviteError) {
      setError(inviteError.message ?? "Could not send the invitation.");
      return;
    }

    toast(`Invitation sent to ${email}.`, "success");
    setEmail("");
    setInviteRole("viewer");
    if (orgId) invalidateOrg(orgId);
  }

  async function changeRole(memberId: string, nextRole: string) {
    if (!orgId) return;
    setBusyId(memberId);
    setError(null);
    const { error: roleError } = await authClient.organization.updateMemberRole({
      memberId,
      role: nextRole as OrgRole,
      organizationId: orgId,
    });
    setBusyId(null);
    if (roleError) {
      toast(roleError.message ?? "Could not update role.", "error");
      return;
    }
    toast("Member role updated.", "success");
    invalidateOrg(orgId);
  }

  async function onConfirmRemoveMember() {
    if (!orgId || !memberToRemove) return;
    setActionLoading(true);
    const { error: removeError } = await authClient.organization.removeMember({
      memberIdOrEmail: memberToRemove.id,
      organizationId: orgId,
    });
    setActionLoading(false);
    if (removeError) {
      toast(removeError.message ?? "Could not remove member.", "error");
      return;
    }
    toast(`Removed ${memberToRemove.user.name} from the organization.`, "success");
    setMemberToRemove(null);
    invalidateOrg(orgId);
  }

  async function onConfirmCancelInvitation() {
    if (!orgId || !invitationToCancel) return;
    setActionLoading(true);
    await authClient.organization.cancelInvitation({ invitationId: invitationToCancel.id });
    setActionLoading(false);
    toast(`Cancelled invitation for ${invitationToCancel.email}.`, "success");
    setInvitationToCancel(null);
    invalidateOrg(orgId);
  }

  async function resendInvitation(inv: { id: string; email: string; role: string | null }) {
    if (!orgId) return;
    setBusyId(inv.id);
    const { error: resendError } = await authClient.organization.inviteMember({
      email: inv.email,
      role: (inv.role ?? "viewer") as OrgRole,
      organizationId: orgId,
      resend: true,
    });
    setBusyId(null);
    if (resendError) {
      toast(resendError.message ?? "Could not resend invitation.", "error");
    } else {
      toast(`Invitation re-sent to ${inv.email}.`, "success");
    }
    invalidateOrg(orgId);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
          Members
        </h1>
        <p className="mt-1 text-sm text-muted">
          People with access to {activeOrg?.organization.name}, and their roles.
        </p>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {canManageMembers ? (
        <Card>
          <div className="flex items-center gap-2 border-b border-line-soft p-5">
            <UserPlus className="size-4 text-muted" />
            <h2 className="font-[family-name:var(--font-display)] font-semibold">
              Invite a member
            </h2>
          </div>
          <form
            onSubmit={invite}
            className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            </div>
            <div className="space-y-2 sm:w-48">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                id="invite-role"
                name="role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrgRole)}
              >
                {assignable
                  .filter((r) => r !== "owner")
                  .map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
              </Select>
            </div>
            <Button type="submit" loading={pending}>
              Send invite
            </Button>
          </form>
        </Card>
      ) : null}

      <Card>
        <div className="border-b border-line-soft p-5">
          <h2 className="font-[family-name:var(--font-display)] font-semibold">
            Team
          </h2>
        </div>
        {membersPending ? (
          <div className="space-y-px">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse bg-panel/50" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {members?.items.map((member) => {
              const canEditThis =
                canManageMembers &&
                member.role !== "owner" &&
                member.user.id !== me?.user.id;
              return (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-5"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full border border-line bg-panel-2 font-[family-name:var(--font-mono)] text-xs uppercase text-muted">
                      {member.user.name.slice(0, 2)}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{member.user.name}</p>
                      <p className="text-xs text-muted">{member.user.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {canEditThis ? (
                      <div className="w-36">
                        <Select
                          value={member.role}
                          disabled={busyId === member.id}
                          onChange={(e) => changeRole(member.id, e.target.value)}
                          className="h-8 text-xs"
                          aria-label={`Change role for ${member.user.name}`}
                        >
                          {assignable.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : (
                      <RoleBadge role={member.role} />
                    )}

                    {canEditThis ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setMemberToRemove(member)}
                        disabled={busyId === member.id}
                        aria-label={`Remove ${member.user.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {canManageMembers && invitations && invitations.items.length > 0 ? (
        <Card>
          <div className="flex items-center gap-2 border-b border-line-soft p-5">
            <Mail className="size-4 text-muted" />
            <h2 className="font-[family-name:var(--font-display)] font-semibold">
              Pending invitations
            </h2>
          </div>
          <ul className="divide-y divide-line-soft">
            {invitations.items.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 p-5"
              >
                <div>
                  <p className="text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted">
                    Expires{" "}
                    {new Date(inv.expiresAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {inv.role ? <RoleBadge role={inv.role} /> : null}
                  <Badge tone="muted">{inv.status}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resendInvitation(inv)}
                    disabled={busyId === inv.id}
                  >
                    Resend
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setInvitationToCancel(inv)}
                    disabled={busyId === inv.id}
                  >
                    Cancel
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Confirmation Modals */}
      <ConfirmDialog
        open={Boolean(memberToRemove)}
        title="Remove member?"
        description={
          memberToRemove
            ? `Are you sure you want to remove ${memberToRemove.user.name} (${memberToRemove.user.email}) from ${activeOrg?.organization.name}? They will lose all access immediately.`
            : undefined
        }
        confirmLabel="Remove member"
        tone="danger"
        loading={actionLoading}
        onConfirm={onConfirmRemoveMember}
        onCancel={() => setMemberToRemove(null)}
      />

      <ConfirmDialog
        open={Boolean(invitationToCancel)}
        title="Cancel invitation?"
        description={
          invitationToCancel
            ? `Cancel the pending invitation for ${invitationToCancel.email}? The invitation link will no longer work.`
            : undefined
        }
        confirmLabel="Cancel invitation"
        tone="danger"
        loading={actionLoading}
        onConfirm={onConfirmCancelInvitation}
        onCancel={() => setInvitationToCancel(null)}
      />
    </div>
  );
}
