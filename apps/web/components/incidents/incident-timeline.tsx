import {
  AlertCircle,
  ArrowUp,
  Bell,
  Check,
  MessageSquare,
  RotateCcw,
  Shuffle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime, type Tone } from "@/lib/monitors";
import { eventMeta, type IncidentTimelineEvent } from "@/lib/incidents";

const ICONS: Record<string, LucideIcon> = {
  alert: AlertCircle,
  check: Check,
  bell: Bell,
  "arrow-up": ArrowUp,
  message: MessageSquare,
  shuffle: Shuffle,
  rotate: RotateCcw,
};

const ringTone: Record<Tone, string> = {
  up: "border-up/50 bg-up/10 text-up",
  down: "border-down/50 bg-down/10 text-down",
  brand: "border-brand/50 bg-brand/10 text-brand",
  muted: "border-line bg-panel-2 text-muted",
  default: "border-line bg-panel-2 text-text",
};

export interface IncidentTimelineProps {
  events: IncidentTimelineEvent[];
  /** actorId → display name, for attributing comments/acks. */
  actors?: Map<string, string>;
}

export function IncidentTimeline({ events, actors }: IncidentTimelineProps) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">No timeline events yet.</p>;
  }

  return (
    <ol className="relative flex flex-col">
      {events.map((event, i) => {
        const meta = eventMeta(event.type);
        const Icon = ICONS[meta.icon] ?? Shuffle;
        const isLast = i === events.length - 1;
        const actorName = event.actorId ? actors?.get(event.actorId) : null;
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast ? (
              <span
                aria-hidden
                className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-line-soft"
              />
            ) : null}
            <span
              className={cn(
                "z-10 grid size-8 shrink-0 place-items-center rounded-full border",
                ringTone[meta.tone],
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium text-text">{meta.label}</p>
                <time
                  dateTime={event.createdAt}
                  title={new Date(event.createdAt).toLocaleString()}
                  className="font-[family-name:var(--font-mono)] text-xs text-muted"
                >
                  {formatRelativeTime(event.createdAt)}
                </time>
              </div>
              {event.message ? (
                <p className="mt-0.5 break-words text-sm text-muted">
                  {event.message}
                </p>
              ) : null}
              {actorName ? (
                <p className="mt-0.5 text-xs text-muted">by {actorName}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
