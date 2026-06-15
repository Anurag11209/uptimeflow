import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, isOrgRole } from "@backend-uptime/shared";

const TONE: Record<string, "brand" | "up" | "muted" | "default"> = {
  owner: "brand",
  admin: "default",
  manager: "default",
  developer: "up",
  viewer: "muted",
};

export function RoleBadge({ role }: { role: string }) {
  const label = isOrgRole(role) ? ROLE_LABELS[role] : role;
  return <Badge tone={TONE[role] ?? "default"}>{label}</Badge>;
}
