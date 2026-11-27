import { cx } from "./cx";

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A project's identity: a gradient squircle derived from its name, so every project looks distinct. */
export function ProjectMark({ name, className }: { name: string; className?: string }) {
  const h = hash(name);
  const hueA = h % 360;
  const hueB = (hueA + 40 + ((h >> 9) % 80)) % 360;
  const angle = 110 + ((h >> 5) % 100);

  return (
    <span
      aria-hidden="true"
      style={{
        background: `linear-gradient(${angle}deg, hsl(${hueA} 78% 58%), hsl(${hueB} 82% 44%))`,
      }}
      className={cx("block size-10 shrink-0 rounded-xl ring-1 ring-black/10 ring-inset", className)}
    />
  );
}

/** A person's mark in the sidebar: initial on a gradient. */
export function UserMark({ name, className }: { name: string; className?: string }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <span className={cx("relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white", className)}>
      <ProjectMark name={name} className="absolute inset-0 size-full rounded-full ring-0" />
      <span className="relative">{initial}</span>
    </span>
  );
}
