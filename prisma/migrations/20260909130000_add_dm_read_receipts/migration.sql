-- Recibo de leitura no DmLog, para fechar o funil enviado → lido → clicado.
--
-- A Meta manda o recibo como watermark ("li tudo até este instante"), não por
-- mensagem, então `readAt` é preenchido por varredura no webhook de leitura.

-- AlterTable
ALTER TABLE "DmLog" ADD COLUMN "readAt" TIMESTAMP(3);

-- CreateIndex
-- É exatamente o filtro da varredura: envios desta conta para este contato,
-- anteriores ao watermark.
CREATE INDEX "DmLog_instagramAccountId_commenterId_dmSentAt_idx"
  ON "DmLog"("instagramAccountId", "commenterId", "dmSentAt");
