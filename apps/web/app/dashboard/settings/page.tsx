import { redirect } from "next/navigation";

/** Settings has no landing view of its own — open Organization by default. */
export default function SettingsIndex() {
  redirect("/dashboard/settings/organization");
}
