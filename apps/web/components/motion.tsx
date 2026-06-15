"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { defaultMotionTransition, fadeIn, slideUp, staggerContainer, staggerItem } from "@/lib/animations";
import { cn } from "@/lib/utils";

export function PageTransition({ children }: { children: ReactNode }): JSX.Element {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <>{children}</>;
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        animate="visible"
        exit="exit"
        initial="hidden"
        transition={defaultMotionTransition}
        variants={fadeIn}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function MotionList({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div animate="visible" className={className} initial="hidden" variants={staggerContainer}>
      {children}
    </motion.div>
  );
}

export function MotionItem({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} transition={defaultMotionTransition} variants={staggerItem}>
      {children}
    </motion.div>
  );
}

export function SectionReveal({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      transition={defaultMotionTransition}
      variants={slideUp}
      viewport={{ once: true, margin: "-80px" }}
      whileInView="visible"
    >
      {children}
    </motion.div>
  );
}

export function AnimatedNumber({ value, suffix = "", prefix = "", className }: { value: number; suffix?: string; prefix?: string; className?: string }): JSX.Element {
  const reduceMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) {
      setDisplayValue(value);
      return;
    }
    const duration = 720;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion, value]);

  return <span className={className}>{prefix}{displayValue.toLocaleString("en-PK")}{suffix}</span>;
}

export function ProgressBar({ value, tone = "primary", className }: { value: number; tone?: "primary" | "success" | "warning" | "danger"; className?: string }): JSX.Element {
  const reduceMotion = useReducedMotion();
  const normalized = Math.max(0, Math.min(value, 100));
  const toneClass = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive"
  }[tone];
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}>
      <motion.div
        animate={{ scaleX: normalized / 100 }}
        className={cn("h-full origin-left rounded-full", toneClass)}
        initial={{ scaleX: reduceMotion ? normalized / 100 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.72, ease: "easeOut" }}
      />
    </div>
  );
}

export function ScoreRing({ value, label = "score" }: { value: number; label?: string }): JSX.Element {
  const reduceMotion = useReducedMotion();
  const normalized = Math.max(0, Math.min(value, 100));
  const toneClass = normalized >= 75 ? "text-success" : normalized >= 45 ? "text-warning" : "text-destructive";
  return (
    <div className="relative grid size-16 place-items-center">
      <svg aria-hidden="true" className={cn("size-16 -rotate-90", toneClass)} viewBox="0 0 64 64">
        <circle className="text-muted" cx="32" cy="32" fill="none" r="26" stroke="currentColor" strokeWidth="7" />
        <motion.circle
          animate={{ pathLength: normalized / 100 }}
          cx="32"
          cy="32"
          fill="none"
          initial={{ pathLength: reduceMotion ? normalized / 100 : 0 }}
          r="26"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="7"
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeOut" }}
        />
      </svg>
      <span aria-label={`${label} ${normalized}`} className="absolute text-sm font-semibold text-foreground">{normalized}</span>
    </div>
  );
}
