"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authClient, useSession } from "@/lib/auth-client";
import { ROLE_LABELS, isOrgRole } from "@backend-uptime/shared";

interface InvitationView {
  organizationName: string;
  inviterEmail: string;
  role: string;
  email: string;
  status: string;
  expiresAt: string | Date;
}

export default function AcceptInvitationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();

  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (sessionPending || !session) return;
    let cancelled = false;

    authClient.organization
      .getInvitation({ query: { id } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setLoadError(
            "This invitation could not be found. It may have been canceled or already used.",
          );
        } else {
          setInvitation(data as unknown as InvitationView);
        }
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [id, session, sessionPending]);

  async function accept() {
    setActionError(null);
    setPending(true);
    const { data, error } = await authClient.organization.acceptInvitation({
      invitationId: id,
    });
    if (error || !data) {
      setPending(false);
      setActionError(
        error?.message ??
          "Could not accept the invitation. It may be expired, or addressed to a different email.",
      );
      return;
    }
    await authClient.organization.setActive({
      organizationId: data.member.organizationId,
    });
    router.push("/dashboard");
    router.refresh();
  }

  async function reject() {
    setActionError(null);
    setPending(true);
    await authClient.organization.rejectInvitation({ invitationId: id });
    router.push("/");
  }

  // --- signed out: park the invite and route through auth ---
  if (!sessionPending && !session) {
    return (
      <AuthShell
        title="You're invited"
        subtitle="Sign in — or create an account with the invited email — to join this organization."
      >
        <div className="space-y-3">
          <Link href="/sign-in" className="block">
            <Button className="w-full">Sign in to accept</Button>
          </Link>
          <Link href="/sign-up" className="block">
            <Button variant="secondary" className="w-full">
              Create an account
            </Button>
          </Link>
          <p className="text-xs leading-relaxed text-muted">
            Then reopen the invitation link from your email to finish joining.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (sessionPending || (session && !loaded)) {
    return (
      <AuthShell title="Loading invitation" subtitle="One moment.">
        <div className="h-24 animate-pulse rounded-md border border-line-soft bg-panel" />
      </AuthShell>
    );
  }

  if (loadError || !invitation) {
    return (
      <AuthShell
        title="Invitation not found"
        footer={
          <Link href="/" className="text-brand hover:underline">
            Back to home
          </Link>
        }
      >
        <Alert tone="error">{loadError ?? "Unknown invitation."}</Alert>
      </AuthShell>
    );
  }

  const expired = new Date(invitation.expiresAt).getTime() < Date.now();
  const notPending = invitation.status !== "pending";
  const wrongEmail =
    session?.user.email.toLowerCase() !== invitation.email.toLowerCase();
  const roleLabel = isOrgRole(invitation.role)
    ? ROLE_LABELS[invitation.role]
    : invitation.role;

  return (
    <AuthShell
      title={`Join ${invitation.organizationName}`}
      subtitle={`${invitation.inviterEmail} invited you to collaborate.`}
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-md border border-line-soft bg-panel-2 px-4 py-3">
          <span className="text-sm text-muted">You&apos;ll join as</span>
          <Badge tone="brand">{roleLabel}</Badge>
        </div>

        {actionError ? <Alert tone="error">{actionError}</Alert> : null}
        {expired ? (
          <Alert tone="warning">
            This invitation expired. Ask an organization admin to send a new
            one.
          </Alert>
        ) : null}
        {notPending && !expired ? (
          <Alert tone="warning">
            This invitation was already {invitation.status}.
          </Alert>
        ) : null}
        {wrongEmail ? (
          <Alert tone="warning">
            This invitation was sent to{" "}
            <span className="font-[family-name:var(--font-mono)]">
              {invitation.email}
            </span>
            , but you are signed in as{" "}
            <span className="font-[family-name:var(--font-mono)]">
              {session?.user.email}
            </span>
            . Switch accounts to accept it.
          </Alert>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={accept}
            loading={pending}
            disabled={expired || notPending || wrongEmail}
          >
            Accept invitation
          </Button>
          <Button variant="secondary" onClick={reject} disabled={pending}>
            Decline
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
