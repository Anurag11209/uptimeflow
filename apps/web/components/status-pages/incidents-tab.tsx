"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Megaphone, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import {
  formatDateTime,
  impactMeta,
  incidentStatusMeta,
  INCIDENT_STATUSES,
  useAddIncidentUpdate,
  useOpenIncident,
  useStatusPageIncidents,
  type IncidentImpact,
  type IncidentStatus,
  type ManagedIncident,
} from "@/lib/status-pages";

type Variant = "incident" | "maintenance";

const INCIDENT_IMPACT_CHOICES: IncidentImpact[] = ["MINOR", "MAJOR", "CRITICAL"];

export function IncidentsTab(props: { orgId: string; pageId: string; canManage: boolean }) {
  return <IncidentBoard variant="incident" {...props} />;
}

export function MaintenanceTab(props: { orgId: string; pageId: string; canManage: boolean }) {
  return <IncidentBoard variant="maintenance" {...props} />;
}

function IncidentBoard({
  orgId,
  pageId,
  canManage,
  variant,
}: {
  orgId: string;
  pageId: string;
  canManage: boolean;
  variant: Variant;
}) {
  const { data, isPending, error } = useStatusPageIncidents(orgId, pageId);
  const openIncident = useOpenIncident(orgId, pageId);
  const addUpdate = useAddIncidentUpdate(orgId, pageId);
  const { toast } = useToast();

  const [opening, setOpening] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [impact, setImpact] = useState<IncidentImpact>("MINOR");
  const [formError, setFormError] = useState<string | null>(null);

  const [updateFor, setUpdateFor] = useState<ManagedIncident | null>(null);
  const [updateStatus, setUpdateStatus] = useState<IncidentStatus>("IDENTIFIED");
  const [updateBody, setUpdateBody] = useState("");

  const isMaint = variant === "maintenance";
  const copy = isMaint
    ? {
        empty: "No maintenance scheduled.",
        emptyHint: "Schedule a maintenance window to notify subscribers ahead of planned work.",
        newLabel: "Schedule maintenance",
        title: "Schedule maintenance",
        titlePlaceholder: "Database upgrade",
        bodyPlaceholder: "We will perform a database upgrade. Expect brief interruptions.",
        Icon: CalendarClock,
      }
    : {
        empty: "No incidents reported.",
        emptyHint: "Publish an incident to keep customers informed during an outage.",
        newLabel: "Publish incident",
        title: "Publish incident",
        titlePlaceholder: "Elevated error rates",
        bodyPlaceholder: "We are investigating elevated error rates on the API.",
        Icon: Megaphone,
      };

  const incidents = useMemo(() => {
    const all = data?.items ?? [];
    return all.filter((i) => (isMaint ? i.impact === "MAINTENANCE" : i.impact !== "MAINTENANCE"));
  }, [data, isMaint]);

  const active = incidents.filter((i) => !i.resolvedAt);
  const past = incidents.filter((i) => i.resolvedAt);

  async function onOpen() {
    if (!title.trim() || !body.trim()) {
      setFormError("Title and message are required.");
      return;
    }
    try {
      await openIncident.mutateAsync({
        title: title.trim(),
        body: body.trim(),
        impact: isMaint ? "MAINTENANCE" : impact,
      });
      toast(isMaint ? "Maintenance scheduled." : "Incident published.", "success");
      setOpening(false);
      setTitle("");
      setBody("");
      setImpact("MINOR");
      setFormError(null);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save.");
    }
  }

  async function onPostUpdate() {
    if (!updateFor || !updateBody.trim()) return;
    try {
      await addUpdate.mutateAsync({
        incidentId: updateFor.id,
        payload: { status: updateStatus, body: updateBody.trim() },
      });
      toast(updateStatus === "RESOLVED" ? "Marked resolved." : "Update posted.", "success");
      setUpdateFor(null);
      setUpdateBody("");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not post update.", "error");
    }
  }

  function openUpdateModal(incident: ManagedIncident, preset?: IncidentStatus) {
    setUpdateFor(incident);
    setUpdateStatus(preset ?? "IDENTIFIED");
    setUpdateBody("");
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert tone="error">
        {error instanceof ApiError ? error.message : "Could not load incidents."}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-end">
        {canManage ? (
          <Button size="sm" onClick={() => setOpening(true)}>
            <Plus className="size-4" /> {copy.newLabel}
          </Button>
        ) : null}
      </div>

      {incidents.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <div className="grid size-11 place-items-center rounded-full border border-line bg-panel-2">
            <copy.Icon className="size-5 text-muted" />
          </div>
          <p className="text-sm font-medium text-text">{copy.empty}</p>
          <p className="max-w-xs text-xs text-muted">{copy.emptyHint}</p>
        </Card>
      ) : (
        <>
          {active.length > 0 ? (
            <Section label={isMaint ? "Active & upcoming" : "Active"}>
              {active.map((i) => (
                <IncidentCard
                  key={i.id}
                  incident={i}
                  canManage={canManage}
                  onUpdate={() => openUpdateModal(i)}
                  onResolve={() => openUpdateModal(i, "RESOLVED")}
                />
              ))}
            </Section>
          ) : null}
          {past.length > 0 ? (
            <Section label="History">
              {past.map((i) => (
                <IncidentCard key={i.id} incident={i} canManage={false} />
              ))}
            </Section>
          ) : null}
        </>
      )}

      {/* New incident / maintenance */}
      <Modal open={opening} title={copy.title} onClose={() => setOpening(false)}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-title">Title</Label>
            <Input
              id="i-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={copy.titlePlaceholder}
            />
          </div>
          {!isMaint ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-impact">Impact</Label>
              <Select
                id="i-impact"
                value={impact}
                onChange={(e) => setImpact(e.target.value as IncidentImpact)}
              >
                {INCIDENT_IMPACT_CHOICES.map((im) => (
                  <option key={im} value={im}>
                    {impactMeta(im).label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-body">{isMaint ? "Details" : "Initial message"}</Label>
            <Textarea
              id="i-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={copy.bodyPlaceholder}
              rows={4}
            />
          </div>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setOpening(false)}>
              Cancel
            </Button>
            <Button onClick={onOpen} loading={openIncident.isPending}>
              {copy.newLabel}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Post update */}
      <Modal
        open={updateFor !== null}
        title="Post an update"
        description={updateFor?.title}
        onClose={() => setUpdateFor(null)}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-status">Status</Label>
            <Select
              id="u-status"
              value={updateStatus}
              onChange={(e) => setUpdateStatus(e.target.value as IncidentStatus)}
            >
              {INCIDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {incidentStatusMeta(s).label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-body">Message</Label>
            <Textarea
              id="u-body"
              value={updateBody}
              onChange={(e) => setUpdateBody(e.target.value)}
              placeholder="Describe the latest status…"
              rows={4}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setUpdateFor(null)}>
              Cancel
            </Button>
            <Button onClick={onPostUpdate} loading={addUpdate.isPending} disabled={!updateBody.trim()}>
              Post update
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{label}</h3>
      {children}
    </div>
  );
}

function IncidentCard({
  incident,
  canManage,
  onUpdate,
  onResolve,
}: {
  incident: ManagedIncident;
  canManage: boolean;
  onUpdate?: () => void;
  onResolve?: () => void;
}) {
  const status = incidentStatusMeta(incident.status);
  const impact = impactMeta(incident.impact);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-medium text-text">{incident.title}</h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge tone={impact.tone}>{impact.label}</Badge>
            <span className="text-xs text-muted">Started {formatDateTime(incident.startedAt)}</span>
            {incident.resolvedAt ? (
              <span className="text-xs text-muted">· Resolved {formatDateTime(incident.resolvedAt)}</span>
            ) : null}
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onUpdate}>
              Post update
            </Button>
            {incident.status !== "RESOLVED" ? (
              <Button variant="secondary" size="sm" onClick={onResolve}>
                Resolve
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {incident.updates.length > 0 ? (
        <ol className="mt-4 flex flex-col gap-3 border-l border-line-soft pl-4">
          {incident.updates.map((u, idx) => (
            <li key={idx} className="relative">
              <span className="absolute -left-[1.3rem] top-1 size-2 rounded-full bg-line" />
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text">
                  {incidentStatusMeta(u.status).label}
                </span>
                <span className="text-xs text-muted">{formatDateTime(u.createdAt)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{u.body}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}
