"use client";

import { useCallback, useRef, useState } from "react";

type VoiceRecorderState = "idle" | "recording" | "processing";

export function useVoiceRecorder() {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = useCallback(async () => {
    setError(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Microphone not supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRef.current = recorder;
      recorder.start(200);
      setState("recording");
    } catch {
      stopStream();
      setError("Microphone permission denied");
      setState("idle");
    }
  }, []);

  const stop = useCallback(async (): Promise<File | null> => {
    const recorder = mediaRef.current;
    if (!recorder || recorder.state === "inactive") {
      setState("idle");
      stopStream();
      return null;
    }
    setState("processing");
    const blob = await new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const data = chunksRef.current;
        resolve(data.length ? new Blob(data, { type }) : null);
      };
      try {
        recorder.stop();
      } catch {
        resolve(null);
      }
    });
    stopStream();
    mediaRef.current = null;
    setState("idle");
    if (!blob || blob.size < 200) return null;
    const ext = blob.type.includes("ogg") ? "ogg" : "webm";
    return new File([blob], `voice-${Date.now()}.${ext}`, {
      type: blob.type || "audio/webm",
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
    setState("idle");
  }, []);

  return { state, error, start, stop, cancel, setError };
}
