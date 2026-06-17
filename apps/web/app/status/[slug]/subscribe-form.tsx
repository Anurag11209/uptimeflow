"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

/**
 * Email subscription form for incident notifications. Double opt-in: the API
 * creates a PENDING subscriber and sends a confirmation email, so we only ever
 * report "check your inbox" — never that the address is known.
 */
export function SubscribeForm({ slug }: { slug: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setState({ kind: "loading" });
    try {
      const res = await fetch(`${BASE_URL}/status/${encodeURIComponent(slug)}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
      if (!res.ok) {
        setState({ kind: "error", message: body.error?.message ?? "Could not subscribe. Try again." });
        return;
      }
      setEmail("");
      setState({ kind: "ok", message: body.message ?? "Check your inbox to confirm your subscription." });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="subscribe-email" className="sr-only">
          Email address
        </label>
        <Input
          id="subscribe-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state.kind === "loading"}
          aria-describedby="subscribe-help"
        />
        <Button type="submit" loading={state.kind === "loading"} className="shrink-0 sm:w-auto">
          Subscribe
        </Button>
      </div>
      <p id="subscribe-help" className="text-xs text-muted">
        Get an email when an incident is opened, updated, or resolved. Unsubscribe anytime.
      </p>
      {state.kind === "ok" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.kind === "error" ? <Alert tone="error">{state.message}</Alert> : null}
    </form>
  );
}
