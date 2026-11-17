import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-teal text-white shadow-[0_10px_24px_-10px_rgba(31,138,118,.6)] hover:bg-tealtx disabled:bg-disabled disabled:shadow-none disabled:hover:bg-disabled",
  ink: "bg-ink text-surface",
  plain: "bg-glass-hi text-ink",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
}

/** Large pill button (17/600). Springs up on hover and squishes on press. */
export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-pointer rounded-full px-7 py-4 text-[17px] font-semibold transition-[background-color,transform] duration-500 ease-spring hover:scale-[1.03] active:scale-[.95] disabled:cursor-default disabled:hover:scale-100 disabled:active:scale-100",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
