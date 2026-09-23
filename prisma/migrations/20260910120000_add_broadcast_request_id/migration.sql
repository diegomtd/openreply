-- Chave de idempotência do Envio ativo.
--
-- Um POST repetido (duplo clique, retry de rede, refresh no meio do envio)
-- criava um Broadcast novo e disparava tudo de novo. Não existe des-enviar um
-- DM, então este é o tipo de erro que não dá para corrigir depois.
--
-- Nula por padrão: no Postgres um índice único permite vários NULL, então os
-- envios já existentes continuam válidos sem valor nenhum.

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN "requestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Broadcast_requestId_key" ON "Broadcast"("requestId");
