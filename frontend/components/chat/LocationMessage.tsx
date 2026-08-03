"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, X } from "lucide-react";
import type { LocationShare } from "@/lib/types";
import { locationApi } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

const FullMapView = dynamic(() => import("./LocationFullMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#0d1020] text-sm text-text-muted">
      Loading map…
    </div>
  ),
});

function staticMapUrl(lat: number, lng: number) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const center = `${lat},${lng}`;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=15&size=300x160&scale=2&markers=color:0x6E56CF%7C${center}&key=${key}`;
}

function formatCountdown(expiresAt?: string | null) {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "ended";
  const mins = Math.ceil(ms / 60_000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  }
  return `${mins}m`;
}

export function LocationMessage({
  share: initial,
  onStopped,
}: {
  share: LocationShare;
  onStopped?: (share: LocationShare) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const [share, setShare] = useState(initial);
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    setShare(initial);
  }, [initial]);

  const preview = useMemo(
    () => staticMapUrl(share.latitude, share.longitude),
    [share.latitude, share.longitude],
  );

  const isLive =
    share.mode === "live" &&
    share.status === "active" &&
    (!share.expires_at || new Date(share.expires_at).getTime() > Date.now());
  const mine = share.sender_id === me?.id;

  async function stop() {
    setStopping(true);
    try {
      const next = await locationApi.stop(share.id);
      setShare(next);
      onStopped?.(next);
    } finally {
      setStopping(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative block w-72 overflow-hidden rounded-2xl border border-border text-left"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Shared location"
            width={300}
            height={160}
            className="h-40 w-full object-cover"
          />
        ) : (
          <div className="flex h-40 w-full items-center justify-center bg-surface-elevated">
            <MapPin className="text-brand-secondary" size={28} />
          </div>
        )}
        {isLive && (
          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[11px] font-medium text-white">
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
              className="h-1.5 w-1.5 rounded-full bg-white"
            />
            Live · {formatCountdown(share.expires_at)}
          </div>
        )}
        <div className="bg-surface-elevated px-3 py-2 text-xs text-text-secondary">
          {isLive ? "Live location" : "Location"} · tap to open
        </div>
      </button>

      {mine && isLive && (
        <button
          type="button"
          disabled={stopping}
          onClick={() => void stop()}
          className="mt-1 text-[11px] text-danger underline"
        >
          {stopping ? "Stopping…" : "Stop sharing"}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-[#05070d]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="font-medium text-white">
                {isLive ? "Live location" : "Location"}
              </p>
              {isLive && (
                <p className="text-xs text-text-muted">
                  {formatCountdown(share.expires_at)} remaining
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {mine && isLive && (
                <button
                  type="button"
                  onClick={() => void stop()}
                  className="rounded-full bg-danger/90 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-white/80 hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <FullMapView
              share={share}
              interactive
              onShareUpdate={setShare}
            />
          </div>
        </div>
      )}
    </>
  );
}

export function LiveShareBanner({
  share,
  onStop,
}: {
  share: LocationShare;
  onStop: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm",
      )}
    >
      <div className="flex items-center gap-2 text-danger">
        <motion.span
          animate={{ opacity: [1, 0.35, 1] }}
          transition={{ repeat: Infinity, duration: 1.2 }}
          className="h-2 w-2 rounded-full bg-danger"
        />
        Sharing your location · {formatCountdown(share.expires_at)}
      </div>
      <button
        type="button"
        onClick={onStop}
        className="rounded-full bg-danger px-3 py-1 text-xs font-medium text-white"
      >
        Stop
      </button>
    </div>
  );
}
