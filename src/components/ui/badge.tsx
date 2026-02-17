"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-slate-200 bg-slate-100 text-slate-700",
        instagram: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
        tiktok: "border-cyan-200 bg-cyan-50 text-cyan-700",
        threads: "border-slate-300 bg-slate-100 text-slate-700",
        youtube: "border-red-200 bg-red-50 text-red-700",
        twitter: "border-sky-200 bg-sky-50 text-sky-700",
        slides: "border-emerald-200 bg-emerald-50 text-emerald-700",
        video: "border-violet-200 bg-violet-50 text-violet-700",
        success: "border-emerald-200 bg-emerald-50 text-emerald-700",
        warning: "border-amber-200 bg-amber-50 text-amber-700",
        error: "border-rose-200 bg-rose-50 text-rose-700",
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
