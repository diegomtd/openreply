"use client";

/**
 * Campaign Builder
 *
 * Two-pane campaign editor: a control panel on the left and a live phone
 * preview on the right. Used for both creating and editing a campaign.
 *
 * Turn 1 wires the fully-functional pieces: trigger scope (specific / any /
 * next post), match mode (specific words / any word), the opening + reveal DM
 * text, public reply, and the tracked link. Button-driven delivery and the
 * follow / email / follow-up steps arrive in later turns.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import PostPicker from "@/components/post-picker";
import CampaignPreview, { type PreviewTab } from "@/components/campaign-preview";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  IMPORT_QUEUE_KEY,
  IMPORT_ACCOUNT_KEY,
  type ImportRow,
} from "@/lib/import-queue";

type TriggerScope = "specific" | "any" | "next";
type MatchMode = "specific" | "any";
type SendFrequency = "ONCE_PER_CONTACT" | "ONCE_PER_POST" | "COOLDOWN" | "ALWAYS";

interface LoadedCampaign {
  id: string;
  name: string;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  dmTriggerEnabled: boolean;
  storyReplyTriggerEnabled: boolean;
  storyMentionTriggerEnabled: boolean;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  sendFrequency: SendFrequency | null;
  resendCooldownHours: number | null;
  isActive: boolean;
  instagramAccountId: string;
  trackedLinks?: { destinationUrl: string; label?: string | null }[];
}

interface CampaignBuilderProps {
  mode: "new" | "edit";
  campaignId?: string;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Radio({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-border-hover"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          checked ? "border-accent" : "border-zinc-500"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex-1 text-foreground">{children}</span>
    </button>
  );
}

function Toggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-zinc-300"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

export default function CampaignBuilder({ mode, campaignId }: CampaignBuilderProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const [triggerScope, setTriggerScope] = useState<TriggerScope>("specific");
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState("");

  // Post IDs already tied to another automation on this account, so the picker
  // can flag them and the user knows not to double-assign. Maps postId ->
  // the campaign name using it (for the tooltip).
  const [usedPosts, setUsedPosts] = useState<Record<string, string>>({});

  const [matchMode, setMatchMode] = useState<MatchMode>("specific");
  const [keywordText, setKeywordText] = useState("");
  const [dmTriggerEnabled, setDmTriggerEnabled] = useState(false);
  const [storyReplyTriggerEnabled, setStoryReplyTriggerEnabled] =
    useState(false);
  const [storyMentionTriggerEnabled, setStoryMentionTriggerEnabled] =
    useState(false);

  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");

  const [dmMessage, setDmMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");
  const [linkButtonLabel, setLinkButtonLabel] = useState("Abrir link");
  const [secondLinkOpen, setSecondLinkOpen] = useState(false);
  const [secondaryDestinationUrl, setSecondaryDestinationUrl] = useState("");
  const [secondaryButtonLabel, setSecondaryButtonLabel] = useState("Abrir link");
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] =
    useState("estou te seguindo");
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState(0);
  // Once per person is the default on purpose: the alternative is re-sending the
  // same automated message to someone who already has it.
  const [sendFrequency, setSendFrequency] =
    useState<SendFrequency>("ONCE_PER_CONTACT");
  const [resendCooldownHours, setResendCooldownHours] = useState(24);

  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");

  // CSV import queue. When present, each save advances to the next row instead
  // of returning to the campaigns list.
  const [importQueue, setImportQueue] = useState<ImportRow[] | null>(null);
  const [importTotal, setImportTotal] = useState(0);

  const keywords = useMemo(
    () =>
      keywordText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    [keywordText]
  );

  // Fetch the connected account's real avatar for the preview (cache-first so
  // it shows instantly on a return visit instead of a blank circle).
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    const cacheKey = `ig-avatar:${selectedAccountId}`;
    const cached = readCache<string | null>(cacheKey, 30 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.data !== null) setAvatarUrl(cached.data);

    const params = new URLSearchParams({ instagramAccountId: selectedAccountId });
    fetch(`/api/instagram/profile?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const url = d.success ? d.data.profilePictureUrl ?? null : null;
        setAvatarUrl(url);
        writeCache(cacheKey, url);
      })
      .catch(() => {
        if (!cancelled && cached.data === null) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  // Load accounts (both modes need them for the preview username + selector).
  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId(
          (prev) => prev || payload.data.selectedInstagramAccountId || next[0]?.id || ""
        );
      })
      .catch(() => setAccounts([]));
  }, []);

  // Prefill when editing.
  useEffect(() => {
    if (mode !== "edit" || !campaignId) return;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return setNotFound(true);
        const c = (payload.data as LoadedCampaign[]).find((x) => x.id === campaignId);
        if (!c) return setNotFound(true);
        setName(c.name);
        setSelectedAccountId(c.instagramAccountId);
        setTriggerScope(
          c.matchAnyPost ? "any" : c.pendingNextReel ? "next" : "specific"
        );
        setPostId(c.postId);
        setPostUrl(c.postUrl);
        setMatchMode(c.matchAnyWord ? "any" : "specific");
        setKeywordText(c.keywords.join(", "));
        setDmTriggerEnabled(c.dmTriggerEnabled ?? false);
        setStoryReplyTriggerEnabled(c.storyReplyTriggerEnabled ?? false);
        setStoryMentionTriggerEnabled(c.storyMentionTriggerEnabled ?? false);
        setPublicReplyEnabled(c.publicReplyEnabled);
        setPublicReplyMessages(
          c.publicReplyMessages?.length
            ? c.publicReplyMessages
            : c.publicReplyMessage
              ? [c.publicReplyMessage]
              : [""]
        );
        setOpeningDmEnabled(c.openingDmEnabled);
        setOpeningDmMessage(c.openingDmMessage ?? "");
        setOpeningDmButtonLabel(c.openingDmButtonLabel ?? "");
        setDmMessage(c.dmMessage);
        setLinkButtonLabel(c.linkButtonLabel ?? "Abrir link");
        setIsActive(c.isActive);
        const link = c.trackedLinks?.[0]?.destinationUrl ?? "";
        setTrackedDestinationUrl(link);
        setLinkOpen(Boolean(link));
        const secondLink = c.trackedLinks?.[1];
        setSecondaryDestinationUrl(secondLink?.destinationUrl ?? "");
        setSecondaryButtonLabel(secondLink?.label ?? "Abrir link");
        setSecondLinkOpen(Boolean(secondLink?.destinationUrl));
        setRequireFollow(c.requireFollow ?? false);
        setFollowPromptMessage(c.followPromptMessage ?? "");
        setFollowPromptButtonLabel(
          c.followPromptButtonLabel ?? "estou te seguindo"
        );
        setFollowUpEnabled(c.followUpEnabled ?? false);
        setFollowUpMessage(c.followUpMessage ?? "");
        setFollowUpDelayMinutes(c.followUpDelayMinutes ?? 0);
        setSendFrequency(c.sendFrequency ?? "ONCE_PER_CONTACT");
        setResendCooldownHours(c.resendCooldownHours ?? 24);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [mode, campaignId]);

  // Track which posts on the selected account are already assigned to an
  // automation, so the picker can highlight them. The campaign being edited is
  // excluded — its own post should read as selected, not "taken".
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        const map: Record<string, string> = {};
        for (const a of payload.data as LoadedCampaign[]) {
          if (!a.postId) continue;
          if (a.instagramAccountId !== selectedAccountId) continue;
          if (mode === "edit" && a.id === campaignId) continue;
          map[a.postId] = a.name;
        }
        setUsedPosts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, mode, campaignId]);

  // Prefill the editable fields from one queued import row. The reel is left
  // unset so the user picks it per row.
  function prefillFromRow(row: ImportRow) {
    setName(row.name ?? "");
    setTriggerScope("specific");
    setPostId(null);
    setPostUrl(null);
    setPostThumb(null);
    setPostCaption("");
    setMatchMode("specific");
    setKeywordText((row.keywords ?? []).join(", "));
    setDmMessage(row.dmMessage ?? "");
    setPublicReplyEnabled(Boolean(row.publicReply));
    setPublicReplyMessages(row.publicReply ? [row.publicReply] : [""]);
    const hasOpening = Boolean(row.openingDmMessage);
    setOpeningDmEnabled(hasOpening);
    setOpeningDmMessage(row.openingDmMessage ?? "");
    setOpeningDmButtonLabel(
      row.openingDmButtonLabel || (hasOpening ? "Me manda o link" : "")
    );
    const link = row.trackedUrl ?? "";
    setTrackedDestinationUrl(link);
    setLinkOpen(Boolean(link));
    setError(null);
  }

  // Pick up a staged CSV import (new mode only) and prefill the first row.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "new") return;
    try {
      const raw = window.localStorage.getItem(IMPORT_QUEUE_KEY);
      const acct = window.localStorage.getItem(IMPORT_ACCOUNT_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as ImportRow[];
      if (!Array.isArray(queue) || queue.length === 0) return;
      setImportQueue(queue);
      setImportTotal(queue.length);
      if (acct) setSelectedAccountId(acct);
      prefillFromRow(queue[0]);
    } catch {
      // ignore a malformed queue
    }
  }, [mode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const username =
    accounts.find((a) => a.id === selectedAccountId)?.username ?? "yourbrand";

  function handlePostSelect(
    id: string,
    url?: string,
    thumb?: string,
    caption?: string
  ) {
    setPostId(id);
    setPostUrl(url ?? null);
    setPostThumb(thumb ?? null);
    setPostCaption(caption ?? "");
  }

  function ensureLinkToken() {
    setDmMessage((cur) => (cur.includes("{link}") ? cur : `${cur.trim()} {link}`.trim()));
  }

  async function handleSubmit(activeValue: boolean) {
    setError(null);

    if (!selectedAccountId) return setError("Conecte uma conta do Instagram primeiro.");
    // Um gatilho de mensagem (DM, resposta ou menção de story) já basta: nesse
    // caso não existe post para escolher.
    const hasMessageTrigger =
      dmTriggerEnabled || storyReplyTriggerEnabled || storyMentionTriggerEnabled;
    if (triggerScope === "specific" && !postId && !hasMessageTrigger)
      return setError(
        "Escolha o post ou reel que dispara a automação, ou ligue um gatilho de DM ou story."
      );
    if (matchMode === "specific" && keywords.length === 0)
      return setError("Adicione pelo menos uma palavra-chave, ou mude para qualquer palavra.");
    if (!dmMessage.trim()) return setError("Escreva o DM com o link.");
    if (openingDmEnabled && (!openingDmMessage.trim() || !openingDmButtonLabel.trim()))
      return setError("O DM de abertura precisa de mensagem e de texto no botão.");

    setSaving(true);

    const payload = {
      name: name.trim() || `Automação de @${username}`,
      instagramAccountId: selectedAccountId,
      postId: triggerScope === "specific" ? postId : null,
      postUrl: triggerScope === "specific" ? postUrl : null,
      matchAnyPost: triggerScope === "any",
      pendingNextReel: triggerScope === "next",
      matchAnyWord: matchMode === "any",
      keywords: matchMode === "any" ? [] : keywords,
      dmTriggerEnabled,
      storyReplyTriggerEnabled,
      storyMentionTriggerEnabled,
      dmMessage,
      openingDmEnabled,
      openingDmMessage: openingDmEnabled ? openingDmMessage : null,
      openingDmButtonLabel: openingDmEnabled ? openingDmButtonLabel : null,
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled
        ? publicReplyMessages.map((m) => m.trim()).filter(Boolean)
        : [],
      trackedDestinationUrl: trackedDestinationUrl.trim() || "",
      linkButtonLabel: linkButtonLabel.trim() || "Abrir link",
      secondaryDestinationUrl: secondaryDestinationUrl.trim() || "",
      secondaryButtonLabel: secondaryButtonLabel.trim() || "Abrir link",
      requireFollow,
      followPromptMessage: requireFollow ? followPromptMessage.trim() : "",
      followPromptButtonLabel: requireFollow
        ? followPromptButtonLabel.trim() || "estou te seguindo"
        : "",
      followUpEnabled,
      followUpMessage: followUpEnabled ? followUpMessage.trim() : "",
      followUpDelayMinutes: followUpEnabled ? followUpDelayMinutes : 0,
      sendFrequency,
      resendCooldownHours,
      isActive: activeValue,
    };

    try {
      const res =
        mode === "new"
          ? await fetch("/api/automations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/automations?id=${campaignId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (data.success) {
        // The post we just assigned is now in use. Reflect it immediately so
        // the picker flags it on the next imported row — the fetch that builds
        // this map doesn't re-run while the builder stays mounted through the
        // import queue.
        if (triggerScope === "specific" && postId) {
          const assignedPostId = postId;
          setUsedPosts((prev) => ({ ...prev, [assignedPostId]: payload.name }));
        }
        // Importing: advance to the next queued row instead of leaving.
        if (importQueue && importQueue.length > 1) {
          const remaining = importQueue.slice(1);
          try {
            window.localStorage.setItem(
              IMPORT_QUEUE_KEY,
              JSON.stringify(remaining)
            );
          } catch {
            // ignore
          }
          setImportQueue(remaining);
          prefillFromRow(remaining[0]);
          setSaving(false);
          if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          return;
        }
        if (importQueue) {
          try {
            window.localStorage.removeItem(IMPORT_QUEUE_KEY);
            window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
          } catch {
            // ignore
          }
        }
        // refresh() busts the router cache so the list reflects the save
        // instead of landing on a stale (empty) campaigns page.
        router.push("/campaigns");
        router.refresh();
      } else {
        // Surface the specific field that failed validation instead of a
        // generic "Invalid input".
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? `${firstField}: ${fieldErrors[firstField][0]}`
            : data.error ?? "Não foi possível salvar a automação"
        );
        if (typeof window !== "undefined")
          window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Não foi possível salvar a automação");
    } finally {
      setSaving(false);
    }
  }

  // Skip the current imported row without saving a campaign for it, advancing
  // to the next one (or finishing the import if it was the last).
  function skipRow() {
    if (!importQueue) return;
    setError(null);
    if (importQueue.length > 1) {
      const remaining = importQueue.slice(1);
      try {
        window.localStorage.setItem(IMPORT_QUEUE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
      setImportQueue(remaining);
      prefillFromRow(remaining[0]);
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
      return;
    }
    // Last row skipped — finish the import.
    try {
      window.localStorage.removeItem(IMPORT_QUEUE_KEY);
      window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
    } catch {
      // ignore
    }
    router.push("/campaigns");
    router.refresh();
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (notFound) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-muted">Automação não encontrada.</p>
        <button
          onClick={() => router.push("/campaigns")}
          className="mt-4 rounded border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          Voltar para automações
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {importQueue && (
        <div className="rounded border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">
            Importando {importTotal - importQueue.length + 1} de {importTotal}.
          </span>{" "}
          <span className="text-muted">
            Os campos vieram do seu CSV. Escolha o reel, ajuste o que quiser e
            salve para carregar o próximo — ou pule se não quiser este.
          </span>
        </div>
      )}

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {mode === "edit" ? (
            <>
              <span className="truncate text-sm font-semibold text-foreground">
                {name || "Automação sem nome"}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  isActive ? "bg-success/15 text-success" : "bg-zinc-500/15 text-muted"
                }`}
              >
                {isActive ? "ATIVA" : "PAUSADA"}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">Nova automação</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {importQueue && (
            <button
              type="button"
              onClick={skipRow}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
            >
              {importQueue.length > 1 ? "Pular" : "Pular e encerrar"}
            </button>
          )}
          {mode === "edit" &&
            (isActive ? (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                Pausar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                Ativar
              </button>
            ))}
          <button
            type="button"
            onClick={() => handleSubmit(mode === "new" ? true : isActive)}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Salvando…" : mode === "new" ? "Publicar" : "Salvar alterações"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:gap-8">
      {/* Left: controls */}
      <div className="space-y-8">
        {error && (
          <div className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground">
            Nome da automação{" "}
            <span className="font-normal text-muted">(opcional)</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex.: link da bio do reel de terça"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
            maxLength={100}
          />
          {accounts.length > 1 && (
            <div className="pt-2">
              <AccountSelect
                accounts={accounts}
                value={selectedAccountId}
                onChange={(id) => {
                  setSelectedAccountId(id);
                  setPostId(null);
                  setPostUrl(null);
                  setPostThumb(null);
                }}
                includeAll={false}
                label="Conta do Instagram"
              />
            </div>
          )}
        </div>

        <Section title="Quando alguém comentar em">
          <Radio
            checked={triggerScope === "specific"}
            onSelect={() => setTriggerScope("specific")}
          >
            um post ou reel específico
          </Radio>
          {triggerScope === "specific" && (
            <div className="rounded-lg border border-border p-2">
              <PostPicker
                selectedPostId={postId}
                instagramAccountId={selectedAccountId}
                usedPostIds={usedPosts}
                onSelect={handlePostSelect}
              />
            </div>
          )}
          <Radio
            checked={triggerScope === "any"}
            onSelect={() => setTriggerScope("any")}
          >
            qualquer post ou reel
          </Radio>
          <Radio
            checked={triggerScope === "next"}
            onSelect={() => setTriggerScope("next")}
          >
            o próximo post ou reel
          </Radio>
        </Section>

        <Section title="E o comentário tiver">
          <Radio
            checked={matchMode === "specific"}
            onSelect={() => setMatchMode("specific")}
          >
            uma palavra específica (ou várias)
          </Radio>
          {matchMode === "specific" && (
            <div className="space-y-1">
              <input
                value={keywordText}
                onChange={(e) => setKeywordText(e.target.value)}
                placeholder="Digite uma palavra ou várias"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
              />
              <p className="text-xs text-muted">Separe as palavras por vírgula</p>
            </div>
          )}
          <Radio
            checked={matchMode === "any"}
            onSelect={() => setMatchMode("any")}
          >
            qualquer palavra
          </Radio>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              responder também quando mandarem{" "}
              {matchMode === "any" ? "qualquer DM" : "essas palavras no DM"}
            </span>
            <Toggle
              on={dmTriggerEnabled}
              onToggle={() => setDmTriggerEnabled(!dmTriggerEnabled)}
            />
          </div>
          {dmTriggerEnabled && (
            <p className="text-xs text-muted">
              {matchMode === "any"
                ? "Todo DM que chegar nesta conta recebe a resposta abaixo — use com cuidado."
                : "Um DM com qualquer uma dessas palavras recebe a mesma resposta, sem precisar de comentário."}
            </p>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              responder também quem responder meu story
            </span>
            <Toggle
              on={storyReplyTriggerEnabled}
              onToggle={() =>
                setStoryReplyTriggerEnabled(!storyReplyTriggerEnabled)
              }
            />
          </div>
          {storyReplyTriggerEnabled && (
            <p className="text-xs text-muted">
              {matchMode === "any"
                ? "Qualquer resposta aos seus stories recebe a mensagem abaixo."
                : "Uma resposta ao story com qualquer uma dessas palavras recebe a mesma mensagem."}{" "}
              Conta separado por story: em &ldquo;uma vez por pessoa, por
              post&rdquo;, cada story é um post.
            </p>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              responder quem me mencionar no story
            </span>
            <Toggle
              on={storyMentionTriggerEnabled}
              onToggle={() =>
                setStoryMentionTriggerEnabled(!storyMentionTriggerEnabled)
              }
            />
          </div>
          {storyMentionTriggerEnabled && (
            <p className="text-xs text-muted">
              Uma menção não tem texto, então palavra-chave não se aplica: toda
              menção recebe a mensagem. Bom para agradecer quem te marca.
            </p>
          )}
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              responder o comentário publicamente no post
            </span>
            <Toggle
              on={publicReplyEnabled}
              onToggle={() => setPublicReplyEnabled(!publicReplyEnabled)}
            />
          </div>
          {publicReplyEnabled && (
            <div className="space-y-2">
              {publicReplyMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={msg}
                    onChange={(e) =>
                      setPublicReplyMessages((prev) =>
                        prev.map((m, idx) => (idx === i ? e.target.value : m))
                      )
                    }
                    placeholder="Te mandei no direct! 📩"
                    maxLength={1000}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  />
                  {publicReplyMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPublicReplyMessages((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      className="shrink-0 px-2 text-muted hover:text-error"
                      aria-label="Remover resposta"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {publicReplyMessages.length < 10 && (
                <button
                  type="button"
                  onClick={() =>
                    setPublicReplyMessages((prev) => [...prev, ""])
                  }
                  className="text-xs font-medium text-accent hover:underline"
                >
                  + Adicionar outra variação
                </button>
              )}
              <p className="text-xs text-muted">
                Uma é sorteada a cada vez, para as respostas não ficarem todas
                iguais.
              </p>
            </div>
          )}
        </Section>

        <Section title="A pessoa recebe">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">um DM de abertura</span>
              <Toggle
                on={openingDmEnabled}
                onToggle={() => setOpeningDmEnabled(!openingDmEnabled)}
              />
            </div>
            {openingDmEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={openingDmMessage}
                  onChange={(e) => setOpeningDmMessage(e.target.value)}
                  placeholder="Oi! Que bom que você veio 😊"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={openingDmButtonLabel}
                  onChange={(e) => setOpeningDmButtonLabel(e.target.value)}
                  placeholder="Me manda o link"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={64}
                />
              </div>
            )}
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                exigir que me siga antes
              </span>
              <Toggle
                on={requireFollow}
                onToggle={() => setRequireFollow(!requireFollow)}
              />
            </div>
            {requireFollow && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followPromptMessage}
                  onChange={(e) => setFollowPromptMessage(e.target.value)}
                  placeholder="antes de eu te mandar o link, um favor: me segue aqui. é de graça, não ganho nada com isso. toca no botão quando estiver me seguindo e eu te envio na hora"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={followPromptButtonLabel}
                  onChange={(e) => setFollowPromptButtonLabel(e.target.value)}
                  placeholder="estou te seguindo"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={20}
                />
                <p className="text-xs text-muted">
                  O link só sai depois que a pessoa toca no botão e o Instagram
                  confirma que ela te segue. Se o Instagram não conseguir
                  confirmar, mandamos mesmo assim.
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section title="Depois disso, ela recebe">
          <div className="rounded-lg border border-border p-3 space-y-2">
            <span className="text-sm text-foreground">um DM com o link</span>
            <textarea
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              placeholder="Escreva a mensagem"
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
              maxLength={1000}
            />
            {linkOpen ? (
              <div className="space-y-2">
                <input
                  value={trackedDestinationUrl}
                  onChange={(e) => setTrackedDestinationUrl(e.target.value)}
                  onBlur={ensureLinkToken}
                  placeholder="https://seusite.com/oferta"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                <input
                  value={linkButtonLabel}
                  onChange={(e) => setLinkButtonLabel(e.target.value)}
                  placeholder="Texto do botão (ex.: Abrir link)"
                  maxLength={20}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                {secondLinkOpen ? (
                  <div className="space-y-2 border-t border-border pt-2">
                    <input
                      value={secondaryDestinationUrl}
                      onChange={(e) => setSecondaryDestinationUrl(e.target.value)}
                      placeholder="https://seusite.com/segundo"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                    <input
                      value={secondaryButtonLabel}
                      onChange={(e) => setSecondaryButtonLabel(e.target.value)}
                      placeholder="Texto do segundo botão"
                      maxLength={20}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSecondLinkOpen(true)}
                    className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
                  >
                    + Adicionar um segundo link
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
              >
                + Adicionar um link
              </button>
            )}
            <p className="text-xs text-muted">
              {"{link}"} insere o link rastreado; {"{username}"} coloca o @ da
              pessoa.
            </p>
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                uma mensagem de agradecimento depois
              </span>
              <Toggle
                on={followUpEnabled}
                onToggle={() => setFollowUpEnabled(!followUpEnabled)}
              />
            </div>
            {followUpEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder="Ah, e obrigado por me seguir de verdade. Faz diferença 🙌"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="text-xs text-muted">Enviar</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={followUpDelayMinutes}
                    onChange={(e) =>
                      setFollowUpDelayMinutes(
                        Math.max(0, Math.min(1440, Math.floor(Number(e.target.value) || 0)))
                      )
                    }
                    className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-muted">
                    minutos depois do link
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {followUpDelayMinutes > 0
                    ? `Enviada ${followUpDelayMinutes} min depois que a pessoa recebe o link.`
                    : "Enviada logo depois que a pessoa recebe o link."}
                  {" {username}"} coloca o @ dela. Máximo de 24 horas, para ficar
                  dentro da janela de mensagens do Instagram.
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section title="Mas só enviar">
          <div className="rounded-lg border border-border p-3 space-y-2">
            <Radio
              checked={sendFrequency === "ONCE_PER_CONTACT"}
              onSelect={() => setSendFrequency("ONCE_PER_CONTACT")}
            >
              <span>
                uma vez por pessoa
                <span className="ml-1 text-xs text-muted">recomendado</span>
              </span>
            </Radio>
            <Radio
              checked={sendFrequency === "ONCE_PER_POST"}
              onSelect={() => setSendFrequency("ONCE_PER_POST")}
            >
              uma vez por pessoa, por post
            </Radio>
            <Radio
              checked={sendFrequency === "COOLDOWN"}
              onSelect={() => setSendFrequency("COOLDOWN")}
            >
              de novo, mas não tão cedo
            </Radio>
            <Radio
              checked={sendFrequency === "ALWAYS"}
              onSelect={() => setSendFrequency("ALWAYS")}
            >
              toda vez que der match
            </Radio>

            {sendFrequency === "COOLDOWN" && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm text-foreground">
                <span className="text-xs text-muted">Esperar pelo menos</span>
                <input
                  type="number"
                  min={1}
                  max={8760}
                  value={resendCooldownHours}
                  onChange={(e) =>
                    setResendCooldownHours(
                      Math.max(
                        1,
                        Math.min(8760, Math.floor(Number(e.target.value) || 1))
                      )
                    )
                  }
                  className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                />
                <span className="text-xs text-muted">
                  horas antes de enviar de novo para a mesma pessoa
                </span>
              </div>
            )}

            <p className="border-t border-border pt-2 text-xs text-muted">
              {sendFrequency === "ONCE_PER_CONTACT" &&
                "Quem já recebeu não recebe de novo — nem comentando outra vez, nem mandando DM."}
              {sendFrequency === "ONCE_PER_POST" &&
                "Um envio por pessoa em cada post. Se ela comentar em outro post, recebe de novo."}
              {sendFrequency === "COOLDOWN" &&
                `Disparos repetidos dentro de ${resendCooldownHours}h ficam registrados e não são enviados.`}
              {sendFrequency === "ALWAYS" &&
                "Dispara em todo match. Use só para algo que as pessoas pedem de novo de propósito — senão a mesma pessoa recebe a mesma mensagem sem parar."}
            </p>
            <p className="text-xs text-muted">
              Quem responder &ldquo;parar&rdquo; ou &ldquo;sair&rdquo; é
              silenciado em todas as automações. Dá para silenciar à mão em
              Contatos.
            </p>
          </div>
        </Section>
      </div>

      {/* Right: preview */}
      <div>
        <p className="mb-4 text-sm text-muted">Prévia</p>
        <div className="flex justify-center lg:sticky lg:top-6 lg:block">
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            username={username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption={postCaption}
            sampleComment={keywords[0] ?? ""}
            dmTriggerEnabled={dmTriggerEnabled}
            publicReplyEnabled={publicReplyEnabled}
            publicReplyMessage={publicReplyMessages.find((m) => m.trim()) ?? ""}
            openingDmEnabled={openingDmEnabled}
            openingDmMessage={openingDmMessage}
            openingDmButtonLabel={openingDmButtonLabel}
            revealMessage={dmMessage}
            hasLink={Boolean(trackedDestinationUrl.trim())}
            linkButtonLabel={linkButtonLabel || "Abrir link"}
            linkUrl={trackedDestinationUrl.trim() || undefined}
            hasSecondLink={
              secondLinkOpen && Boolean(secondaryDestinationUrl.trim())
            }
            secondLinkButtonLabel={secondaryButtonLabel || "Abrir link"}
            requireFollow={requireFollow}
            followPromptMessage={followPromptMessage}
            followPromptButtonLabel={followPromptButtonLabel || "estou te seguindo"}
            followUpEnabled={followUpEnabled}
            followUpMessage={followUpMessage}
            followUpDelayMinutes={followUpDelayMinutes}
          />
        </div>
      </div>
      </div>
    </div>
  );
}
