"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-zinc-800 text-zinc-300 border border-zinc-700",
        instagram: "bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-pink-300 border border-pink-500/30",
        tiktok: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
        youtube: "bg-red-500/20 text-red-300 border border-red-500/30",
        twitter: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
        slides: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
        video: "bg-violet-500/20 text-violet-300 border border-violet-500/30",
        success: "bg-green-500/20 text-green-300 border border-green-500/30",
        warning: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
        error: "bg-red-500/20 text-red-300 border border-red-500/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
