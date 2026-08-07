"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, CheckCheck } from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

const REPLY = "Already there.";

function TypeReveal({
  text,
  active,
  onDone,
}: {
  text: string;
  active: boolean;
  onDone?: () => void;
}) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    setN(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) {
        window.clearInterval(id);
        onDone?.();
      }
    }, 42);
    return () => window.clearInterval(id);
  }, [active, text, onDone]);
  return <>{text.slice(0, n)}</>;
}

function FeatureSection({
  title,
  body,
  index,
}: {
  title: string;
  body: string;
  index: number;
}) {
  const { ref, inView } = useScrollReveal();
  return (
    <section ref={ref} className="mx-auto max-w-3xl px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : undefined}
        transition={{ ...transitions.gentle, delay: index * 0.08 }}
      >
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-text-primary">
          {title}
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-secondary">
          {body}
        </p>
      </motion.div>
    </section>
  );
}

export function HeroSequence({
  onSignIn,
  onCreate,
}: {
  onSignIn: () => void;
  onCreate: () => void;
}) {
  const reduce = useReducedMotion();
  const [beat, setBeat] = useState(reduce ? 4 : 0);
  const [tick, setTick] = useState<"sent" | "delivered" | "read">(
    reduce ? "read" : "sent",
  );

  useEffect(() => {
    if (reduce) return;
    const timers = [
      window.setTimeout(() => setBeat(1), 400),
      window.setTimeout(() => setBeat(2), 650),
      window.setTimeout(() => setBeat(3), 1400),
      window.setTimeout(() => setTick("delivered"), 1500),
      window.setTimeout(() => setTick("read"), 1700),
      window.setTimeout(() => setBeat(4), 1700),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduce]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas">
      <div className="pointer-events-none absolute inset-0 aurora-bg opacity-[0.12]" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-primary/30 blur-3xl" />

      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <BrandLogo variant="mark" priority className="h-10 w-10" />
        <div className="flex items-center gap-2">
          <GhostPillButton onClick={onSignIn}>Sign in</GhostPillButton>
          <AuroraButton onClick={onCreate} className="!px-4 !py-2 text-sm">
            Get started
          </AuroraButton>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 pb-24 pt-10 text-center">
        <div className="mb-10 w-full max-w-sm space-y-3 text-left">
          {(beat >= 1 || reduce) && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transitions.smooth}
              className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand-primary px-3.5 py-2 text-sm text-white"
            >
              You free in 10?
            </motion.div>
          )}

          {(beat >= 2 || reduce) && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-[85%] rounded-2xl rounded-bl-md bg-surface-elevated px-3.5 py-2 text-sm text-text-primary ring-1 ring-border"
            >
              {reduce ? (
                REPLY
              ) : (
                <TypeReveal text={REPLY} active={beat >= 2} />
              )}
              <div className="mt-1 flex items-center justify-end gap-1 font-mono text-[10px] text-text-muted">
                now
                <motion.span
                  key={tick}
                  initial={reduce ? false : { scale: 1 }}
                  animate={
                    tick === "read" && !reduce
                      ? { scale: [1, 1.3, 1] }
                      : { scale: 1 }
                  }
                  transition={{ duration: 0.08 }}
                  className={cn(
                    "inline-flex transition-colors duration-200",
                    tick === "read" ? "text-success" : "text-text-muted",
                  )}
                >
                  {tick === "sent" ? (
                    <Check size={11} />
                  ) : (
                    <CheckCheck size={11} />
                  )}
                </motion.span>
              </div>
            </motion.div>
          )}
        </div>

        <motion.h1
          className={cn(
            "font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight sm:text-5xl",
            beat >= 4 || reduce ? "headline-aurora" : "text-text-primary",
          )}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: beat >= 3 || reduce ? 1 : 0.35 }}
        >
          Say it. It&apos;s already there.
        </motion.h1>
        <p className="mt-4 max-w-md text-sm text-text-secondary">
          TALK-CONNECT keeps every conversation live — chats, status, calls, and
          vault — without the template feel.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <AuroraButton onClick={onCreate}>Create account</AuroraButton>
          <GhostPillButton onClick={onSignIn}>I have an account</GhostPillButton>
        </div>

        <motion.div
          className="mt-14 flex items-center gap-3 rounded-full border border-border bg-surface/80 px-4 py-2"
          animate={
            reduce
              ? undefined
              : { opacity: [0.65, 1, 0.65] }
          }
          transition={
            reduce
              ? undefined
              : { duration: 4, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <span className="status-ring-unseen inline-flex rounded-full p-0.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-elevated text-xs font-medium">
              TC
            </span>
          </span>
          <span className="text-xs text-text-muted">Live · quiet when you need it</span>
        </motion.div>
      </main>

      <FeatureSection
        index={0}
        title="Presence that respects you"
        body="Focus Sync, read receipts you control, and status that doesn't demand attention — built for long sessions, not demos."
      />
      <FeatureSection
        index={1}
        title="Real-time without the wait"
        body="Optimistic sends, live location, and calls that feel immediate — Superhuman's speed floor, applied to messaging."
      />
      <FeatureSection
        index={2}
        title="AI beside the thread"
        body="Ask TALK-CONNECT AI from a persistent launcher without leaving the chat you were just in."
      />
    </div>
  );
}
