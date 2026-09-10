/**
 * Cartão de número.
 *
 * Com `href`, vira destino: o número deixa de ser um enfeite e leva para a lista
 * que o explica. "4 falhas" só serve se der para perguntar *quais*.
 *
 * `tone="alert"` existe para uma coisa só: falha maior que zero. Um número
 * ruim pintado igual a um número bom não é lido como ruim — foi assim que uma
 * conta desconectada passou meia hora sem ninguém perceber.
 */

import Link from "next/link";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
  /** Para onde o número leva. Sem isto, o cartão é só leitura. */
  href?: string;
  /** Uma linha de contexto abaixo do número. */
  hint?: string;
  tone?: "default" | "alert";
}

export default function StatCard({
  label,
  value,
  trend,
  trendUp,
  href,
  hint,
  tone = "default",
}: StatCardProps) {
  const alert = tone === "alert";

  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          alert ? "text-error" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {trend && (
        <p className={`text-xs mt-1 ${trendUp ? "text-success" : "text-error"}`}>
          {trendUp ? "Subiu" : "Caiu"} {trend}
        </p>
      )}
    </>
  );

  const shell = `panel rounded p-4 ${
    alert ? "border-error/30 bg-error/5" : ""
  }`;

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      href={href}
      className={`${shell} block transition-colors hover:border-border-hover hover:bg-surface-hover`}
    >
      {body}
    </Link>
  );
}
