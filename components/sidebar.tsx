"use client";

/**
 * Sidebar Navigation
 *
 * Text-only nav with active state and workspace section.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Person first, then conversation, then automation — the order ManyChat uses,
 * and the one that keeps "what has this person already had from me?" a question
 * you can actually answer. System pages sit in their own group at the bottom.
 */
const navGroups: { heading: string | null; items: { label: string; href: string }[] }[] = [
  {
    heading: null,
    items: [
      { label: "Home", href: "/dashboard" },
      { label: "Inbox", href: "/inbox" },
      { label: "Contacts", href: "/contacts" },
    ],
  },
  {
    heading: "Automation",
    items: [
      { label: "Automations", href: "/campaigns" },
      { label: "Analytics", href: "/overview" },
      { label: "DM Logs", href: "/logs" },
    ],
  },
  {
    heading: "System",
    items: [
      { label: "Settings", href: "/settings" },
      { label: "Diagnostics", href: "/diagnostics" },
    ],
  },
];

const AUTOMATION_ROUTES = ["/campaigns", "/automations"];

function isAutomationsLink(href: string): boolean {
  return AUTOMATION_ROUTES.includes(href);
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({
  isOpen,
  onClose,
  workspaceName,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-dvh w-64 max-w-[85vw] shrink-0 bg-surface border-r border-border flex flex-col
          transition-transform duration-200 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="px-6 py-5 border-b border-border">
          <Link href="/dashboard" className="text-base font-semibold">
            OpenReply
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {navGroups.map((group, index) => (
            <div key={group.heading ?? `group-${index}`} className="space-y-1">
              {group.heading && (
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  {group.heading}
                </p>
              )}
              {group.items.map((item) => {
                // /campaigns is the Automations entry; /automations is the older
                // route for the same screens, so both light it up.
                const matches = isAutomationsLink(item.href)
                  ? AUTOMATION_ROUTES
                  : [item.href];
                const isActive = matches.some(
                  (href) => pathname === href || pathname.startsWith(href + "/")
                );
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    aria-current={isActive ? "page" : undefined}
                    className={`
                      block px-3 py-2.5 rounded text-sm
                      ${
                        isActive
                          ? "bg-surface-hover text-foreground font-medium"
                          : "text-muted hover:text-foreground hover:bg-surface-hover"
                      }
                    `}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <p className="text-sm text-foreground truncate">{workspaceName}</p>
          <p className="text-xs text-muted">Self-hosted</p>
        </div>
      </aside>
    </>
  );
}
