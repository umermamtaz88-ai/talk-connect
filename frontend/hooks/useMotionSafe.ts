"use client";

import { useReducedMotion } from "framer-motion";
import {
  entranceMotion,
  motionTokens,
  sheetMotion,
  transitions,
} from "@/lib/motion";

export function useMotionSafe() {
  const reduce = useReducedMotion();

  if (reduce) {
    return {
      reduce: true as const,
      entrance: { opacity: 0 },
      entranceAnimate: { opacity: 1 },
      entranceExit: { opacity: 0 },
      transition: { duration: motionTokens.duration.fast },
      sheet: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: motionTokens.duration.fast },
      },
      press: {},
      hoverLift: {},
      spring: transitions.fast,
    };
  }

  return {
    reduce: false as const,
    entrance: entranceMotion.initial,
    entranceAnimate: entranceMotion.animate,
    entranceExit: { opacity: 0, y: 8, scale: 0.98 },
    transition: transitions.smooth,
    sheet: sheetMotion,
    press: { scale: 0.96 },
    hoverLift: { y: -1 },
    spring: transitions.snappy,
  };
}
