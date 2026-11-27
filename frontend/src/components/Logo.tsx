import { cx } from "./ui";

/** Three bars rising through the heat ramp: rust, ember, gold. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("size-8", className)} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--raised)" />
      <rect x="7" y="16" width="4.5" height="9" rx="2.25" fill="var(--h-rust)" />
      <rect x="13.75" y="11" width="4.5" height="14" rx="2.25" fill="var(--h-ember)" />
      <rect x="20.5" y="6" width="4.5" height="19" rx="2.25" fill="var(--h-gold)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]", className)}>
      <LogoMark />
      ForgeDeploy
    </span>
  );
}
