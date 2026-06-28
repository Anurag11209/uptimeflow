/**
 * Per-user UI preferences (timezone, language, notification toggles). The User
 * table is owned by Better Auth and has no metadata column, so rather than a
 * schema migration these live in localStorage — device-scoped, no secrets. The
 * normalize() core is pure and unit-tested; load/save touch the browser only.
 */

export interface ProfilePrefs {
  timezone: string;
  language: string;
  notifyIncidents: boolean;
  notifyMaintenance: boolean;
  notifyWeeklyReport: boolean;
}

export const LANGUAGES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "ja", label: "日本語" },
];

const STORAGE_KEY = "uf:profile-prefs";

export function defaultProfilePrefs(): ProfilePrefs {
  return {
    timezone:
      typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
    language: "en",
    notifyIncidents: true,
    notifyMaintenance: true,
    notifyWeeklyReport: false,
  };
}

/** Coerce an untrusted parsed value into a complete, valid prefs object. */
export function normalizeProfilePrefs(raw: unknown): ProfilePrefs {
  const base = defaultProfilePrefs();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  return {
    timezone: typeof r.timezone === "string" && r.timezone.trim() ? r.timezone : base.timezone,
    language:
      typeof r.language === "string" && LANGUAGES.some((l) => l.value === r.language)
        ? r.language
        : base.language,
    notifyIncidents: typeof r.notifyIncidents === "boolean" ? r.notifyIncidents : base.notifyIncidents,
    notifyMaintenance:
      typeof r.notifyMaintenance === "boolean" ? r.notifyMaintenance : base.notifyMaintenance,
    notifyWeeklyReport:
      typeof r.notifyWeeklyReport === "boolean" ? r.notifyWeeklyReport : base.notifyWeeklyReport,
  };
}

export function loadProfilePrefs(): ProfilePrefs {
  if (typeof window === "undefined") return defaultProfilePrefs();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return normalizeProfilePrefs(stored ? JSON.parse(stored) : null);
  } catch {
    return defaultProfilePrefs();
  }
}

export function saveProfilePrefs(prefs: ProfilePrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota / privacy-mode failures — prefs are best-effort.
  }
}
