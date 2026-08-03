"use client";

import { useEffect, useRef, useState } from "react";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { talkSocket } from "@/lib/ws";
import type { LocationShare } from "@/lib/types";

export default function LocationFullMap({
  share,
  interactive = true,
  onShareUpdate,
}: {
  share: LocationShare;
  interactive?: boolean;
  onShareUpdate?: (share: LocationShare) => void;
}) {
  const { isLoaded } = useJsApiLoader({
    id: "talk-connect-google-map",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
  });

  const [pos, setPos] = useState({
    lat: share.latitude,
    lng: share.longitude,
  });
  const markerRef = useRef<google.maps.Marker | null>(null);

  useEffect(() => {
    setPos({ lat: share.latitude, lng: share.longitude });
  }, [share.latitude, share.longitude]);

  useEffect(() => {
    return talkSocket.on((event) => {
      if (event.type === "location.update") {
        const id = String(
          event.data.locationShareId ?? event.data.shareId ?? "",
        );
        if (id !== share.id) return;
        const lat = Number(event.data.latitude);
        const lng = Number(event.data.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setPos({ lat, lng });
        onShareUpdate?.({
          ...share,
          latitude: lat,
          longitude: lng,
          accuracy_meters:
            event.data.accuracyMeters != null
              ? Number(event.data.accuracyMeters)
              : share.accuracy_meters,
          last_updated_at: new Date().toISOString(),
        });
      }
      if (event.type === "location.stopped") {
        const id = String(
          event.data.locationShareId ?? event.data.shareId ?? "",
        );
        if (id !== share.id) return;
        onShareUpdate?.({
          ...share,
          status: "stopped",
          stopped_early: true,
        });
      }
    });
  }, [share, onShareUpdate]);

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0d1020] text-sm text-text-muted">
        Loading map…
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={{ width: "100%", height: "100%" }}
      center={pos}
      zoom={15}
      options={{
        disableDefaultUI: !interactive,
        gestureHandling: interactive ? "greedy" : "none",
        clickableIcons: false,
      }}
      onLoad={(map) => {
        map.panTo(pos);
      }}
    >
      <Marker
        position={pos}
        onLoad={(m) => {
          markerRef.current = m;
        }}
      />
    </GoogleMap>
  );
}
