"use client";

import { Suspense, useEffect, useState } from "react";
import type { AccountOption } from "@/components/account-select";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";

interface SettingsData {
  workspace: {
    name: string;
    dmsSentThisPeriod: number;
  };
  instagramAccount: {
    id: string;
    username: string;
    instagramId: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
  } | null;
  instagramAccounts: Array<
    AccountOption & {
      tokenExpiresAt: string | null;
      webhookSubscribed: boolean;
    }
  >;
}

interface WorkspaceMembersData {
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER";
  members: Array<{
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    inviteUrl: string;
    expiresAt: string;
  }>;
}

interface AutomationRules {
  contactCooldownHours: number;
  optOutKeywords: string[];
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [rules, setRules] = useState<AutomationRules | null>(null);
  const [cooldownDraft, setCooldownDraft] = useState("12");
  const [optOutDraft, setOptOutDraft] = useState("");
  const [rulesSaved, setRulesSaved] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((res) => res.json()),
      fetch("/api/workspace/members").then((res) => res.json()),
      fetch("/api/workspace/settings").then((res) => res.json()),
    ])
      .then(([statsPayload, membersPayload, rulesPayload]) => {
        if (statsPayload.success) setData(statsPayload.data);
        if (membersPayload.success) setMembersData(membersPayload.data);
        if (rulesPayload.success) {
          setRules(rulesPayload.data);
          setCooldownDraft(String(rulesPayload.data.contactCooldownHours));
          setOptOutDraft(rulesPayload.data.optOutKeywords.join(", "));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function refreshMembers() {
    const res = await fetch("/api/workspace/members");
    const payload = await res.json();
    if (payload.success) setMembersData(payload.data);
  }

  async function saveAutomationRules(event: React.FormEvent) {
    event.preventDefault();
    setRulesError(null);
    setRulesSaved(false);
    setBusy("rules");

    const hours = Math.max(0, Math.min(8760, Number(cooldownDraft) || 0));
    const res = await fetch("/api/workspace/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactCooldownHours: hours,
        optOutKeywords: optOutDraft
          .split(",")
          .map((word) => word.trim())
          .filter(Boolean),
      }),
    });
    const payload = await res.json();
    setBusy(null);

    if (!payload.success) {
      setRulesError(payload.error ?? "Não foi possível salvar");
      return;
    }
    setRules(payload.data);
    setCooldownDraft(String(payload.data.contactCooldownHours));
    setOptOutDraft(payload.data.optOutKeywords.join(", "));
    setRulesSaved(true);
  }

  async function disconnectInstagram(instagramAccountId: string) {
    if (
      !confirm(
        "Desconectar o Instagram? As automações desta conta param de enviar DM."
      )
    ) {
      return;
    }

    setBusy(`disconnect:${instagramAccountId}`);
    await fetch("/api/instagram/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId }),
    });
    window.location.reload();
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setBusy("invite");
    const res = await fetch("/api/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
      setInviteEmail("");
    } else {
      setMemberError(payload.error ?? "Não foi possível convidar");
    }
    setBusy(null);
  }

  async function removeInvitation(invitationId: string) {
    setBusy(`invite:${invitationId}`);
    await fetch("/api/workspace/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId }),
    });
    await refreshMembers();
    setBusy(null);
  }

  if (loading) {
    return <div className="panel rounded p-8 h-64" />;
  }

  const accounts = data?.instagramAccounts ?? [];
  const canManageMembers =
    membersData?.currentUserRole === "OWNER" ||
    membersData?.currentUserRole === "ADMIN";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Surfaces the ?instagram= code the OAuth routes redirect back with.
          Needs a Suspense boundary: useSearchParams in a prerendered client
          page fails the production build without one. */}
      <Suspense fallback={null}>
        <InstagramConnectNotice />
      </Suspense>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-6">Conexão com o Instagram</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Status</p>
              <p className="text-xs text-muted mt-0.5">
                Os webhooks de comentário e as respostas privadas dependem
                desta conexão.
              </p>
            </div>
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                accounts.length > 0
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {accounts.length > 0 ? "Conectado" : "Sem conexão"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Contas</p>
              <p className="text-xs text-muted mt-0.5">
                {accounts.length}{" "}
                {accounts.length === 1
                  ? "perfil do Instagram conectado"
                  : "perfis do Instagram conectados"}
              </p>
            </div>
            <span className="text-sm text-muted">
              {accounts.length > 0 ? `${accounts.length} conectada(s)` : "Nenhuma"}
            </span>
          </div>

          <div className="space-y-3 py-3">
            {accounts.length === 0 && (
              <p className="text-sm text-muted">
                Conecte uma conta profissional do Instagram para criar
                automações.
              </p>
            )}
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    @{account.username}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Token expira em{" "}
                    {account.tokenExpiresAt
                      ? new Date(account.tokenExpiresAt).toLocaleDateString("pt-BR")
                      : "data indisponível"}{" "}
                    ·{" "}
                    {account.webhookSubscribed
                      ? "webhook ativo"
                      : "webhook pendente"}
                  </p>
                </div>
                <button
                  onClick={() => disconnectInstagram(account.id)}
                  disabled={busy === `disconnect:${account.id}`}
                  className="inline-flex items-center justify-center rounded border border-error/20 px-4 py-2 text-sm font-medium text-error transition-all hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
                >
                  {busy === `disconnect:${account.id}`
                    ? "Desconectando…"
                    : "Desconectar"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border flex gap-3">
          <a
            href="/api/instagram/connect"
            className="px-4 py-2 rounded text-sm font-medium transition-colors bg-accent text-white hover:bg-accent-hover"
          >
            {accounts.length > 0 ? "Conectar outra conta" : "Conectar Instagram"}
          </a>
        </div>
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-6">Time</h2>
        <div className="space-y-3">
          {membersData?.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {member.user.name ?? member.user.email ?? "Membro sem nome"}
                </p>
                <p className="text-xs text-muted">{member.user.email}</p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted">
                {member.role}
              </span>
            </div>
          ))}
        </div>

        {membersData?.invitations.length ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Convites pendentes
            </p>
            <div className="space-y-3">
              {membersData.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {invitation.email}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {invitation.role} · {invitation.inviteUrl}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(invitation.inviteUrl)
                      }
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                    >
                      Copiar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInvitation(invitation.id)}
                      disabled={busy === `invite:${invitation.id}`}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canManageMembers && (
          <form
            onSubmit={inviteMember}
            className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_140px_auto]"
          >
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="pessoa@email.com"
              className="rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
              required
            />
            <select
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "ADMIN" | "MEMBER")
              }
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
            >
              <option value="MEMBER">Membro</option>
              <option value="ADMIN">Administrador</option>
            </select>
            <button
              type="submit"
              disabled={busy === "invite"}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === "invite" ? "Convidando…" : "Convidar"}
            </button>
            {memberError && (
              <p className="sm:col-span-3 text-sm text-error">{memberError}</p>
            )}
          </form>
        )}
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-2">Regras de automação</h2>
        <p className="mb-6 text-xs text-muted">
          Valem por cima da frequência configurada em cada automação.
        </p>

        <form onSubmit={saveAutomationRules} className="space-y-5">
          <div>
            <label
              htmlFor="contactCooldownHours"
              className="text-sm font-medium text-foreground"
            >
              Nunca mandar duas vezes para a mesma pessoa em menos de
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                id="contactCooldownHours"
                type="number"
                min={0}
                max={8760}
                value={cooldownDraft}
                onChange={(e) => setCooldownDraft(e.target.value)}
                className="w-24 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent/40 focus:outline-none"
              />
              <span className="text-xs text-muted">horas</span>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Um teto que vale para todas as automações somadas, então várias
              campanhas que dão match não enviam cada uma a sua. 0 desliga e
              deixa a frequência por conta de cada automação. Não vale quando a
              pessoa toca num botão — ali ela está pedindo.
            </p>
          </div>

          <div>
            <label
              htmlFor="optOutKeywords"
              className="text-sm font-medium text-foreground"
            >
              Palavras extras de descadastro
            </label>
            <input
              id="optOutKeywords"
              value={optOutDraft}
              onChange={(e) => setOptOutDraft(e.target.value)}
              placeholder="me tira, não quero mais"
              className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-muted">
              Separadas por vírgula. Um DM que seja só uma dessas palavras
              silencia a pessoa em todas as automações. Já vêm de fábrica: parar,
              pare, para, sair, stop, cancelar, cancela, descadastrar,
              desinscrever, remover, unsubscribe, chega.
            </p>
          </div>

          {rulesError && <p className="text-xs text-error">{rulesError}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy === "rules" || !rules}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {busy === "rules" ? "Salvando…" : "Salvar regras"}
            </button>
            {rulesSaved && <span className="text-xs text-success">Salvo</span>}
          </div>
        </form>
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-6">Uso</h2>
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              DMs enviados neste mês
            </p>
            <p className="text-xs text-muted mt-0.5">
              No seu próprio servidor — sem limite de plano.
            </p>
          </div>
          <span className="text-sm font-semibold text-foreground">
            {data?.workspace.dmsSentThisPeriod ?? 0}
          </span>
        </div>
      </section>
    </div>
  );
}
