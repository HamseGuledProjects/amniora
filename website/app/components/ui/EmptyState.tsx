"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title: string;
  description: string;
  buttonText?: string;
  buttonHref?: string;
  icon?: React.ReactNode;
  compact?: boolean;
};

export default function EmptyState({
  title,
  description,
  buttonText,
  buttonHref,
  icon,
  compact = false,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35 }}
      className={`flex justify-center ${compact ? "py-2" : ""}`}
    >
      <div
        className={`w-full rounded-3xl border border-white/10 bg-gradient-to-br from-white/5 via-white/[0.03] to-transparent text-center shadow-2xl backdrop-blur-xl ${
          compact ? "p-6" : "p-12"
        }`}
      >
        <motion.div
          animate={{
            scale: [1, 1.05, 1],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
          }}
          className={`mx-auto flex items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-400 ${
            compact ? "h-14 w-14" : "h-20 w-20"
          }`}
        >
          {icon ?? <Inbox size={compact ? 28 : 36} />}
        </motion.div>

        <h2
          className={`font-bold text-white ${
            compact ? "mt-5 text-xl" : "mt-8 text-3xl"
          }`}
        >
          {title}
        </h2>

        <p
          className={`mx-auto text-gray-400 ${
            compact
              ? "mt-3 max-w-sm text-sm leading-6"
              : "mt-4 max-w-lg text-base leading-7"
          }`}
        >
          {description}
        </p>

        {buttonText && buttonHref && (
          <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            className={compact ? "mt-5" : "mt-8"}
          >
            <Link
              href={buttonHref}
              className="inline-flex items-center rounded-2xl bg-cyan-400 px-6 py-3 font-semibold text-black transition hover:bg-cyan-300"
            >
              {buttonText}
            </Link>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}