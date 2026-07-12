import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  className,
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "active" }) {
  return (
    <button
      {...props}
      className={cn(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "active" && "btn-active",
        className,
      )}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("input", className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("card", className)}>{children}</section>;
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("badge", className)}>{children}</span>;
}
