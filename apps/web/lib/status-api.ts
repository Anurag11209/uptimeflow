import type { PublicStatusPage, PublicStatusIncident, StatusHistory } from "./status";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Status data is public and changes frequently; revalidate often rather than
// holding a hard no-store so a popular page does not stampede the API.
const REVALIDATE_SECONDS = 30;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`status ${res.status} from ${path}`);
    return (await res.json()) as T;
  } catch (err) {
    // A history/incidents failure should not blank the whole page; the page
    // fetch (which gates notFound) rethrows so the error boundary can show.
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export function fetchStatusPage(slug: string): Promise<PublicStatusPage | null> {
  return getJson<PublicStatusPage>(`/status/${encodeURIComponent(slug)}`);
}

export function fetchStatusHistory(slug: string, days = 90): Promise<StatusHistory | null> {
  return getJson<StatusHistory>(`/status/${encodeURIComponent(slug)}/history?days=${days}`);
}

export interface IncidentsPage {
  items: PublicStatusIncident[];
  nextCursor: string | null;
}

export function fetchStatusIncidents(slug: string): Promise<IncidentsPage | null> {
  return getJson<IncidentsPage>(`/status/${encodeURIComponent(slug)}/incidents`);
}
