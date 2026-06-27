"use client";

import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { useCommentIncident } from "@/lib/incidents";

export function CommentForm({ orgId, incidentId }: { orgId: string; incidentId: string }) {
  const [message, setMessage] = useState("");
  const comment = useCommentIncident(orgId, incidentId);
  const { toast } = useToast();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    try {
      await comment.mutateAsync(trimmed);
      setMessage("");
      toast("Comment added.", "success");
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "Could not add comment.",
        "error",
      );
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor="incident-comment" className="sr-only">
        Add a comment
      </label>
      <Textarea
        id="incident-comment"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Add an update or note for the team…"
        maxLength={2000}
        rows={3}
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          loading={comment.isPending}
          disabled={!message.trim()}
        >
          <Send className="size-3.5" /> Comment
        </Button>
      </div>
    </form>
  );
}
