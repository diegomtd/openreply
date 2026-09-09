-- Sequência de mensagens depois do link.
--
-- Generaliza o antigo trio followUpEnabled / followUpMessage /
-- followUpDelayMinutes, que só permitia uma mensagem, em N passos ordenados.

-- CreateTable
CREATE TABLE "AutomationStep" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationStep_automationId_order_key" ON "AutomationStep"("automationId", "order");
CREATE INDEX "AutomationStep_automationId_idx" ON "AutomationStep"("automationId");

-- AddForeignKey
ALTER TABLE "AutomationStep" ADD CONSTRAINT "AutomationStep_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Converte o follow-up existente no passo 1, para nenhuma automação em produção
-- perder a mensagem que já enviava. As colunas antigas ficam onde estão: o
-- worker para de lê-las, mas um rollback continua possível sem perder dado.
INSERT INTO "AutomationStep" (
    "id", "automationId", "order", "message", "delayMinutes",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    a."id",
    1,
    a."followUpMessage",
    GREATEST(0, LEAST(1440, a."followUpDelayMinutes")),
    NOW(),
    NOW()
FROM "Automation" a
WHERE a."followUpEnabled" = true
  AND a."followUpMessage" IS NOT NULL
  AND btrim(a."followUpMessage") <> ''
ON CONFLICT ("automationId", "order") DO NOTHING;
