/**
 * Rótulo do status de um envio. Texto puro; a cor carrega o estado.
 */

const statusConfig: Record<string, { text: string; label: string }> = {
  SENT: { text: "text-success", label: "Enviado" },
  FAILED: { text: "text-error", label: "Falhou" },
  PENDING: { text: "text-warning", label: "Na fila" },
  SKIPPED_DEDUP: { text: "text-muted", label: "Duplicado" },
  SKIPPED_RATE_LIMIT: { text: "text-warning", label: "Limite por hora" },
  SKIPPED_PLAN_LIMIT: { text: "text-warning", label: "Limite do mês" },
  SKIPPED_NO_MATCH: { text: "text-muted", label: "Sem correspondência" },
  SKIPPED_ALREADY_SENT: { text: "text-muted", label: "Já recebeu" },
  SKIPPED_COOLDOWN: { text: "text-muted", label: "Em intervalo" },
  SKIPPED_OPTED_OUT: { text: "text-muted", label: "Silenciado" },
  SKIPPED_TAG_RULE: { text: "text-muted", label: "Regra de tag" },
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.PENDING;

  return (
    <span className={`shrink-0 whitespace-nowrap text-sm ${config.text}`}>
      {config.label}
    </span>
  );
}
