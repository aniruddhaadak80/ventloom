import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ventloom — weave volcanic signals into an eruption forecast",
    template: "%s · ventloom",
  },
  description:
    "A deterministic volcano observatory. Seismic, GNSS, infrasound, gas and thermal channels over a seeded synthetic network, a real Mogi geodetic inversion, and an auditable alert-level engine. Runs offline with no API keys.",
  applicationName: "ventloom",
  authors: [{ name: "Aniruddha Adak" }],
  keywords: [
    "volcanology",
    "geodesy",
    "Mogi model",
    "seismology",
    "tephra",
    "alert level",
    "Next.js",
    "TypeScript",
    "monorepo",
  ],
  openGraph: {
    type: "website",
    siteName: "ventloom",
    title: "ventloom — weave volcanic signals into an eruption forecast",
    description:
      "A deterministic volcano observatory with a real Mogi geodetic inversion and an auditable alert-level engine. No API keys, no network.",
  },
};

export const viewport = {
  themeColor: "#0b0a09",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--color-lava)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--color-abyss)]"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
