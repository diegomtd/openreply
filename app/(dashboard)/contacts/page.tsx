"use client";

/**
 * Contacts Page
 *
 * The people side of the app: who has interacted, what each of them has already
 * received, and a mute switch. This is the screen that answers "why did she get
 * that message five times?" — and the one that stops it.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";

interface ContactAutomation {
  sentCount: number;
  lastSentAt: string;
  automation: { id: string; name: string };
}

interface Contact {
  id: string;
  igsid: string;
  username: string | null;
  firstSeenAt: string;
  lastInboundAt: string | null;
  lastAutomationSentAt: string | null;
  automationSentCount: number;
  optedOut: boolean;
  optedOutReason: string | null;
  tags: string[];
  instagramAccount: { username: string };
  automationStates: ContactAutomation[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "messaged", label: "Already messaged" },
  { value: "never_messaged", label: "Never messaged" },
  { value: "muted", label: "Muted" },
];

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingMute, setPendingMute] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
        filter,
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (selectedAccountId !== "all") {
        params.set("instagramAccountId", selectedAccountId);
      }

      const res = await fetch(`/api/contacts?${params}`);
      const data = await res.json();
      if (data.success) {
        setContacts(data.data.contacts);
        setPagination(data.data.pagination);
      }
    } catch (err) {
      console.error("Failed to fetch contacts:", err);
    } finally {
      setLoading(false);
    }
  }, [page, filter, debouncedSearch, selectedAccountId]);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  // One request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Deferred a tick, the same way the logs page does it: fetching straight from
  // the effect body sets state synchronously and cascades a render.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchContacts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchContacts]);

  async function toggleMute(contact: Contact) {
    setPendingMute(contact.id);
    try {
      const res = await fetch("/api/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: contact.id, optedOut: !contact.optedOut }),
      });
      const data = await res.json();
      if (data.success) {
        setContacts((prev) =>
          prev.map((c) =>
            c.id === contact.id
              ? {
                  ...c,
                  optedOut: !contact.optedOut,
                  optedOutReason: contact.optedOut
                    ? null
                    : "Muted from the Contacts screen",
                }
              : c
          )
        );
      }
    } catch (err) {
      console.error("Failed to update contact:", err);
    } finally {
      setPendingMute(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Everyone who has commented on or messaged your posts, and what your
        automations have already sent them. Mute someone to stop every automation
        for them without touching your campaigns.
      </p>

      {/* Filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setLoading(true);
                setFilter(option.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === option.value
                  ? "bg-accent/15 text-accent border border-accent/20"
                  : "bg-surface text-muted border border-border hover:border-border-hover hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search username or id"
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none sm:w-56"
          />
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={(accountId) => {
                setLoading(true);
                setSelectedAccountId(accountId);
                setPage(1);
              }}
            />
          )}
        </div>
      </div>

      <div className="panel rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">
                  Contact
                </th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">
                  Account
                </th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">
                  Automations sent
                </th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">
                  Last automated DM
                </th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">
                  Last message in
                </th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">
                  Automations
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading &&
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-4 sm:px-6">
                      <div className="h-4 rounded bg-surface-hover" />
                    </td>
                  </tr>
                ))}

              {!loading && contacts.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-muted sm:px-6"
                  >
                    {debouncedSearch || filter !== "all"
                      ? "No contacts match this filter"
                      : "No contacts yet. They appear here the first time someone comments on a post an automation watches, or sends you a DM."}
                  </td>
                </tr>
              )}

              {!loading &&
                contacts.map((contact) => (
                  <Fragment key={contact.id}>
                    <tr className="transition-colors hover:bg-surface-hover/50">
                      <td className="px-4 py-4 sm:px-6">
                        <span className="font-medium text-foreground">
                          @{contact.username ?? contact.igsid.slice(0, 10)}
                        </span>
                        {contact.optedOut && (
                          <span className="ml-2 text-xs text-warning">muted</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-muted sm:px-6">
                        @{contact.instagramAccount.username}
                      </td>
                      <td className="px-4 py-4 text-muted sm:px-6">
                        {contact.automationSentCount}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-muted sm:px-6">
                        {formatDate(contact.lastAutomationSentAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-muted sm:px-6">
                        {formatDate(contact.lastInboundAt)}
                      </td>
                      <td className="px-4 py-4 sm:px-6">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() =>
                              setExpanded(
                                expanded === contact.id ? null : contact.id
                              )
                            }
                            className="text-xs text-muted hover:text-foreground"
                          >
                            {expanded === contact.id ? "Hide" : "History"}
                          </button>
                          <button
                            onClick={() => void toggleMute(contact)}
                            disabled={pendingMute === contact.id}
                            className="text-xs text-muted hover:text-foreground disabled:opacity-40"
                          >
                            {contact.optedOut ? "Unmute" : "Mute"}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {expanded === contact.id && (
                      <tr className="bg-surface/40">
                        <td colSpan={6} className="px-4 py-4 sm:px-6">
                          {contact.optedOut && (
                            <p className="mb-3 text-xs text-warning">
                              Muted —{" "}
                              {contact.optedOutReason ??
                                "no automation will send to this contact"}
                            </p>
                          )}
                          <p className="mb-2 text-xs uppercase tracking-wider text-muted">
                            First seen {formatDate(contact.firstSeenAt)}
                          </p>
                          {contact.automationStates.length === 0 ? (
                            <p className="text-sm text-muted">
                              No automation has sent to this contact yet.
                            </p>
                          ) : (
                            <ul className="space-y-1 text-sm">
                              {contact.automationStates.map((state) => (
                                <li
                                  key={state.automation.id}
                                  className="flex flex-wrap items-baseline gap-2"
                                >
                                  <span className="text-foreground">
                                    {state.automation.name}
                                  </span>
                                  <span className="text-xs text-muted">
                                    {state.sentCount}×, last{" "}
                                    {formatDate(state.lastSentAt)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-6">
            <p className="text-xs text-muted">
              Showing {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => {
                  setLoading(true);
                  setPage(page - 1);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-all hover:border-border-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                Previous
              </button>
              <span className="px-2 text-xs text-muted">
                {page} / {pagination.totalPages}
              </span>
              <button
                disabled={page >= pagination.totalPages}
                onClick={() => {
                  setLoading(true);
                  setPage(page + 1);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-all hover:border-border-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
