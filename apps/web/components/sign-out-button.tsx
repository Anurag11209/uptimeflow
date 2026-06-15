"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={pending}
      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-panel hover:text-text disabled:opacity-50"
    >
      <LogOut className="size-4" />
      Sign out
    </button>
  );
}
