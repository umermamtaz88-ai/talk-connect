"use client";

import { useCallback, useRef, useState } from "react";

type VoiceRecorderState = "idle" | "recording" | "processing";

/**
 * Tap-to-toggle voice notes. Hold-to-record is unreliable because
 * getUserMedia is async and pointer-up often fires before "recording" state.
 */
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
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
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
      recorder.start(100);
      setRecorderState("recording");
    } catch {
      stopStream();
      setError("Allow microphone access to send voice notes");
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
        if (recorder.state === "recording") recorder.requestData?.();
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
    setRecorderState("idle");
  }, []);

  return { state, error, start, stop, cancel, setError, stateRef };
}
