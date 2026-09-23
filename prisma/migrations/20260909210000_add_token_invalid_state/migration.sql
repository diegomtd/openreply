-- Estado de token morto na conta do Instagram.
--
-- O app já sabia lançar TokenExpiredError no erro 190 da Meta, mas não guardava
-- isso em lugar nenhum: a fila continuava tentando contra um token morto, e o
-- único sinal para o usuário era uma lista de alertas escondida no Diagnóstico.
-- Em produção isso significou automações falhando por meia hora em silêncio,
-- com seguidoras reais comentando e não recebendo nada.
--
-- `tokenExpiresAt` não cobria o caso: um token é invalidado na hora quando a
-- pessoa troca a senha do Instagram ou a Meta derruba a sessão por segurança,
-- muito antes da data de expiração.

-- AlterTable
ALTER TABLE "InstagramAccount"
  ADD COLUMN "tokenInvalidAt" TIMESTAMP(3),
  ADD COLUMN "tokenInvalidReason" TEXT;

-- CreateIndex
-- A cada carregamento do painel se pergunta "alguma conta deste workspace está
-- morta?". Sem índice isso varre a tabela em toda navegação.
CREATE INDEX "InstagramAccount_workspaceId_tokenInvalidAt_idx"
  ON "InstagramAccount"("workspaceId", "tokenInvalidAt");
