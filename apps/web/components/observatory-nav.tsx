/**
 * The observatory navigation.
 *
 * A server component: the links are static and the epoch is carried in the URL,
 * so there is nothing to hydrate. The active state is derived from the current
 * pathname with a small client leaf.
 */

"use client";

import { cx } from "@repo/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/", label: "Observatory", note: "network at a glance" },
  { href: "/geodesy", label: "Geodesy", note: "Mogi inversion" },
  { href: "/seismic", label: "Seismic", note: "tremor spectra" },
  { href: "/tephra", label: "Tephra", note: "fingerprints" },
  { href: "/forecast", label: "Forecast", note: "alert engine" },
  { href: "/replay", label: "Replay", note: "time machine" },
  { href: "/models", label: "Models", note: "reference" },
] as const;

export function ObservatoryNav({ epoch }: { epoch: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Observatory sections" className="flex flex-wrap items-center gap-1">
      {SECTIONS.map((section) => {
        const active = section.href === "/" ? pathname === "/" : pathname.startsWith(section.href);
        return (
          <Link
            key={section.href}
            href={`${section.href}?epoch=${epoch}`}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs transition-colors",
              active
                ? "bg-[var(--color-slag)] text-[var(--color-ash)]"
                : "text-[var(--color-ash-dim)] hover:text-[var(--color-ash)]",
            )}
          >
            <span className="font-[family-name:var(--font-display)]">{section.label}</span>
            <span className="ml-1.5 hidden text-[10px] opacity-60 lg:inline">{section.note}</span>
          </Link>
        );
      })}
    </nav>
  );
}
