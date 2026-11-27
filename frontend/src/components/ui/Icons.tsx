import type { SVGProps } from "react";

import { cx } from "./cx";

/** Small stroke icon set (24px grid). Decorative: always aria-hidden. */
function icon(paths: string[], extra?: (props: SVGProps<SVGSVGElement>) => React.ReactNode) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
        className={cx("size-4 shrink-0", props.className)}
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
        {extra?.(props)}
      </svg>
    );
  };
}

export const PlusIcon = icon(["M12 5v14", "M5 12h14"]);
export const CheckIcon = icon(["M20 6 9 17l-5-5"]);
export const XIcon = icon(["M18 6 6 18", "M6 6l12 12"]);
export const MenuIcon = icon(["M4 6h16", "M4 12h16", "M4 18h16"]);
export const SearchIcon = icon(["M20 20l-3.5-3.5"], () => <circle cx="11" cy="11" r="7" />);
export const ArrowLeftIcon = icon(["M19 12H5", "M12 19l-7-7 7-7"]);
export const ChevronDownIcon = icon(["M6 9l6 6 6-6"]);
export const ChevronRightIcon = icon(["M9 6l6 6-6 6"]);
export const ExternalIcon = icon([
  "M14 4h6v6",
  "M20 4l-9 9",
  "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
]);
export const BranchIcon = icon(["M6 3v12", "M18 9a9 9 0 0 1-9 9"], () => (
  <>
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
  </>
));
export const GridIcon = icon([], () => (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>
));
export const LinkIcon = icon(["M9 17H7A5 5 0 0 1 7 7h2", "M15 7h2a5 5 0 1 1 0 10h-2", "M8 12h8"]);
export const SunIcon = icon(
  [
    "M12 2v2",
    "M12 20v2",
    "M4.93 4.93l1.41 1.41",
    "M17.66 17.66l1.41 1.41",
    "M2 12h2",
    "M20 12h2",
    "M6.34 17.66l-1.41 1.41",
    "M19.07 4.93l-1.41 1.41",
  ],
  () => <circle cx="12" cy="12" r="4" />,
);
export const MoonIcon = icon(["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"]);
export const LogoutIcon = icon(["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"]);
export const CopyIcon = icon(["M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"], () => (
  <rect x="9" y="9" width="13" height="13" rx="2" />
));
export const BoltIcon = icon(["M13 2 3 14h9l-1 8 10-12h-9l1-8z"]);
export const TrashIcon = icon([
  "M3 6h18",
  "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
]);
export const KeyIcon = icon(["M21 2l-9.6 9.6", "M15.5 7.5l3 3L22 7l-3-3"], () => (
  <circle cx="7.5" cy="15.5" r="5.5" />
));
export const SlidersIcon = icon([
  "M4 21v-7",
  "M4 10V3",
  "M12 21v-9",
  "M12 8V3",
  "M20 21v-5",
  "M20 12V3",
  "M1 14h6",
  "M9 8h6",
  "M17 16h6",
]);
export const LayersIcon = icon(["M12 2 2 7l10 5 10-5-10-5z", "M2 17l10 5 10-5", "M2 12l10 5 10-5"]);
export const LockIcon = icon(["M7 11V7a5 5 0 0 1 10 0v4"], () => (
  <rect x="3" y="11" width="18" height="11" rx="2" />
));
export const DownloadIcon = icon(["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"]);
export const GlobeIcon = icon(["M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"], () => (
  <circle cx="12" cy="12" r="10" />
));
export const GitHubIcon = icon([
  "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",
  "M9 18c-4.51 2-5-2-7-2",
]);
