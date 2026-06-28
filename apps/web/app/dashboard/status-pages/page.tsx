"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Copy, Eye, LayoutPanelTop, Plus, Search, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import {
  componentStatusMeta,
  formatDateTime,
  useDeleteStatusPage,
  useDuplicateStatusPage,
  useStatusPages,
  visibilityMeta,
  type StatusPageListItem,
} from "@/lib/status-pages";
import { hasPermission } from "@backend-uptime/shared";

const PAGE_SIZE = 12;

const PUBLIC_BASE = process.env.NEXT_PUBLIC_APP_URL ?? "";

export default function StatusPagesPage() {
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const canRead = role ? hasPermission(role, "statusPage", ["read"]) : false;
  const canManage = role
    ? hasPermission(role, "statusPage", ["create", "update", "delete"])
    : false;

  const { data, isPending, error } = useStatusPages(orgId, canRead);
  const deletePage = useDeleteStatusPage(orgId ?? "");
  const duplicatePage = useDuplicateStatusPage(orgId ?? "");
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [toDelete, setToDelete] = useState<StatusPageListItem | null>(null);

  const pages = useMemo(() => data?.items ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.customDomain?.toLowerCase().includes(q) ?? false),
    );
  }, [pages, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  async function onConfirmDelete() {
    if (!toDelete) return;
    try {
      await deletePage.mutateAsync(toDelete.id);
      toast("Status page deleted.", "success");
      setToDelete(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete status page.", "error");
    }
  }

  async function onDuplicate(p: StatusPageListItem) {
    try {
      const created = await duplicatePage.mutateAsync(p);
      toast("Status page duplicated.", "success");
      void created;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not duplicate status page.", "error");
    }
  }

  if (orgPending) return <ListSkeleton />;
  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view status pages.</Alert>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
            Status pages
          </h1>
          <p className="mt-1 text-sm text-muted">
            Publish a branded status page for your customers.
          </p>
        </div>
        {canManage ? (
          <ButtonLink href="/dashboard/status-pages/new">
            <Plus className="size-4" /> New status page
          </ButtonLink>
        ) : null}
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search by name, slug, or domain…"
          className="pl-9"
          aria-label="Search status pages"
        />
      </div>

      {error ? (
        <Alert tone="error">
          {error instanceof ApiError ? error.message : "Could not load status pages."}
        </Alert>
      ) : isPending ? (
        <ListSkeleton rowsOnly />
      ) : pages.length === 0 ? (
        <EmptyState canManage={canManage} />
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">
          No status pages match your search.
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Domain</th>
                    <th className="px-4 py-3 font-medium">Visibility</th>
                    <th className="px-4 py-3 font-medium">Components</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Subscribers</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {pageItems.map((p) => {
                    const status = componentStatusMeta(p.overallStatus);
                    const vis = visibilityMeta(p.visibility);
                    return (
                      <tr key={p.id} className="hover:bg-panel-2/50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/status-pages/${p.id}`}
                            className="font-medium text-text hover:text-brand"
                          >
                            {p.name}
                          </Link>
                          <p className="truncate font-[family-name:var(--font-mono)] text-xs text-muted">
                            /status/{p.slug}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-xs text-muted">
                          {p.customDomain ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={vis.tone}>{vis.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted">{p.componentCount}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`size-2 rounded-full ${status.dot}`} />
                            <span className="text-muted">{status.label}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted">{p.subscriberCount}</td>
                        <td className="px-4 py-3 text-muted">{formatDateTime(p.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1.5">
                            <a
                              href={`${PUBLIC_BASE}/status/${p.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center rounded-md px-2 text-muted transition-colors hover:bg-panel hover:text-text"
                              aria-label={`Preview ${p.name}`}
                              title="Preview public page"
                            >
                              <Eye className="size-3.5" />
                            </a>
                            {canManage ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onDuplicate(p)}
                                  disabled={duplicatePage.isPending}
                                  aria-label={`Duplicate ${p.name}`}
                                  title="Duplicate"
                                >
                                  <Copy className="size-3.5" />
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => setToDelete(p)}
                                  aria-label={`Delete ${p.name}`}
                                  title="Delete"
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between text-sm text-muted">
              <span>
                {filtered.length} status page{filtered.length === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <span className="px-1">
                  {safePage + 1} / {pageCount}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete status page?"
        description={
          toDelete
            ? `"${toDelete.name}", its components, incidents, and subscribers will be permanently removed.`
            : undefined
        }
        confirmLabel="Delete status page"
        loading={deletePage.isPending}
        onConfirm={onConfirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function EmptyState({ canManage }: { canManage: boolean }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full border border-line bg-panel-2">
        <LayoutPanelTop className="size-5 text-muted" />
      </div>
      <div>
        <p className="text-sm font-medium text-text">No status pages yet</p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
          Create a public status page to communicate uptime, incidents, and maintenance to your
          customers.
        </p>
      </div>
      {canManage ? (
        <ButtonLink href="/dashboard/status-pages/new" size="sm">
          <Plus className="size-4" /> New status page
        </ButtonLink>
      ) : null}
    </Card>
  );
}

function ListSkeleton({ rowsOnly = false }: { rowsOnly?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      {!rowsOnly ? <Skeleton className="h-8 w-48" /> : null}
      <Card className="divide-y divide-line-soft">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="h-5 flex-1" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </Card>
    </div>
  );
}
