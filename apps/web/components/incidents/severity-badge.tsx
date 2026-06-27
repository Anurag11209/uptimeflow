import { Badge } from "@/components/ui/badge";
import { severityMeta } from "@/lib/incidents";

export function SeverityBadge({ severity }: { severity: string }) {
  const meta = severityMeta(severity);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
