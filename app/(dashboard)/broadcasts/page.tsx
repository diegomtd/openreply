"use client";

/**
 * Envio ativo
 *
 * A tela existe para tornar uma regra da Meta visível em vez de escondê-la: no
 * Instagram só dá para enviar para quem te mandou mensagem nas últimas 24h.
 * Então ela não mostra "sua base"; mostra **quem está alcançável agora**, e
 * quantos saem da janela em seguida.
 *
 * É por isso que os três números aparecem juntos. Só o "alcançáveis" pareceria
 * um filtro quebrado; com "no filtro" e "fora da janela" do lado, o usuário
 * entende a regra em vez de brigar com ela.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";

interface AutomationOption {
  id: string;
  name: string;
}

interface PreviewSample {
  id: string;
  igsid: string;
  username: string | null;
  lastInboundAt: string | null;
  tags: string[];
}

interface Preview {
  reachable: number;
  expiringSoon: number;
  total: number;
  outOfWindow: number;
  expiringSoonHours: number;
  sample: PreviewSample[];
}

interface Broadcast {
  id: string;
  name: string;
  message: string;
  status: "DRAFT" | "SENDING" | "DONE" | "CANCELLED";
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  finishedAt: string | null;
  instagramAccount: { username: string };
  sourceAutomation: { id: string; name: string } | null;
}

const STATUS_LABEL: Record<Broadcast["status"], string> = {
  DRAFT: "Rascunho",
  SENDING: "Enviando",
  DONE: "Concluído",
  CANCELLED: "Cancelado",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3h 20min" a partir de quando a pessoa falou pela última vez. */
function timeLeft(lastInboundAt: string | null): string {
  if (!lastInboundAt) return "fechada";
  const closesAt = new Date(lastInboundAt).getTime() + 24 * 60 * 60 * 1000;
  const minutes = Math.round((closesAt - Date.now()) / 60000);
  if (minutes <= 0) return "fechada";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}min`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}min`;
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export default function BroadcastsPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [automations, setAutomations] = useState<AutomationOption[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [excludedInput, setExcludedInput] = useState("");
  const [sourceAutomationId, setSourceAutomationId] = useState("");

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  /**
   * Para qual audiência a confirmação foi dada.
   *
   * Guardar a assinatura dos filtros, e não um booleano, faz a confirmação
   * expirar sozinha quando qualquer coisa muda: confirmar para 40 pessoas e
   * disparar para outras 300 depois de mexer no filtro seria irreversível.
   */
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  /**
   * Chave de idempotência desta confirmação.
   *
   * Gerada uma vez ao entrar na etapa de confirmar e mandada junto no POST: um
   * duplo clique ou um retry de rede reaproveita a mesma chave, e o servidor
   * devolve o envio já criado em vez de disparar tudo de novo.
   */
  const [requestId, setRequestId] = useState<string | null>(null);

  const tags = useMemo(() => parseTags(tagsInput), [tagsInput]);
  const excludedTags = useMemo(() => parseTags(excludedInput), [excludedInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/dashboard/stats")
        .then((res) => res.json())
        .then((payload) => {
          if (!payload.success) return;
          const list: AccountOption[] = payload.data.instagramAccounts ?? [];
          setAccounts(list);
          setAccountId((current) => current || list[0]?.id || "");
        })
        .catch(console.error);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/automations")
        .then((res) => res.json())
        .then((payload) => {
          if (payload.success) setAutomations(payload.data ?? []);
        })
        .catch(console.error);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadBroadcasts = useCallback(() => {
    fetch("/api/broadcasts")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setBroadcasts(payload.data ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadBroadcasts, 0);
    return () => window.clearTimeout(timer);
  }, [loadBroadcasts]);

  // A prévia é refeita a cada mudança de filtro, com pausa: cada chamada são
  // três COUNT no banco, e esta VPS tem um core.
  useEffect(() => {
    if (!accountId) return;
    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch("/api/broadcasts/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instagramAccountId: accountId,
            tags,
            excludedTags,
            sourceAutomationId: sourceAutomationId || null,
          }),
        });
        const payload = await res.json();
        setPreview(payload.success ? payload.data : null);
      } catch (err) {
        console.error("Falha ao calcular a audiência:", err);
        setPreview(null);
      } finally {
        setPreviewing(false);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [accountId, tags, excludedTags, sourceAutomationId]);

  const signature = useMemo(
    () =>
      JSON.stringify([
        accountId,
        tags,
        excludedTags,
        sourceAutomationId,
        message.trim(),
      ]),
    [accountId, tags, excludedTags, sourceAutomationId, message]
  );
  const confirming = confirmedFor === signature;

  const canSend =
    Boolean(accountId) &&
    name.trim().length > 0 &&
    message.trim().length > 0 &&
    (preview?.reachable ?? 0) > 0 &&
    !sending;

  async function send() {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: accountId,
          name: name.trim(),
          message: message.trim(),
          tags,
          excludedTags,
          sourceAutomationId: sourceAutomationId || null,
          requestId,
        }),
      });
      const payload = await res.json();
      if (!payload.success) {
        setError(payload.error ?? "Não foi possível disparar o envio");
        return;
      }
      const { totalRecipients, estimatedMinutes, truncated, maxRecipients, alreadyQueued } =
        payload.data;

      if (alreadyQueued) {
        // Idempotência do servidor respondeu: este envio já tinha sido feito.
        setResult(
          `Este envio já estava na fila para ${totalRecipients} ${
            totalRecipients === 1 ? "pessoa" : "pessoas"
          }. Nada foi enviado duas vezes.`
        );
      } else {
        setResult(
          `Envio na fila para ${totalRecipients} ${
            totalRecipients === 1 ? "pessoa" : "pessoas"
          }. Leva cerca de ${estimatedMinutes} min para escoar.` +
            // Sem este aviso, um envio cortado no teto parecia ter alcançado
            // todo mundo — e as pessoas que ficaram de fora saem da janela de
            // 24h antes de uma segunda tentativa.
            (truncated
              ? ` Atenção: o envio foi limitado a ${maxRecipients} pessoas por vez, então parte da audiência ficou de fora. Dispare de novo para alcançar o restante enquanto a janela delas ainda estiver aberta.`
              : "")
        );
      }
      setName("");
      setMessage("");
      setConfirmedFor(null);
      setRequestId(null);
      loadBroadcasts();
    } catch (err) {
      console.error("Falha ao disparar:", err);
      setError("Não foi possível falar com o servidor");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Mensagem para quem já falou com você. O Instagram só permite enviar
        dentro de <strong className="text-foreground">24h</strong> da última
        mensagem da pessoa, então esta lista muda o tempo todo — e quem está
        fora da janela não aparece aqui.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Montagem do envio ─────────────────────────────────────────── */}
        <div className="panel space-y-5 rounded p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
              includeAll={false}
            />
            <label className="flex flex-1 flex-col gap-2 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Nome do envio
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: lote novo de setembro"
                maxLength={80}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 outline-none transition-colors focus:border-accent/40"
              />
            </label>
          </div>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Mensagem
            </span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={900}
              placeholder="Oi {username}, tudo bem? ..."
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 outline-none transition-colors focus:border-accent/40"
            />
            <span className="text-xs text-muted">
              <code className="text-foreground">{"{username}"}</code> vira o nome
              da pessoa. Quem não tem nome no perfil recebe a frase sem ele.
              {" "}
              {message.length}/900
            </span>
          </label>

          <div className="space-y-4 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Para quem
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-muted">Precisa ter estas tags</span>
                <input
                  value={tagsInput}
                  onChange={(event) => setTagsInput(event.target.value)}
                  placeholder="cliente, vip"
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 outline-none transition-colors focus:border-accent/40"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-muted">Não pode ter estas tags</span>
                <input
                  value={excludedInput}
                  onChange={(event) => setExcludedInput(event.target.value)}
                  placeholder="ja_comprou"
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 outline-none transition-colors focus:border-accent/40"
                />
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm">
              <span className="text-xs text-muted">
                Chegou por qual automação
              </span>
              <select
                value={sourceAutomationId}
                onChange={(event) => setSourceAutomationId(event.target.value)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
              >
                <option value="">Qualquer origem</option>
                {automations.map((automation) => (
                  <option key={automation.id} value={automation.id}>
                    {automation.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}
          {result && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
              {result}
            </p>
          )}

          {/* Duas etapas de propósito: não existe "des-enviar" um DM. */}
          {confirming ? (
            <div className="space-y-3 rounded-lg border border-accent/40 bg-accent/10 p-4">
              <p className="text-sm text-foreground">
                Enviar para{" "}
                <strong>{preview?.reachable ?? 0}</strong>{" "}
                {preview?.reachable === 1 ? "pessoa" : "pessoas"} agora? Não dá
                para cancelar uma mensagem já entregue.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={send}
                  disabled={sending}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {sending ? "Enviando…" : "Confirmar envio"}
                </button>
                <button
                  onClick={() => setConfirmedFor(null)}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
                >
                  Voltar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setConfirmedFor(signature);
                setRequestId(
                  typeof crypto !== "undefined" && crypto.randomUUID
                    ? crypto.randomUUID()
                    : `bc-${Date.now()}-${Math.random().toString(36).slice(2)}`
                );
              }}
              disabled={!canSend}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Revisar envio
            </button>
          )}
        </div>

        {/* ── Audiência ─────────────────────────────────────────────────── */}
        <div className="panel space-y-4 rounded p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Audiência {previewing && <span className="text-muted">calculando…</span>}
          </p>

          <div>
            <p className="text-3xl font-semibold text-foreground">
              {preview?.reachable ?? 0}
            </p>
            <p className="text-sm text-muted">alcançáveis agora</p>
          </div>

          {preview && preview.expiringSoon > 0 && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
              <strong>{preview.expiringSoon}</strong>{" "}
              {preview.expiringSoon === 1 ? "sai" : "saem"} da janela nas
              próximas {preview.expiringSoonHours}h.
            </p>
          )}

          {preview && (
            <dl className="space-y-1 border-t border-border pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">No filtro</dt>
                <dd className="text-foreground">{preview.total}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Fora da janela</dt>
                <dd className="text-foreground">{preview.outOfWindow}</dd>
              </div>
            </dl>
          )}

          {preview && preview.outOfWindow > 0 && (
            <p className="text-xs text-muted">
              As {preview.outOfWindow} pessoas fora da janela só voltam a ser
              alcançáveis se mandarem mensagem de novo — responder um story
              também conta.
            </p>
          )}

          {preview && preview.sample.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted">Saindo primeiro</p>
              <ul className="space-y-1.5">
                {preview.sample.map((contact) => (
                  <li
                    key={contact.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="truncate text-foreground">
                      @{contact.username ?? contact.igsid}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {timeLeft(contact.lastInboundAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── Histórico ───────────────────────────────────────────────────── */}
      <div className="panel rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["Envio", "Conta", "Situação", "Enviados", "Pulados", "Falhas", "Quando"].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted sm:px-6"
                    >
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {broadcasts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted sm:px-6">
                    Nenhum envio ainda.
                  </td>
                </tr>
              ) : (
                broadcasts.map((broadcast) => (
                  <tr key={broadcast.id} className="transition-colors hover:bg-surface-hover/50">
                    <td className="px-4 py-4 sm:px-6">
                      <span className="font-medium text-foreground">{broadcast.name}</span>
                      {broadcast.sourceAutomation && (
                        <span className="block text-xs text-muted">
                          origem: {broadcast.sourceAutomation.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-muted sm:px-6">
                      @{broadcast.instagramAccount.username}
                    </td>
                    <td className="px-4 py-4 sm:px-6">{STATUS_LABEL[broadcast.status]}</td>
                    <td className="px-4 py-4 text-foreground sm:px-6">
                      {broadcast.sentCount}/{broadcast.totalRecipients}
                    </td>
                    <td className="px-4 py-4 text-muted sm:px-6">{broadcast.skippedCount}</td>
                    <td className="px-4 py-4 text-muted sm:px-6">{broadcast.failedCount}</td>
                    <td className="px-4 py-4 text-muted sm:px-6">
                      {formatDate(broadcast.finishedAt ?? broadcast.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
