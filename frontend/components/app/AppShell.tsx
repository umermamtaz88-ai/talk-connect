"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { MessageSquare, Users, Settings } from "lucide-react";
import { ChatList } from "@/components/chat/ChatList";
import { ThreadSkeleton } from "@/components/chat/ThreadSkeleton";
import { AI_CHAT_ID } from "@/components/chat/AiAssistantThread";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Spinner } from "@/components/ui/primitives";
import { AiLauncher } from "@/components/app/AiLauncher";
import { CommandPalette } from "@/components/app/CommandPalette";
import { useAuthStore } from "@/lib/stores/auth";
import { useAppStore } from "@/lib/stores/app";
import { cn } from "@/lib/utils";

const MessageThread = dynamic(
  () => import("@/components/chat/MessageThread"),
  {
    loading: () => (
      <div className="flex h-full flex-1 flex-col bg-canvas">
        <div className="h-14 border-b border-border" />
        <ThreadSkeleton />
      </div>
    ),
    ssr: false,
  },
);

const IncomingCallOverlay = dynamic(
  () =>
    import("@/components/calls/CallScreen").then((m) => m.IncomingCallOverlay),
  { ssr: false },
);

const ActiveCallHost = dynamic(
  () =>
    import("@/components/calls/CallScreen").then((m) => m.ActiveCallHost),
  { ssr: false },
);

const FriendsPanel = dynamic(
  () =>
    import("@/components/friends/FriendsPanel").then((m) => m.FriendsPanel),
  {
    loading: () => (
      <div className="h-full w-full animate-pulse bg-canvas md:w-[380px]" />
    ),
    ssr: false,
  },
);

const ProfileSettings = dynamic(
  () =>
    import("@/components/settings/ProfileSettings").then(
      (m) => m.ProfileSettings,
    ),
  { ssr: false },
);

const CreateGroupSheet = dynamic(
  () =>
    import("@/components/friends/CreateGroupSheet").then(
      (m) => m.CreateGroupSheet,
    ),
  { ssr: false },
);

type Nav = "chats" | "friends" | "settings";

export function AppShell() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const activeChatId = useAppStore((s) => s.activeChatId);
  const setActiveChat = useAppStore((s) => s.setActiveChat);

  const [nav, setNav] = useState<Nav>("chats");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createGroup, setCreateGroup] = useState(false);
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    callType: "audio" | "video";
  } | null>(null);

  useEffect(() => {
    if (hydrated && !user) router.replace("/auth");
  }, [hydrated, user, router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!hydrated || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Spinner className="h-8 w-8 border-brand-primary border-t-brand-secondary" />
      </div>
    );
  }

  function openChat(id: string) {
    if (id === AI_CHAT_ID) {
      setAiOpen(true);
      return;
    }
    setActiveChat(id);
    setNav("chats");
    setMobileShowThread(true);
  }

  const threadId =
    activeChatId && activeChatId !== AI_CHAT_ID ? activeChatId : null;

  return (
    <div className="flex h-screen flex-col bg-canvas md:flex-row">
      <nav className="hidden w-16 flex-col items-center gap-2 border-r border-border bg-surface py-4 md:flex">
        <BrandLogo variant="mark" priority className="mb-4 h-10 w-10" />
        {(
          [
            { id: "chats" as const, icon: MessageSquare, label: "Chats" },
            { id: "friends" as const, icon: Users, label: "Friends" },
            { id: "settings" as const, icon: Settings, label: "Settings" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            onClick={() => {
              setNav(item.id);
              if (item.id !== "chats") setMobileShowThread(false);
            }}
            className={cn(
              "rounded-xl p-3 transition-opacity",
              nav === item.id
                ? "bg-brand-primary/20 text-brand-secondary"
                : "text-text-muted hover:bg-surface-hover hover:text-text-primary",
            )}
          >
            <item.icon size={20} />
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "h-full w-full md:w-auto",
            mobileShowThread && nav === "chats" ? "hidden md:flex" : "flex",
          )}
        >
          {nav === "chats" && (
            <ChatList
              activeId={threadId}
              onSelect={(id) => openChat(id)}
              onOpenAi={() => setAiOpen(true)}
            />
          )}
          {nav === "friends" && (
            <div className="h-full w-full md:w-[380px] md:border-r md:border-border">
              <FriendsPanel onOpenChat={openChat} />
            </div>
          )}
          {nav === "settings" && (
            <div className="h-full w-full md:w-[400px] md:border-r md:border-border">
              <ProfileSettings />
            </div>
          )}
        </div>

        <div
          className={cn(
            "min-w-0 flex-1",
            !mobileShowThread || nav !== "chats" ? "hidden md:flex" : "flex",
          )}
        >
          {threadId && nav === "chats" ? (
            <MessageThread
              chatId={threadId}
              onBack={() => setMobileShowThread(false)}
              onStartCall={(callId, callType) =>
                setActiveCall({ callId, callType })
              }
            />
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center bg-canvas px-8 md:flex">
              <BrandLogo className="mb-6 w-full max-w-md rounded-2xl border border-border" />
              <p className="text-sm text-text-muted">
                Select a chat to start messaging
              </p>
              <p className="mt-2 font-mono text-[11px] text-text-muted">
                ⌘K / Ctrl+K · command palette
              </p>
            </div>
          )}
        </div>
      </div>

      <nav className="flex border-t border-border bg-surface md:hidden">
        {(
          [
            { id: "chats" as const, icon: MessageSquare, label: "Chats" },
            { id: "friends" as const, icon: Users, label: "Friends" },
            { id: "settings" as const, icon: Settings, label: "Settings" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setNav(item.id);
              setMobileShowThread(false);
            }}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
              nav === item.id ? "text-brand-secondary" : "text-text-muted",
            )}
          >
            <item.icon size={20} />
            {item.label}
          </button>
        ))}
      </nav>

      <AiLauncher
        open={aiOpen}
        onOpen={() => setAiOpen(true)}
        onClose={() => setAiOpen(false)}
        hidden={Boolean(threadId)}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenChat={openChat}
        onOpenAi={() => setAiOpen(true)}
        onNewGroup={() => setCreateGroup(true)}
      />
      {createGroup && (
        <CreateGroupSheet
          open={createGroup}
          kind="group"
          onClose={() => setCreateGroup(false)}
          onCreated={(id) => {
            setCreateGroup(false);
            openChat(id);
          }}
        />
      )}

      <IncomingCallOverlay />
      {activeCall && (
        <ActiveCallHost
          callId={activeCall.callId}
          callType={activeCall.callType}
          onClose={() => setActiveCall(null)}
        />
      )}
    </div>
  );
}
