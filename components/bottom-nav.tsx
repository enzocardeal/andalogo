"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { strings } from "@/lib/strings";

const HIDDEN_ON = ["/login", "/invite"];

type Section = "favorites" | "map";

type NavItem = { href: string; label: string; icon: ReactNode; active: boolean };

export function BottomNav() {
  const pathname = usePathname();
  return HIDDEN_ON.includes(pathname) ? null : <BottomNavBar current={sectionOf(pathname)} />;
}

function sectionOf(pathname: string): Section | null {
  if (pathname === "/") {
    return "favorites";
  }
  return pathname === "/map" ? "map" : null;
}

export function BottomNavBar({ current }: { current: Section | null }) {
  const items: NavItem[] = [
    { href: "/", label: strings.nav.favorites, icon: <StarIcon />, active: current === "favorites" },
    { href: "/map", label: strings.nav.map, icon: <MapIcon />, active: current === "map" },
  ];

  return (
    <nav
      aria-label={strings.nav.label}
      className="sticky bottom-0 z-40 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-(--bottom-nav-height) max-w-md">
        {items.map((item) => (
          <li key={item.href} className="flex flex-1">
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                item.active ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-6"
    >
      {children}
    </svg>
  );
}

export function StarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <Icon>
      <path
        d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
        fill={filled ? "currentColor" : "none"}
      />
    </Icon>
  );
}

function MapIcon() {
  return (
    <Icon>
      <path d="M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5z" />
      <path d="M9 4v13.5" />
      <path d="M15 6.5V20" />
    </Icon>
  );
}
