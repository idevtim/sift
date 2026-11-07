import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-teal text-white hover:bg-tealtx disabled:bg-disabled disabled:hover:bg-disabled",
  ink: "bg-ink text-surface",
  plain: "bg-surface text-ink",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
}

/** Large pill button (17/600). Presses down to 0.97. */
export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-pointer rounded-full px-7 py-4 text-[17px] font-semibold transition-[background-color,transform] duration-200 active:scale-[.97] disabled:cursor-default disabled:active:scale-100",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
