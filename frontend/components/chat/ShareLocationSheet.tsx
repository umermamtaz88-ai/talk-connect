"use client";

import { useState } from "react";
import { MapPin, Navigation, X } from "lucide-react";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { locationApi } from "@/lib/api";
import type { LocationShare, Message } from "@/lib/types";

const DURATIONS = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 480, label: "8 hours" },
];

export function ShareLocationSheet({
  open,
  chatId,
  onClose,
  onSent,
}: {
  open: boolean;
  chatId: string;
  onClose: () => void;
  onSent: (msg: Message, share: LocationShare) => void;
}) {
  const [mode, setMode] = useState<"pick" | "live">("pick");
  const [duration, setDuration] = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported on this device"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 5_000,
      });
    });
  }

  async function sendStatic() {
    setLoading(true);
    setError(null);
    try {
      const pos = await getPosition();
      const msg = await locationApi.sendStatic(chatId, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy,
      });
      if (msg.location_share) onSent(msg, msg.location_share);
      onClose();
    } catch (err) {
      setError(
        err instanceof GeolocationPositionError
          ? "Location permission denied"
          : err instanceof Error
            ? err.message
            : "Could not share location",
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendLive() {
    setLoading(true);
    setError(null);
    try {
      const pos = await getPosition();
      const msg = await locationApi.startLive(chatId, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        durationMinutes: duration,
        accuracyMeters: pos.coords.accuracy,
      });
      if (msg.location_share) onSent(msg, msg.location_share);
      onClose();
    } catch (err) {
      setError(
        err instanceof GeolocationPositionError
          ? "Location permission denied"
          : err instanceof Error
            ? err.message
            : "Could not start live share",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 md:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-t-3xl border border-border bg-surface-elevated p-5 shadow-2xl md:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Share location</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-text-muted hover:bg-surface-hover"
          >
            <X size={16} />
          </button>
        </div>

        {mode === "pick" ? (
          <div className="space-y-2">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl border border-border px-4 py-3 text-left hover:bg-surface-hover"
              onClick={() => void sendStatic()}
              disabled={loading}
            >
              <MapPin className="text-brand-secondary" size={18} />
              <div>
                <p className="text-sm font-medium">Send current location</p>
                <p className="text-xs text-text-muted">One-time pin on the map</p>
              </div>
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl border border-border px-4 py-3 text-left hover:bg-surface-hover"
              onClick={() => setMode("live")}
              disabled={loading}
            >
              <Navigation className="text-danger" size={18} />
              <div>
                <p className="text-sm font-medium">Share live location</p>
                <p className="text-xs text-text-muted">
                  Updates in real time for a set duration
                </p>
              </div>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">How long should we share?</p>
            <div className="space-y-1">
              {DURATIONS.map((d) => (
                <label
                  key={d.minutes}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-hover"
                >
                  <input
                    type="radio"
                    checked={duration === d.minutes}
                    onChange={() => setDuration(d.minutes)}
                  />
                  <span className="text-sm">{d.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <GhostPillButton className="flex-1" onClick={() => setMode("pick")}>
                Back
              </GhostPillButton>
              <AuroraButton
                className="flex-1"
                loading={loading}
                onClick={() => void sendLive()}
              >
                Start sharing
              </AuroraButton>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {loading && mode === "pick" && (
          <p className="mt-3 text-center text-xs text-text-muted">
            Requesting location permission…
          </p>
        )}
      </div>
    </div>
  );
}
