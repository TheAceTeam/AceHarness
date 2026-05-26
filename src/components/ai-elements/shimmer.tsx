"use client";

import { cn } from "@/lib/core/utils";
import type { HTMLMotionProps } from "motion/react";
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { memo, useMemo } from "react";

type ShimmerElement = "div" | "p" | "span";

export interface TextShimmerProps {
  children: string;
  as?: ShimmerElement;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread]
  );

  const props: HTMLMotionProps<"p"> = {
    animate: { backgroundPosition: "0% center" },
    className: cn(
      "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
      "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),hsl(var(--background)),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
      className
    ),
    initial: { backgroundPosition: "100% center" },
    style: {
      "--spread": `${dynamicSpread}px`,
      backgroundImage:
        "var(--bg), linear-gradient(hsl(var(--muted-foreground)), hsl(var(--muted-foreground)))",
    } as CSSProperties,
    transition: {
      duration,
      ease: "linear",
      repeat: Number.POSITIVE_INFINITY,
    },
    children,
  };

  if (Component === "span") return <motion.span {...props as HTMLMotionProps<"span">} />;
  if (Component === "div") return <motion.div {...props as HTMLMotionProps<"div">} />;
  return <motion.p {...props} />;
};

export const Shimmer = memo(ShimmerComponent);
