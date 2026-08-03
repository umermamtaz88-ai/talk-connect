"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { friendsApi } from "@/lib/api";
import type { User } from "@/lib/types";

export function BlockedContacts() {
  const [blocked, setBlocked] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setBlocked(await friendsApi.blocked());
      setError(null);
    } catch {
      setError("Could not load blocked contacts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function unblock(u: User) {
    setBusyId(u.id);
    try {
      await friendsApi.unblock(u.id);
      setBlocked((prev) => prev.filter((x) => x.id !== u.id));
      setConfirmId(null);
    } catch {
      setError("Could not unblock");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Blocked contacts</h3>
        <p className="mt-0.5 text-xs text-text-muted">
          Unblocking restores visibility. It does not restore friendship.
        </p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="py-6 text-center text-sm text-text-muted">Loading…</p>
      ) : blocked.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">
          No blocked contacts.
        </p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {blocked.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-3 py-3"
            >
              <Avatar name={u.display_name} url={u.avatar_url} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.display_name}</p>
                <p className="text-xs text-text-muted">@{u.username}</p>
              </div>
              {confirmId === u.id ? (
                <div className="flex flex-col items-end gap-1">
                  <p className="max-w-[160px] text-right text-[11px] text-text-muted">
                    Unblock {u.display_name}? They won&apos;t be notified.
                  </p>
                  <div className="flex gap-1">
                    <GhostPillButton
                      className="!px-2 !py-1 text-xs"
                      onClick={() => setConfirmId(null)}
                    >
                      Cancel
                    </GhostPillButton>
                    <GhostPillButton
                      className="!px-2 !py-1 text-xs"
                      danger
                      onClick={() => void unblock(u)}
                    >
                      {busyId === u.id ? "…" : "Confirm"}
                    </GhostPillButton>
                  </div>
                </div>
              ) : (
                <GhostPillButton
                  className="!px-3 !py-1.5 text-xs"
                  onClick={() => setConfirmId(u.id)}
                >
                  Unblock
                </GhostPillButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
