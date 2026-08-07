"use client";

import { useRef } from "react";
import { useInView, type UseInViewOptions } from "framer-motion";

/** Once-only scroll reveal for marketing sections (no re-trigger on scroll-up). */
export function useScrollReveal(
  margin: UseInViewOptions["margin"] = "-15% 0px",
) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin });
  return { ref, inView };
}
