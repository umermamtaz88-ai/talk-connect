"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
} from "lucide-react";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { IconOrbButton } from "@/components/ui/IconOrbButton";
import { Avatar } from "@/components/ui/Avatar";
import { callsApi } from "@/lib/api";
import { useAppStore } from "@/lib/stores/app";
import { useAuthStore } from "@/lib/stores/auth";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { transitions } from "@/lib/motion";

export function IncomingCallOverlay() {
  const call = useAppStore((s) => s.incomingCall);
  const setIncomingCall = useAppStore((s) => s.setIncomingCall);
  const motionSafe = useMotionSafe();
  const [active, setActive] = useState<{
    callId: string;
    callType: "audio" | "video";
  } | null>(null);

  if (!call && !active) return null;

  if (call && !active) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-canvas/95 backdrop-blur-md"
      >
        <motion.div
          animate={
            motionSafe.reduce
              ? { opacity: 0.4 }
              : { scale: [1, 1.08, 1], opacity: [0.6, 0.3, 0.6] }
          }
          transition={{ duration: 1.4, repeat: Infinity }}
          className="absolute h-48 w-48 rounded-full bg-[linear-gradient(135deg,#6E56CF,#FF6B6B)] opacity-40 blur-2xl"
        />
        <Avatar name="Caller" size={96} className="relative z-10 ring-4 ring-brand-secondary/40" />
        <p className="relative z-10 mt-6 text-xl font-semibold">Incoming {call.callType} call</p>
        <p className="relative z-10 text-sm text-text-secondary">{call.fromUserId}</p>
        <motion.div
          initial={motionSafe.reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
          animate={motionSafe.reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
          transition={transitions.gentle}
          className="relative z-10 mt-12 flex gap-4"
        >
          <GhostPillButton
            danger
            onClick={() => setIncomingCall(null)}
          >
            Decline
          </GhostPillButton>
          <AuroraButton
            className="!bg-[linear-gradient(135deg,#2DD4BF,#6E56CF)]"
            onClick={async () => {
              await callsApi.join(call.callId);
              setActive({ callId: call.callId, callType: call.callType });
              setIncomingCall(null);
            }}
          >
            Accept
          </AuroraButton>
        </motion.div>
      </motion.div>
    );
  }

  if (!active) return null;

  return (
    <CallScreen
      callId={active.callId}
      callType={active.callType}
      onLeave={() => setActive(null)}
    />
  );
}

export function CallScreen({
  callId,
  callType,
  onLeave,
}: {
  callId: string;
  callType: "audio" | "video";
  onLeave: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(callType === "audio");
  const [sharing, setSharing] = useState(false);

  return (
    <motion.div
      layout
      className="fixed inset-0 z-[60] flex flex-col bg-canvas"
    >
      <div className="grid flex-1 grid-cols-1 gap-2 p-3 md:grid-cols-2">
        <motion.div
          layout
          layoutId="self-tile"
          className={`relative overflow-hidden rounded-2xl bg-surface ${
            sharing ? "md:col-span-2 md:row-span-2" : ""
          }`}
        >
          <div className="flex h-full min-h-[200px] items-center justify-center">
            <Avatar name={me?.display_name} url={me?.avatar_url} size={80} />
          </div>
          <span className="absolute right-2 bottom-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
            {sharing ? "screen_sharing" : "on_call"} · You
          </span>
        </motion.div>
        <motion.div
          layout
          className="relative overflow-hidden rounded-2xl bg-surface-elevated"
        >
          <div className="flex h-full min-h-[200px] items-center justify-center text-text-muted">
            Peer
          </div>
          <span className="absolute right-2 bottom-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
            on_call
          </span>
        </motion.div>
      </div>

      <div className="flex items-center justify-center gap-3 border-t border-border py-5">
        <IconOrbButton
          ariaLabel={muted ? "Unmute" : "Mute"}
          active={!muted}
          danger={muted}
          onClick={() => setMuted((v) => !v)}
        >
          {muted ? <MicOff size={20} /> : <Mic size={20} />}
        </IconOrbButton>
        <IconOrbButton
          ariaLabel={camOff ? "Camera on" : "Camera off"}
          active={!camOff}
          danger={camOff}
          onClick={() => setCamOff((v) => !v)}
        >
          {camOff ? <VideoOff size={20} /> : <Video size={20} />}
        </IconOrbButton>
        <IconOrbButton
          ariaLabel="Screen share"
          active={sharing}
          onClick={async () => {
            const next = !sharing;
            await callsApi.screenShare(callId, next);
            setSharing(next);
          }}
        >
          <MonitorUp size={20} />
        </IconOrbButton>
        <IconOrbButton
          ariaLabel="Leave call"
          danger
          onClick={async () => {
            await callsApi.leave(callId);
            onLeave();
          }}
        >
          <PhoneOff size={20} />
        </IconOrbButton>
      </div>
    </motion.div>
  );
}

export function ActiveCallHost({
  callId,
  callType,
  onClose,
}: {
  callId: string;
  callType: "audio" | "video";
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      <CallScreen callId={callId} callType={callType} onLeave={onClose} />
    </AnimatePresence>
  );
}
