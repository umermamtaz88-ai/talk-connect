"use client";

import { useCallback, useRef, useState } from "react";

type VoiceRecorderState = "idle" | "recording" | "processing";

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export function useVoiceRecorder() {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stateRef = useRef<VoiceRecorderState>("idle");

  const setRecorderState = (next: VoiceRecorderState) => {
    stateRef.current = next;
    setState(next);
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = useCallback(async () => {
    setError(null);
    if (stateRef.current === "recording" || stateRef.current === "processing") {
      return;
    }
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) {
      setError("Voice needs HTTPS — open the live site, not http://");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone not supported in this browser");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("Voice recording not supported on this device");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRef.current = recorder;
      recorder.start(100);
      setRecorderState("recording");
    } catch (err) {
      stopStream();
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(
          "Microphone blocked — allow mic in browser site settings, then tap mic again",
        );
      } else if (name === "NotFoundError") {
        setError("No microphone found on this device");
      } else {
        setError("Could not start microphone — try again");
      }
      setRecorderState("idle");
    }
  }, []);

  const stop = useCallback(async (): Promise<File | null> => {
    const recorder = mediaRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecorderState("idle");
      stopStream();
      return null;
    }
    setRecorderState("processing");
    const blob = await new Promise<Blob | null>((resolve) => {
      const finish = () => {
        const type = recorder.mimeType || "audio/webm";
        const data = chunksRef.current;
        resolve(data.length ? new Blob(data, { type }) : null);
      };
      recorder.onstop = finish;
      try {
        if (recorder.state === "recording") {
          try {
            recorder.requestData();
          } catch {
            /* optional */
          }
        }
        recorder.stop();
      } catch {
        finish();
      }
    });
    stopStream();
    mediaRef.current = null;
    setRecorderState("idle");
    if (!blob || blob.size < 80) return null;
    const ext = blob.type.includes("mp4")
      ? "m4a"
      : blob.type.includes("ogg")
        ? "ogg"
        : "webm";
    return new File([blob], `voice-${Date.now()}.${ext}`, {
      type: blob.type.split(";")[0] || "audio/webm",
    });
  }, []);

  const cancel = useCallback(() => {
    try {
      mediaRef.current?.stop();
    } catch {
      /* ignore */
    }
    mediaRef.current = null;
    chunksRef.current = [];
    stopStream();
    setRecorderState("idle");
    setError(null);
  }, []);

  return { state, error, start, stop, cancel, setError, stateRef };
}
