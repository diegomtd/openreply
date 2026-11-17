import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";

function instagramGraphBase() {
  return `https://graph.instagram.com/${getMetaGraphApiVersion()}`;
}

/**
 * A pessoa não conseguia conectar conta nenhuma, nem reconectar uma que já
 * tinha funcionado antes: `getLongLivedToken` e `refreshLongLivedToken`
 * voltavam "Unsupported request - method type: get". Não é permissão nem
 * limite de conta — é a URL errada. A troca por token de longa duração e a
 * renovação vivem na **raiz** de `graph.instagram.com`, sem a versão da API
 * no caminho — diferente de todo outro endpoint deste arquivo, que é sob
 * `/{versão}/…`. `instagramGraphBase()` prefixava os dois com a versão, e a
 * Meta não reconhece `/v25.0/access_token` como nada — daí a mensagem
 * genérica em vez de um erro de permissão de verdade.
 */
function instagramGraphRoot() {
  return "https://graph.instagram.com";
}

function facebookGraphBase() {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

export class MetaApiError extends Error {
  constructor(
    public code: number,
    public subcode: number | undefined,
    public fbTraceId: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class TokenExpiredError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(190, undefined, fbTraceId, message);
    this.name = "TokenExpiredError";
  }
}

export class RateLimitError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(368, undefined, fbTraceId, message);
    this.name = "RateLimitError";
  }
}

export class PermissionError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(100, undefined, fbTraceId, message);
    this.name = "PermissionError";
  }
}

interface GraphApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface InstagramUser {
  id: string;
  // Instagram professional account ID. This — not `id` (the app-scoped ID) —
  // is what appears as entry.id in webhooks and is used by the messaging API.
  user_id?: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  // Current follower total. Point-in-time only — Instagram exposes no history
  // for this field, so long-run trends come from FollowerSnapshot instead.
  followers_count?: number;
}

export interface InstagramComment {
  id: string;
  text: string;
  from?: {
    id: string;
    username?: string;
  };
  timestamp: string;
  // Present when the comments query asks for replies{from}. Used to tell whether
  // the account owner has already replied to this comment.
  replies?: {
    data?: { id: string; from?: { id: string; username?: string } }[];
  };
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
}

export interface InstagramMediaInsights {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  saved?: number;
  shares?: number;
  total_interactions?: number;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || (data as GraphApiError).error) {
    const err = (data as GraphApiError).error;
    const code = err?.code ?? response.status;
    const subcode = err?.error_subcode;
    const traceId = err?.fbtrace_id;
    const message = err?.message ?? "Unknown Meta API error";

    switch (code) {
      case 190:
        throw new TokenExpiredError(message, traceId);
      case 368:
      case 4:
      case 17:
        throw new RateLimitError(message, traceId);
      case 10:
      case 100:
      case 200:
        throw new PermissionError(message, traceId);
      default:
        throw new MetaApiError(code, subcode, traceId, message);
    }
  }

  return data as T;
}

export async function sendPrivateReply(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  message: string
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Send a private reply to a comment as a button template — an opening message
 * plus a postback button. Tapping the button opens the conversation and fires
 * a `messaging_postbacks` webhook carrying `payload`, which we use to deliver
 * the follow-up ("reveal") message.
 */
export async function sendPrivateReplyWithButton(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              // Button template text is capped at 640 chars by Meta.
              text: text.slice(0, 640),
              buttons: [
                { type: "postback", title: buttonTitle.slice(0, 20), payload },
              ],
            },
          },
        },
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Send a direct message (to a user's IGSID) as a button template with a single
 * postback button. Used to re-prompt a user during follow-gating, so tapping
 * the button fires another `messaging_postbacks` webhook carrying `payload`.
 */
export async function sendDirectMessageWithButton(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: userId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: text.slice(0, 640),
              buttons: [
                { type: "postback", title: buttonTitle.slice(0, 20), payload },
              ],
            },
          },
        },
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Check whether a user (by their IGSID) follows the business account, via the
 * Instagram Messaging profile API. Available for users in an active
 * conversation (e.g. after a private reply or a button tap). Returns true or
 * false, or `null` when Meta does not return the field — so callers can decide
 * how to treat the unverifiable case.
 */
export async function getUserFollowStatus(
  accessToken: string,
  recipientId: string
): Promise<boolean | null> {
  const url = new URL(`${instagramGraphBase()}/${recipientId}`);
  url.searchParams.set("fields", "is_user_follow_business");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.is_user_follow_business === "boolean"
      ? data.is_user_follow_business
      : null;
  } catch {
    return null;
  }
}

/**
 * A tappable web_url button in a DM button template. Instagram's button
 * template supports up to 3 buttons; titles are capped at 20 chars by Meta.
 */
export interface LinkButton {
  title: string;
  url: string;
}

function toWebUrlButtons(buttons: LinkButton[]) {
  return buttons
    .slice(0, 3)
    .map((b) => ({ type: "web_url", url: b.url, title: b.title.slice(0, 20) }));
}

/**
 * Send a private reply to a comment as a button template with up to 3 web_url
 * buttons — the reveal message plus tappable link buttons (for campaigns with
 * no opening DM, where the reveal is delivered straight to the comment).
 */
export async function sendPrivateReplyWithLinkButton(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  text: string,
  buttons: LinkButton[]
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: text.slice(0, 640),
              buttons: toWebUrlButtons(buttons),
            },
          },
        },
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Send a plain-text direct message to a user by their Instagram-scoped ID.
 * Used to deliver the reveal message after a button postback.
 */
export async function sendDirectMessage(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  message: string
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: userId },
        message: { text: message },
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Send a direct message as a button template with up to 3 web_url buttons —
 * the reveal message plus tappable link buttons (cleaner than inline URLs).
 */
export async function sendDirectMessageWithLinkButton(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  text: string,
  buttons: LinkButton[]
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: userId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: text.slice(0, 640),
              buttons: toWebUrlButtons(buttons),
            },
          },
        },
      }),
    }
  );

  return handleResponse(response);
}

export async function sendCommentReply(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${commentId}/replies`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    }
  );

  return handleResponse(response);
}

/**
 * Hide or unhide a comment on the account's own media. Hidden comments stay
 * visible to their author only — the reversible way to clean up spam.
 */
export async function setCommentHidden(
  accessToken: string,
  commentId: string,
  hidden: boolean
): Promise<{ success: boolean }> {
  const response = await fetch(`${instagramGraphBase()}/${commentId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ hide: hidden }),
  });

  return handleResponse(response);
}

export async function getMediaComments(
  accessToken: string,
  mediaId: string
): Promise<InstagramComment[]> {
  const url = new URL(`${instagramGraphBase()}/${mediaId}/comments`);
  url.searchParams.set("fields", "id,text,from,timestamp");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramComment[] }>(response);
  return data.data;
}

/**
 * Recent comments on a media, newest first, each with its replies so the caller
 * can tell whether the account owner has already responded. Pagination stops as
 * soon as it reaches comments older than `sinceMs` (or the `max` ceiling), so a
 * viral post's entire back-catalogue is never pulled — only what is recent
 * enough to still act on. This is what the polling reconciler reads.
 *
 * Note: comments hidden by Instagram's Hidden Words / spam filter may not be
 * returned by the Graph API at all. Disable that filter on the account to widen
 * results.
 */
export async function getRecentMediaComments(
  accessToken: string,
  mediaId: string,
  sinceMs: number,
  max = 800
): Promise<InstagramComment[]> {
  const results: InstagramComment[] = [];

  const first = new URL(`${instagramGraphBase()}/${mediaId}/comments`);
  first.searchParams.set("fields", "id,text,timestamp,from,replies{from}");
  first.searchParams.set("order", "reverse_chronological");
  first.searchParams.set("limit", "50");
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: InstagramComment[];
      paging?: { next?: string };
    }>(response);
    const data = page.data ?? [];
    results.push(...data);

    // Newest-first, so once the last item on a page predates the window there
    // is nothing older worth fetching.
    const oldest = data[data.length - 1];
    if (oldest?.timestamp && Date.parse(oldest.timestamp) < sinceMs) break;
    nextUrl = page.paging?.next ?? null;
  }

  return results
    .filter((c) => !c.timestamp || Date.parse(c.timestamp) >= sinceMs)
    .slice(0, max);
}

// --- Direct message inbox (Conversations API) ---------------------------

export interface InstagramParticipant {
  id: string;
  username?: string;
}

export interface InstagramMessage {
  id: string;
  created_time?: string;
  message?: string;
  from?: InstagramParticipant;
  to?: { data: InstagramParticipant[] };
}

export interface InstagramConversation {
  id: string;
  updated_time?: string;
  participants?: { data: InstagramParticipant[] };
  messages?: { data: InstagramMessage[] };
}

/**
 * List the account's DM conversations, newest first, each with its participants
 * and a one-message preview. `igUserId` is the account's professional user_id
 * (the same id used to send messages and as webhook entry.id).
 */
export async function getConversations(
  accessToken: string,
  igUserId: string
): Promise<InstagramConversation[]> {
  const url = new URL(`${instagramGraphBase()}/${igUserId}/conversations`);
  url.searchParams.set("platform", "instagram");
  url.searchParams.set(
    "fields",
    "participants,updated_time,messages.limit(1){message,from,created_time}"
  );
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramConversation[] }>(response);
  return data.data ?? [];
}

/**
 * The messages in a conversation, with content. Meta only returns full details
 * for the 20 most recent messages, newest first.
 */
export async function getConversationMessages(
  accessToken: string,
  conversationId: string
): Promise<InstagramMessage[]> {
  const url = new URL(`${instagramGraphBase()}/${conversationId}`);
  url.searchParams.set("fields", "messages{id,created_time,from,to,message}");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ messages?: { data: InstagramMessage[] } }>(
    response
  );
  return data.messages?.data ?? [];
}

export async function getUserInfo(accessToken: string): Promise<InstagramUser> {
  const url = new URL(`${instagramGraphBase()}/me`);
  url.searchParams.set(
    "fields",
    "id,user_id,username,name,profile_picture_url,followers_count"
  );
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  return handleResponse<InstagramUser>(response);
}

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count";

// Instagram caps a single media page at 100 items.
const MEDIA_PAGE_SIZE = 100;

export async function getUserMedia(
  accessToken: string,
  limit = 25
): Promise<InstagramMedia[]> {
  const url = new URL(`${instagramGraphBase()}/me/media`);
  url.searchParams.set("fields", MEDIA_FIELDS);
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramMedia[] }>(response);
  return data.data;
}

/**
 * Fetch media by following pagination cursors until `max` items are collected
 * or there are no more pages. Pass a large `max` for an "all time" view; the
 * cap is a safety ceiling so an account with thousands of posts can't spin
 * forever (and so downstream per-media insight calls stay bounded).
 */
export async function getAllUserMedia(
  accessToken: string,
  max = 500
): Promise<InstagramMedia[]> {
  const results: InstagramMedia[] = [];

  const first = new URL(`${instagramGraphBase()}/me/media`);
  first.searchParams.set("fields", MEDIA_FIELDS);
  first.searchParams.set("limit", String(Math.min(MEDIA_PAGE_SIZE, max)));
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: InstagramMedia[];
      paging?: { next?: string };
    }>(response);
    results.push(...page.data);
    nextUrl = page.paging?.next ?? null;
  }

  return results.slice(0, max);
}

/**
 * Fetch per-media insight metrics (views, reach, saved, shares, etc.).
 *
 * Requires the `instagram_business_manage_insights` permission — accounts
 * connected before that scope was requested will throw a PermissionError.
 * Metric validity varies by media type, so pass only metrics that apply to
 * the given media (e.g. `views` is not valid for image posts on some accounts).
 */
export async function getMediaInsights(
  accessToken: string,
  mediaId: string,
  metrics: string[]
): Promise<InstagramMediaInsights> {
  const url = new URL(`${instagramGraphBase()}/${mediaId}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{
    data: Array<{ name: string; values: Array<{ value: number }> }>;
  }>(response);

  const result: InstagramMediaInsights = {};
  for (const entry of data.data) {
    result[entry.name as keyof InstagramMediaInsights] =
      entry.values?.[0]?.value ?? 0;
  }
  return result;
}

/** One day of net follower change, as reported by account insights. */
export interface FollowerCountPoint {
  /** ISO date (YYYY-MM-DD) the change is attributed to. */
  date: string;
  /** Net followers gained (or lost, if negative) that day. */
  delta: number;
}

// Instagram only retains ~30 days of account insights, and rejects windows
// wider than 30 days outright. Stay just inside the limit.
const FOLLOWER_INSIGHT_MAX_DAYS = 30;

/**
 * Fetch the daily net follower change for an account.
 *
 * Requires `instagram_business_manage_insights`. Note this metric is *not*
 * universally available: Instagram omits it for accounts under 100 followers
 * and it is unsupported on some account types. Callers must treat `null` as
 * "no series available" rather than an error — see the backfill in
 * `lib/reports/follower-history.ts`.
 *
 * Returns daily deltas, not running totals. Reconstruct absolute counts by
 * anchoring on a known `followers_count` and walking backwards.
 */
export async function getFollowerCountSeries(
  accessToken: string,
  instagramAccountId: string,
  days: number = FOLLOWER_INSIGHT_MAX_DAYS
): Promise<FollowerCountPoint[] | null> {
  const span = Math.min(Math.max(days, 1), FOLLOWER_INSIGHT_MAX_DAYS);
  const until = Math.floor(Date.now() / 1000);
  const since = until - (span - 1) * 86_400;

  const url = new URL(`${instagramGraphBase()}/${instagramAccountId}/insights`);
  url.searchParams.set("metric", "follower_count");
  url.searchParams.set("period", "day");
  url.searchParams.set("since", String(since));
  url.searchParams.set("until", String(until));
  url.searchParams.set("access_token", accessToken);

  try {
    const response = await fetch(url.toString());
    const data = await handleResponse<{
      data: Array<{
        name: string;
        values: Array<{ value: number; end_time?: string }>;
      }>;
    }>(response);

    const metric = data.data.find((d) => d.name === "follower_count");
    if (!metric?.values?.length) return null;

    return metric.values.map((v) => ({
      date: (v.end_time ?? new Date().toISOString()).slice(0, 10),
      delta: v.value ?? 0,
    }));
  } catch (err) {
    // A missing permission is a real signal the caller may want to surface;
    // anything else here means the metric is simply unavailable for this
    // account, which is not worth failing the whole dashboard over.
    if (err instanceof PermissionError) throw err;
    console.warn(
      "[Instagram] follower_count insights unavailable:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function getLongLivedToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(`${instagramGraphRoot()}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", requireEnv("INSTAGRAM_APP_SECRET"));
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<TokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

export async function refreshLongLivedToken(
  longLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(`${instagramGraphRoot()}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", longLivedToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<TokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

export async function subscribeInstagramAccountToWebhooks(
  instagramAccountId: string,
  accessToken: string
): Promise<{ success: boolean }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        subscribed_fields: ["comments", "messages"],
      }),
    }
  );

  return handleResponse(response);
}

export async function debugToken(inputToken: string, accessToken: string) {
  const url = new URL(`${facebookGraphBase()}/debug_token`);
  url.searchParams.set("input_token", inputToken);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  return handleResponse(response);
}

// ---------------------------------------------------------------------------
// Business discovery: números públicos de OUTRA conta profissional (radar de
// referências do Netuno). Só lê; não existe escrita em conta alheia.
//
// A Meta documenta o endpoint para tokens de Facebook Login / Unified Login
// (graph.facebook.com). Com o token de Instagram Login das contas daqui pode
// não estar liberado, então tentamos primeiro graph.instagram.com com o token
// da conta e, se a Meta negar, caímos para graph.facebook.com quando houver
// META_DISCOVERY_TOKEN + META_DISCOVERY_IG_USER_ID no ambiente.
// ---------------------------------------------------------------------------

export interface DiscoveredMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  view_count?: number;
}

export interface DiscoveredProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  media: DiscoveredMedia[];
  via: "instagram" | "facebook";
}

const DISCOVERY_MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,view_count";

export function isInstagramHandle(handle: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(handle.replace(/^@/, ""));
}

export function businessDiscoveryFields(username: string, mediaLimit: number) {
  const handle = username.replace(/^@/, "").trim();
  if (!isInstagramHandle(handle)) throw new Error(`Invalid Instagram username: ${username}`);
  return `business_discovery.username(${handle}){id,username,name,biography,followers_count,media_count,media.limit(${mediaLimit}){${DISCOVERY_MEDIA_FIELDS}}}`;
}

async function discoveryCall(
  base: string,
  igUserId: string,
  token: string,
  fields: string
) {
  const url = new URL(`${base}/${igUserId}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  const data = await handleResponse<{
    business_discovery?: Omit<DiscoveredProfile, "media" | "via"> & {
      media?: { data: DiscoveredMedia[] };
    };
  }>(await fetch(url.toString()));
  if (!data.business_discovery) {
    throw new MetaApiError(404, undefined, undefined, "Profile not found or not a professional account.");
  }
  return data.business_discovery;
}

export async function getBusinessDiscovery(
  accessToken: string,
  igUserId: string,
  username: string,
  mediaLimit = 25
): Promise<DiscoveredProfile> {
  const fields = businessDiscoveryFields(username, Math.min(Math.max(mediaLimit, 1), 50));
  const fbToken = process.env.META_DISCOVERY_TOKEN;
  const fbIgUser = process.env.META_DISCOVERY_IG_USER_ID;

  let raw;
  let via: DiscoveredProfile["via"] = "instagram";
  try {
    raw = await discoveryCall(instagramGraphBase(), igUserId, accessToken, fields);
  } catch (err) {
    // Só tenta o outro caminho quando a Meta negou o endpoint, não em perfil
    // inexistente, limite ou token vencido.
    const denied = err instanceof PermissionError || (err instanceof MetaApiError && err.code === 3);
    if (!denied || !fbToken || !fbIgUser) throw err;
    raw = await discoveryCall(facebookGraphBase(), fbIgUser, fbToken, fields);
    via = "facebook";
  }

  const { media, ...profile } = raw;
  return { ...profile, media: media?.data ?? [], via };
}

// ── Publicação de Reels (15/11): Instagram API com Instagram Login. ──
// Fluxo da Meta: cria o contêiner com o link público do vídeo (a Meta baixa o
// arquivo), espera o status FINISHED e publica. Precisa da permissão
// instagram_business_content_publish no login da conta. Limite da Meta: 100
// posts publicados pela API em 24 h por conta (/content_publishing_limit).

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

export async function createReelContainer(
  accessToken: string,
  instagramAccountId: string,
  input: { videoUrl: string; caption: string; shareToFeed: boolean; coverUrl?: string | null; thumbOffsetMs?: number | null }
): Promise<{ id: string }> {
  // 17/11: com video_url a Meta baixa o arquivo com prazo curto; servidor com upload lento entregava só
  // o começo e o Reel saía com 1 a 5 segundos. Agora o padrão é o upload resumível: o Anzol baixa o MP4
  // inteiro (mesma máquina, rápido), confere o tamanho e manda os bytes pra Meta com file_size explícito.
  // OPENREPLY_PUBLISH_RESUMABLE=0 volta ao video_url.
  const resumable = process.env.OPENREPLY_PUBLISH_RESUMABLE !== "0";
  let video: Buffer | null = null;
  if (resumable) video = await fetchWholeVideo(input.videoUrl);
  const body: Record<string, unknown> = {
    media_type: "REELS",
    caption: input.caption,
    share_to_feed: input.shareToFeed,
  };
  if (resumable) body.upload_type = "resumable";
  else body.video_url = input.videoUrl;
  if (input.coverUrl) body.cover_url = input.coverUrl;
  if (typeof input.thumbOffsetMs === "number") body.thumb_offset = input.thumbOffsetMs;
  const response = await fetch(`${instagramGraphBase()}/${instagramAccountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const c = await handleResponse<{ id: string; uri?: string }>(response);
  if (video) await uploadVideoBytes(accessToken, c.id, video, c.uri);
  return { id: c.id };
}

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

export async function fetchWholeVideo(url: string): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!r.ok) throw new MetaApiError(r.status, undefined, undefined, `Não consegui baixar o vídeo (HTTP ${r.status}).`);
  const declared = Number(r.headers.get("content-length") || 0);
  if (declared > MAX_VIDEO_BYTES) throw new MetaApiError(400, undefined, undefined, "Vídeo maior que 300 MB.");
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || (declared && buf.length !== declared)) throw new MetaApiError(502, undefined, undefined, `Vídeo veio incompleto (${buf.length} de ${declared} bytes).`);
  return buf;
}

export async function uploadVideoBytes(accessToken: string, containerId: string, video: Buffer, uri?: string) {
  const target = uri && /^https:\/\/rupload\.facebook\.com\//.test(uri)
    ? uri
    : `https://rupload.facebook.com/ig-api-upload/${getMetaGraphApiVersion()}/${containerId}`;
  const response = await fetch(target, {
    method: "POST",
    headers: { Authorization: `OAuth ${accessToken}`, offset: "0", file_size: String(video.length), "Content-Type": "application/octet-stream" },
    body: new Uint8Array(video),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const j = await handleResponse<{ success?: boolean }>(response);
  if (j && j.success === false) throw new MetaApiError(502, undefined, undefined, "A Meta recusou o upload do vídeo.");
  return j;
}

export async function getContainerStatus(
  accessToken: string,
  containerId: string
): Promise<{ id: string; status_code?: ContainerStatus; status?: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${containerId}?fields=status_code,status`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return handleResponse(response);
}

export async function publishContainer(
  accessToken: string,
  instagramAccountId: string,
  creationId: string
): Promise<{ id: string }> {
  const response = await fetch(`${instagramGraphBase()}/${instagramAccountId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ creation_id: creationId }),
  });
  return handleResponse(response);
}

export async function getMediaPermalink(
  accessToken: string,
  mediaId: string
): Promise<{ id: string; permalink?: string; timestamp?: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${mediaId}?fields=permalink,timestamp`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return handleResponse(response);
}

export async function getPublishingLimit(
  accessToken: string,
  instagramAccountId: string
): Promise<{ quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/content_publishing_limit?fields=quota_usage,config`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const j = await handleResponse<{ data?: { quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }[] }>(response);
  return (j.data && j.data[0]) || {};
}
