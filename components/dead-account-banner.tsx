/**
 * Aviso de conta desconectada.
 *
 * Fica acima de tudo, em toda tela, porque quando o token morre **nada
 * funciona**: automação não envia, caixa de entrada não carrega, análise não
 * busca. Antes disto o único sinal era uma lista de alertas dentro do
 * Diagnóstico, e o resultado real foi meia hora de mensagens falhando sem
 * ninguém saber — com pessoas comentando e não recebendo resposta.
 *
 * O aviso diz três coisas, nessa ordem: o que quebrou, desde quando, e o botão
 * que conserta. O motivo cru da Meta fica por último, porque é o que menos
 * ajuda a decidir o que fazer.
 */

interface DeadAccount {
  id: string;
  username: string;
  tokenInvalidAt: string;
  tokenInvalidReason: string | null;
}

function since(value: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

export default function DeadAccountBanner({
  accounts,
}: {
  accounts: DeadAccount[];
}) {
  if (accounts.length === 0) return null;

  return (
    <div className="border-b border-error/30 bg-error/10 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-error">
            {accounts.length === 1
              ? `A conta @${accounts[0].username} está desconectada`
              : `${accounts.length} contas do Instagram estão desconectadas`}
          </p>
          <p className="mt-0.5 text-sm text-foreground">
            Nenhuma automação está enviando {since(accounts[0].tokenInvalidAt)}.
            Isso costuma acontecer quando a senha do Instagram muda ou a Meta
            derruba a sessão por segurança.
          </p>
          {accounts[0].tokenInvalidReason && (
            <p className="mt-1 truncate text-xs text-muted">
              {accounts[0].tokenInvalidReason}
            </p>
          )}
        </div>

        <a
          href="/api/instagram/connect"
          className="shrink-0 rounded-lg bg-error px-4 py-2 text-center text-sm font-medium text-white"
        >
          Reconectar agora
        </a>
      </div>
    </div>
  );
}
