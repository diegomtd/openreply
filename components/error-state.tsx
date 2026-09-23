/**
 * O bloco de erro das telas.
 *
 * Um erro numa tela precisa responder três coisas: o que houve, por quê, e o
 * que fazer. Antes, estas telas mostravam só a string crua da API — que
 * responde a primeira mal e as outras duas nem tenta.
 */

import { humanizeApiError } from "@/lib/ui/api-error";

export default function ErrorState({
  error,
  onRetry,
}: {
  error: string | null | undefined;
  onRetry?: () => void;
}) {
  const friendly = humanizeApiError(error);

  return (
    <div className="panel rounded p-6">
      <p className="text-sm font-semibold text-error">{friendly.title}</p>
      <p className="mt-1 max-w-2xl text-sm text-muted">{friendly.detail}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {friendly.action && (
          <a
            href={friendly.action.href}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            {friendly.action.label}
          </a>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
          >
            Tentar de novo
          </button>
        )}
      </div>
    </div>
  );
}
