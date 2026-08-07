"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { InputField } from "@/components/ui/primitives";
import { ApiError, authApi } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { cn } from "@/lib/utils";

type Step = "login" | "register" | "verify" | "totp";

function digitsOnly(value: string, max = 6) {
  return value.replace(/\D/g, "").slice(0, max);
}

function unverifiedPayload(err: ApiError): {
  email?: string;
  verification_code?: string | null;
  message?: string;
} | null {
  const detail = err.body && typeof err.body === "object"
    ? (err.body as { detail?: unknown }).detail
    : null;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const d = detail as Record<string, unknown>;
  if (d.code !== "unverified") return null;
  return {
    email: typeof d.email === "string" ? d.email : undefined,
    verification_code:
      typeof d.verification_code === "string" ? d.verification_code : null,
    message: typeof d.message === "string" ? d.message : undefined,
  };
}

function OtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");

  function setAt(index: number, char: string) {
    const chars = value.split("");
    while (chars.length < 6) chars.push("");
    chars[index] = char;
    onChange(chars.join("").replace(/\s/g, "").slice(0, 6));
  }

  return (
    <div className="flex justify-center gap-2" onPaste={(e) => {
      e.preventDefault();
      const pasted = digitsOnly(e.clipboardData.getData("text"));
      if (pasted) {
        onChange(pasted);
        refs.current[Math.min(pasted.length, 5)]?.focus();
      }
    }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          value={d.trim()}
          aria-label={`Digit ${i + 1}`}
          className={cn(
            "h-12 w-11 rounded-xl border border-border bg-surface text-center font-mono text-xl text-text-primary outline-none transition",
            "focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20",
            disabled && "opacity-60",
          )}
          onChange={(e) => {
            const next = digitsOnly(e.target.value, 1);
            setAt(i, next);
            if (next && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i].trim() && i > 0) {
              refs.current[i - 1]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
}

export function AuthForm({
  initialStep = "login",
}: {
  initialStep?: Step;
}) {
  const router = useRouter();
  const loginWithToken = useAuthStore((s) => s.loginWithToken);
  const motionSafe = useMotionSafe();

  const [step, setStep] = useState<Step>(initialStep);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [showTotpDrawer, setShowTotpDrawer] = useState(false);
  const autoSubmitRef = useRef<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Auto-submit once when all 6 digits are entered
  useEffect(() => {
    const otp = digitsOnly(code);
    if (step !== "verify" || otp.length !== 6 || loading) return;
    if (autoSubmitRef.current === otp) return;
    autoSubmitRef.current = otp;
    void handleVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step, loading]);

  function goVerify(opts?: {
    email?: string;
    code?: string | null;
    emailed?: boolean;
    message?: string;
  }) {
    if (opts?.email) setEmail(opts.email);
    setDevCode(opts?.code ?? null);
    setEmailed(Boolean(opts?.emailed));
    setCode("");
    setError(null);
    setInfo(opts?.message ?? null);
    setResendIn(60);
    autoSubmitRef.current = null;
    setStep("verify");
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await authApi.register({
        username: username.trim(),
        email: email.trim().toLowerCase(),
        password,
        display_name: (displayName || username).trim(),
      });
      goVerify({
        email: res.email ?? email.trim().toLowerCase(),
        code: res.verification_code ?? null,
        emailed: res.emailed,
        message: res.emailed
          ? `We sent a 6-digit code to ${res.email ?? email}.`
          : "Enter the 6-digit code below to verify your account.",
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e?: React.FormEvent) {
    e?.preventDefault();
    const otp = digitsOnly(code);
    if (otp.length !== 6) {
      setError("Enter the full 6-digit code");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const login = await authApi.verifyEmail({
        email: email.trim().toLowerCase(),
        code: otp,
        device_name: navigator.userAgent.slice(0, 80),
      });
      await loginWithToken(login.access_token);
      router.replace("/app");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Verification failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendIn > 0 || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.resendVerification(email.trim().toLowerCase());
      if (res.verification_code) setDevCode(res.verification_code);
      setEmailed(Boolean(res.emailed));
      setInfo(
        res.emailed
          ? "A new code was sent to your email."
          : "A new code is ready — enter it below.",
      );
      setCode("");
      setResendIn(60);
      autoSubmitRef.current = null;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resend code");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const login = await authApi.login({
        email: email.trim().toLowerCase(),
        password,
        device_name: navigator.userAgent.slice(0, 80),
        totp_code: totp || undefined,
      });
      await loginWithToken(login.access_token);
      router.replace("/app");
    } catch (err) {
      if (err instanceof ApiError) {
        const unverified = unverifiedPayload(err);
        if (unverified) {
          goVerify({
            email: unverified.email ?? email.trim().toLowerCase(),
            code: unverified.verification_code,
            emailed: true,
            message:
              unverified.message ??
              "Account not verified yet. Enter the code we sent.",
          });
        } else {
          const detail = String(err.message).toLowerCase();
          if (detail.includes("2fa") || detail.includes("totp")) {
            setShowTotpDrawer(true);
            setStep("totp");
            setError("Enter your 2FA code");
          } else {
            setError(err.message);
          }
        }
      } else {
        setError("Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex h-full min-h-screen w-full">
      <div className="relative hidden w-[55%] overflow-hidden aurora-bg lg:block">
        <div className="absolute inset-0 bg-[#05070d]/55" />
        <BrandLogo variant="fill" priority className="opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-canvas/50" />
      </div>

      <div className="flex w-full flex-col justify-center bg-canvas px-8 py-12 lg:w-[45%] lg:px-16">
        <div className="mb-10 lg:hidden">
          <BrandLogo priority className="mx-auto w-full max-w-xs rounded-2xl" />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step === "totp" ? "login" : step}
            initial={motionSafe.entrance}
            animate={motionSafe.entranceAnimate}
            exit={{ opacity: 0, x: -40 }}
            transition={motionSafe.transition}
          >
            {step === "login" || step === "totp" ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
                  Welcome back
                </h2>
                <p className="mb-2 text-sm text-text-secondary">
                  Sign in to continue chatting.
                </p>
                <InputField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <InputField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                {error && (
                  <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                    {error}
                  </p>
                )}
                <AuroraButton type="submit" loading={loading} className="mt-2 w-full">
                  Sign in
                </AuroraButton>
                <GhostPillButton
                  type="button"
                  className="w-full"
                  onClick={() => {
                    setStep("register");
                    setError(null);
                    setInfo(null);
                  }}
                >
                  Create account
                </GhostPillButton>
              </form>
            ) : null}

            {step === "register" ? (
              <form onSubmit={handleRegister} className="flex flex-col gap-4">
                <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
                  Create account
                </h2>
                <p className="mb-1 text-sm text-text-secondary">
                  We&apos;ll email you a 6-digit code to verify.
                </p>
                <InputField
                  label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  autoComplete="username"
                />
                <InputField
                  label="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                />
                <InputField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <InputField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                {error && <p className="text-sm text-danger">{error}</p>}
                <AuroraButton type="submit" loading={loading} className="mt-2 w-full">
                  Send verification code
                </AuroraButton>
                <GhostPillButton
                  type="button"
                  className="w-full"
                  onClick={() => setStep("login")}
                >
                  Back to sign in
                </GhostPillButton>
              </form>
            ) : null}

            {step === "verify" ? (
              <form onSubmit={handleVerify} className="flex flex-col gap-4">
                <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
                  Enter verification code
                </h2>
                <p className="text-sm text-text-secondary">
                  {emailed
                    ? `Check your inbox for the code sent to `
                    : `Enter the 6-digit code for `}
                  <span className="font-medium text-text-primary">{email}</span>
                </p>

                {info && (
                  <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-secondary">
                    {info}
                  </p>
                )}

                {devCode && (
                  <div className="rounded-xl border border-brand-primary/30 bg-brand-primary/10 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-brand-secondary">
                      Your code {emailed ? "(also emailed)" : "(dev / local)"}
                    </p>
                    <p className="mt-1 font-mono text-2xl tracking-[0.35em] text-text-primary">
                      {devCode}
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-xs text-brand-secondary underline"
                      onClick={() => {
                        setCode(devCode);
                      }}
                    >
                      Use this code
                    </button>
                  </div>
                )}

                <OtpInput value={code} onChange={setCode} disabled={loading} />

                {error && (
                  <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </p>
                )}

                <AuroraButton
                  type="submit"
                  loading={loading}
                  className="w-full"
                  disabled={digitsOnly(code).length !== 6}
                >
                  Verify & continue
                </AuroraButton>

                <div className="flex items-center justify-between gap-2">
                  <GhostPillButton
                    type="button"
                    onClick={() => {
                      setStep("register");
                      setError(null);
                      setInfo(null);
                    }}
                  >
                    Back
                  </GhostPillButton>
                  <button
                    type="button"
                    disabled={resendIn > 0 || loading}
                    onClick={() => void handleResend()}
                    className="text-sm text-brand-secondary disabled:text-text-muted"
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                  </button>
                </div>
              </form>
            ) : null}
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {showTotpDrawer && (
            <motion.div
              initial={motionSafe.sheet.initial}
              animate={motionSafe.sheet.animate}
              exit={motionSafe.sheet.exit}
              transition={motionSafe.sheet.transition}
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border border-border bg-surface-elevated p-6 shadow-2xl lg:absolute lg:inset-x-8"
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" />
              <h3 className="mb-2 text-lg font-semibold">Two-factor code</h3>
              <p className="mb-4 text-sm text-text-secondary">
                Enter the code from your authenticator app.
              </p>
              <InputField
                value={totp}
                onChange={(e) => setTotp(digitsOnly(e.target.value))}
                maxLength={6}
                inputMode="numeric"
                className="mb-4 text-center font-mono text-2xl tracking-[0.4em]"
                autoFocus
              />
              <div className="flex gap-3">
                <GhostPillButton
                  className="flex-1"
                  onClick={() => {
                    setShowTotpDrawer(false);
                    setTotp("");
                  }}
                >
                  Cancel
                </GhostPillButton>
                <AuroraButton
                  className="flex-1"
                  loading={loading}
                  onClick={() =>
                    handleLogin({
                      preventDefault() {},
                    } as React.FormEvent)
                  }
                >
                  Confirm
                </AuroraButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
