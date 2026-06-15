"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { authClient, useListOrganizations } from "@/lib/auth-client";
import { useInvalidateOrg } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function OrgSwitcher({ activeOrgId }: { activeOrgId: string | null }) {
  const router = useRouter();
  const { data: organizations } = useListOrganizations();
  const invalidateOrg = useInvalidateOrg();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const active =
    organizations?.find((org) => org.id === activeOrgId) ?? organizations?.[0];

  async function selectOrg(orgId: string) {
    if (orgId === activeOrgId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    await authClient.organization.setActive({ organizationId: orgId });
    invalidateOrg(orgId);
    setSwitching(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        className="flex w-56 items-center justify-between gap-2 rounded-md border border-line-soft bg-panel px-3 py-2 text-sm transition-colors hover:border-line disabled:opacity-60"
      >
        <span className="flex items-center gap-2 truncate">
          <span className="grid size-6 shrink-0 place-items-center rounded border border-brand/40 bg-brand/10 font-[family-name:var(--font-mono)] text-[10px] text-brand">
            {(active?.name ?? "?").slice(0, 2).toUpperCase()}
          </span>
          <span className="truncate">{active?.name ?? "Select organization"}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute z-20 mt-1 w-56 overflow-hidden rounded-md border border-line bg-panel-2 py-1 shadow-xl">
            {organizations?.map((org) => (
              <button
                key={org.id}
                onClick={() => selectOrg(org.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-panel"
              >
                <span className="truncate">{org.name}</span>
                {org.id === (active?.id ?? "") ? (
                  <Check className="size-4 text-brand" />
                ) : null}
              </button>
            ))}
            <div className="my-1 h-px bg-line-soft" />
            <Link
              href="/create-organization"
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-sm text-muted transition-colors hover:bg-panel hover:text-text",
              )}
            >
              <Plus className="size-4" />
              New organization
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
