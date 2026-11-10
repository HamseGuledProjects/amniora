"use client";

import { motion, useReducedMotion } from "framer-motion";

type AnimatedButtonProps = Omit<
  React.ComponentPropsWithoutRef<"button">,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  children: React.ReactNode;
};

export default function AnimatedButton({
  children,
  className = "",
  ...props
}: AnimatedButtonProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.button
      whileHover={prefersReducedMotion ? undefined : { y: -1 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.99 }}
      transition={{
        duration: 0.15,
        ease: "easeOut",
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.button>
  );
}
