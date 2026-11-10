"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

type RevealDirection = "up" | "left" | "right" | "scale";

type RevealProps = HTMLMotionProps<"div"> & {
  direction?: RevealDirection;
  delay?: number;
  viewportReveal?: boolean;
};

function initialFor(direction: RevealDirection, reducedMotion: boolean) {
  if (reducedMotion) return { opacity: 1 };
  if (direction === "left") return { opacity: 1, x: -12 };
  if (direction === "right") return { opacity: 1, x: 12 };
  if (direction === "scale") return { opacity: 1, scale: 0.99 };
  return { opacity: 1, y: 12 };
}

export function Reveal({
  direction = "up",
  delay = 0,
  viewportReveal = true,
  transition,
  ...props
}: RevealProps) {
  const reducedMotion = useReducedMotion();
  const visible = { opacity: 1, x: 0, y: 0, scale: 1 };

  return (
    <motion.div
      initial={initialFor(direction, Boolean(reducedMotion))}
      {...(viewportReveal
        ? {
            whileInView: visible,
            viewport: { once: true, amount: 0.16 },
          }
        : { animate: visible })}
      transition={{
        duration: reducedMotion ? 0 : 0.38,
        delay: reducedMotion ? 0 : delay,
        ease: [0.22, 1, 0.36, 1],
        ...transition,
      }}
      {...props}
    />
  );
}
