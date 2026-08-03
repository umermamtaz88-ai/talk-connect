"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { Avatar } from "@/components/ui/Avatar";
import { InputField } from "@/components/ui/primitives";
import { usersApi } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { useRouter } from "next/navigation";
import { BlockedContacts } from "./BlockedContacts";

function Toggle({
  checked,
  onChange,
  label,
  note,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  note: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-text-muted">{note}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-brand-primary" : "bg-surface-hover"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </label>
  );
}

export function ProfileSettings() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [readReceipts, setReadReceipts] = useState(
    user?.read_receipts_enabled ?? true,
  );
  const [typing, setTyping] = useState(
    user?.typing_indicators_enabled ?? true,
  );
  const [lastSeen, setLastSeen] = useState(
    user?.last_seen_visibility ?? "friends",
  );
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusMsg, setFocusMsg] = useState("busy until later");
  const [focusDur, setFocusDur] = useState(60);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const motionSafe = useMotionSafe();

  async function save() {
    setSaving(true);
    try {
      const updated = await usersApi.updateMe({
        display_name: displayName,
        bio,
        read_receipts_enabled: readReceipts,
        typing_indicators_enabled: typing,
        last_seen_visibility: lastSeen,
      });
      setUser(updated);
      setMsg("Saved");
    } catch {
      setMsg("Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function setFocus() {
    const until = new Date(Date.now() + focusDur * 60_000).toISOString();
    await usersApi.setFocus({ until, message: focusMsg, shareWith: [] });
    setFocusOpen(false);
    setMsg("Focus Sync on");
  }

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="relative h-36 bg-[linear-gradient(135deg,#1a1f38,#6E56CF)]">
        {user?.cover_photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.cover_photo_url}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
        <div className="absolute -bottom-10 left-5">
          <Avatar
            name={user?.display_name}
            url={user?.avatar_url}
            iconId={user?.avatar_icon_id}
            size={80}
            className="ring-4 ring-canvas"
          />
        </div>
      </div>

      <div className="space-y-6 px-5 pt-14 pb-10">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
            {user?.display_name}
          </h2>
          <p className="text-sm text-text-muted">@{user?.username}</p>
        </div>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">
            Profile
          </h3>
          <InputField
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <InputField
            label="Bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-text-muted uppercase">
            Privacy
          </h3>
          <Toggle
            label="Read receipts"
            note="Turning this off also hides others' read receipts from you"
            checked={readReceipts}
            onChange={setReadReceipts}
          />
          <Toggle
            label="Typing indicators"
            note="Others won't see when you're typing if this is off"
            checked={typing}
            onChange={setTyping}
          />
          <label className="block py-3">
            <span className="text-sm font-medium">Last seen visibility</span>
            <select
              value={lastSeen}
              onChange={(e) =>
                setLastSeen(e.target.value as "everyone" | "friends" | "nobody")
              }
              className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none"
            >
              <option value="everyone">Everyone</option>
              <option value="friends">Friends</option>
              <option value="nobody">Nobody</option>
            </select>
          </label>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold tracking-wide text-text-muted uppercase">
            Focus Sync
          </h3>
          <GhostPillButton onClick={() => setFocusOpen(true)}>
            Set busy status
          </GhostPillButton>
          {user?.focus_until && (
            <p className="mt-2 text-xs text-warning">
              Active: {user.focus_message} until{" "}
              {new Date(user.focus_until).toLocaleTimeString()}
            </p>
          )}
        </section>

        {msg && <p className="text-sm text-success">{msg}</p>}

        <div className="flex flex-wrap gap-3">
          <AuroraButton loading={saving} onClick={() => void save()}>
            Save changes
          </AuroraButton>
          <GhostPillButton
            danger
            onClick={async () => {
              await logout();
              router.replace("/auth");
            }}
          >
            Log out
          </GhostPillButton>
        </div>

        <section className="border-t border-border pt-6">
          <BlockedContacts />
        </section>
      </div>

      <AnimatePresence>
        {focusOpen && (
          <motion.div
            initial={motionSafe.sheet.initial}
            animate={motionSafe.sheet.animate}
            exit={motionSafe.sheet.exit}
            transition={motionSafe.sheet.transition}
            className="fixed inset-x-0 bottom-0 z-40 rounded-t-3xl border border-border bg-surface-elevated p-6"
          >
            <h3 className="mb-4 text-lg font-semibold">Focus Sync</h3>
            <div className="mb-4 flex flex-wrap gap-2">
              {[
                { m: 30, label: "30m" },
                { m: 60, label: "1h" },
                { m: 180, label: "3h" },
              ].map((d) => (
                <button
                  key={d.m}
                  type="button"
                  onClick={() => setFocusDur(d.m)}
                  className={`rounded-full px-3 py-1.5 text-sm ${
                    focusDur === d.m
                      ? "bg-brand-primary text-white"
                      : "bg-surface text-text-secondary"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <InputField
              label="Message friends will see"
              value={focusMsg}
              onChange={(e) => setFocusMsg(e.target.value)}
            />
            <p className="mt-3 rounded-xl border border-border bg-surface p-3 text-xs text-text-secondary">
              Preview: “{focusMsg}” · ends in {focusDur} minutes
            </p>
            <div className="mt-4 flex gap-3">
              <GhostPillButton
                className="flex-1"
                onClick={() => setFocusOpen(false)}
              >
                Cancel
              </GhostPillButton>
              <AuroraButton className="flex-1" onClick={() => void setFocus()}>
                Share Focus
              </AuroraButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
