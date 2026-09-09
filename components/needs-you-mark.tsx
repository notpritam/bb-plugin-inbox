import type { SVGProps } from "react";

/** Needs You's attention inbox: shared geometry with assets/icon.svg. */
export function NeedsYouMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M13 4H7a2 2 0 0 0-1.94 1.51L3 14v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4l-1-4M3 14h5l2 3h4l2-3h5" />
    <circle cx="18" cy="5" r="3" fill="currentColor" stroke="none" />
  </svg>;
}
