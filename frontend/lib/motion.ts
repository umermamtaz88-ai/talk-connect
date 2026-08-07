import type { Transition } from "framer-motion";

export const motionTokens = {
  duration: {
    instant: 0.1,
    fast: 0.15,
    base: 0.2,
    slow: 0.3,
  },
  spring: {
    snappy: { type: "spring", stiffness: 500, damping: 30 } as const,
    smooth: { type: "spring", stiffness: 300, damping: 30 } as const,
    gentle: { type: "spring", stiffness: 200, damping: 25 } as const,
  },
  ease: {
    enter: [0.16, 1, 0.3, 1] as const,
    exit: [0.7, 0, 0.84, 0] as const,
  },
  /** Physics settle on drag release (swipe / reorder). */
  dragSpring: { bounceStiffness: 400, bounceDamping: 28 } as const,
  /** layoutId shared-element transitions (list → thread). */
  sharedElement: {
    type: "spring",
    stiffness: 350,
    damping: 32,
  } as const,
  /** Theme radial wipe. */
  themeWipe: {
    duration: 0.5,
    ease: [0.16, 1, 0.3, 1] as const,
  },
} as const;

/** Exit animations are ~65% of enter duration — feels responsive. */
export function exitDuration(enter: number): number {
  return enter * 0.65;
}

export const transitions = {
  snappy: motionTokens.spring.snappy as Transition,
  smooth: motionTokens.spring.smooth as Transition,
  gentle: motionTokens.spring.gentle as Transition,
  sharedElement: motionTokens.sharedElement as Transition,
  themeWipe: {
    duration: motionTokens.themeWipe.duration,
    ease: motionTokens.themeWipe.ease,
  } as Transition,
  fast: {
    duration: motionTokens.duration.fast,
    ease: motionTokens.ease.enter,
  } as Transition,
  base: {
    duration: motionTokens.duration.base,
    ease: motionTokens.ease.enter,
  } as Transition,
  slow: {
    duration: motionTokens.duration.slow,
    ease: motionTokens.ease.enter,
  } as Transition,
  exitFast: {
    duration: exitDuration(motionTokens.duration.fast),
    ease: motionTokens.ease.exit,
  } as Transition,
  exitBase: {
    duration: exitDuration(motionTokens.duration.base),
    ease: motionTokens.ease.exit,
  } as Transition,
};

/** Sheet enter/exit — transform + opacity only. */
export const sheetMotion = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 16 },
  transition: transitions.gentle,
};

/** Message / list-item entrance — opacity only inside Virtuoso. */
export const entranceMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: transitions.smooth,
};
