"use client";

import { useEffect, useRef } from "react";
import { locationApi } from "@/lib/api";
import type { LocationShare } from "@/lib/types";

/** Throttled watchPosition → PATCH while a live share is active. */
export function useLiveLocationWatcher(
  share: LocationShare | null,
  enabled: boolean,
) {
  const lastSent = useRef(0);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !share || share.mode !== "live" || share.status !== "active") {
      if (watchId.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      return;
    }

    if (!navigator.geolocation) return;

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const interval = document.hidden ? 20_000 : 8_000;
        if (now - lastSent.current < interval) return;
        lastSent.current = now;
        void locationApi
          .update(share.id, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
          })
          .catch(() => {
            /* share may have expired */
          });
      },
      () => {
        /* permission revoked mid-share */
      },
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );

    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [share?.id, share?.mode, share?.status, enabled]);
}
