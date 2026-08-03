"use client";

const SOUND_SRC = "/sounds/nokia_nokia.mp3";

let audio: HTMLAudioElement | null = null;
let unlocked = false;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(SOUND_SRC);
    audio.preload = "auto";
    audio.volume = 0.85;
  }
  return audio;
}

/** Browsers block Audio until a user gesture — unlock on first click/keydown. */
export function unlockNotificationSound() {
  if (unlocked || typeof window === "undefined") return;
  const a = getAudio();
  a.muted = true;
  void a
    .play()
    .then(() => {
      a.pause();
      a.currentTime = 0;
      a.muted = false;
      unlocked = true;
    })
    .catch(() => {
      /* still locked; next gesture will retry */
    });
}

export function playMessageNotification() {
  if (typeof window === "undefined") return;
  const a = getAudio();
  try {
    a.currentTime = 0;
    void a.play().catch(() => {
      unlockNotificationSound();
    });
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  const unlock = () => unlockNotificationSound();
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
}
