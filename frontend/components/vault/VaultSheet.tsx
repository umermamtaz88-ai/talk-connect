"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { vaultApi } from "@/lib/api";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function VaultSheet({
  open,
  onClose,
  chatId,
  receiverId,
}: {
  open: boolean;
  onClose: () => void;
  chatId?: string;
  receiverId?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [totalChunks, setTotalChunks] = useState(0);
  const [filled, setFilled] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string>("");
  const [meta, setMeta] = useState<{
    expiresHours: number;
    downloadLimit: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  async function startUpload() {
    if (!file) return;
    setUploading(true);
    setStatus("Creating transfer…");
    try {
      const checksum = await sha256Hex(file);
      const transfer = await vaultApi.create({
        filename: file.name,
        sizeBytes: file.size,
        mimeType: file.type || "application/octet-stream",
        checksumSha256: checksum,
        chatId,
        receiverId,
        downloadLimit: 5,
        expiresHours: 72,
      });
      setTotalChunks(transfer.total_chunks);
      setMeta({ expiresHours: 72, downloadLimit: 5 });
      setFilled(new Set());
      setStatus("Uploading chunks…");

      const chunkSize = transfer.chunk_size;
      for (let i = 0; i < transfer.total_chunks; i++) {
        const blob = file.slice(i * chunkSize, (i + 1) * chunkSize);
        await vaultApi.uploadChunk(transfer.id, i, blob);
        setFilled((prev) => new Set(prev).add(i));
      }
      setStatus("complete");
    } catch {
      setStatus("failed");
    } finally {
      setUploading(false);
    }
  }

  const motionSafe = useMotionSafe();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={motionSafe.sheet.initial}
          animate={motionSafe.sheet.animate}
          exit={motionSafe.sheet.exit}
          transition={motionSafe.sheet.transition}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl border border-border bg-surface-elevated p-6 shadow-2xl"
        >
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" />
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Send Large File
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Resumable chunked vault transfer — up to backend VAULT_MAX_BYTES.
          </p>

          <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border px-4 py-8 hover:border-brand-primary">
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setFilled(new Set());
                setTotalChunks(0);
                setStatus("");
              }}
            />
            <span className="text-sm text-text-secondary">
              {file
                ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`
                : "Choose a file"}
            </span>
          </label>

          {totalChunks > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs text-text-muted">
                Chunk grid ({filled.size}/{totalChunks})
              </p>
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(totalChunks, 12)}, minmax(0, 1fr))`,
                }}
              >
                {Array.from({ length: totalChunks }).map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{
                      scale: filled.has(i) ? 1 : 0.8,
                      opacity: filled.has(i) ? 1 : 0.35,
                    }}
                    transition={{ duration: motionTokens.duration.fast }}
                    className={cn(
                      "aspect-square rounded-sm",
                      filled.has(i) ? "bg-success" : "bg-white/10",
                    )}
                  />
                ))}
              </div>
            </div>
          )}

          {meta && (
            <p className="mt-3 text-xs text-text-muted">
              Expires in {meta.expiresHours / 24} days · {meta.downloadLimit}{" "}
              downloads left
            </p>
          )}

          {status && (
            <p className="mt-2 text-sm text-brand-secondary">{status}</p>
          )}

          <div className="mt-5 flex gap-3">
            <GhostPillButton className="flex-1" onClick={onClose}>
              Close
            </GhostPillButton>
            <AuroraButton
              className="flex-1"
              loading={uploading}
              disabled={!file}
              onClick={() => void startUpload()}
            >
              Upload
            </AuroraButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
