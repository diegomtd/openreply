-- Funis: passo condicional (clicou / não clicou), clique por contato e parada
-- quando a pessoa responde. Aditiva, sem DROP: automações existentes seguem
-- iguais (condição ALWAYS, stopOnReply desligado).
CREATE TYPE "StepCondition" AS ENUM ('ALWAYS', 'NOT_CLICKED', 'CLICKED');

ALTER TABLE "AutomationStep" ADD COLUMN "condition" "StepCondition" NOT NULL DEFAULT 'ALWAYS';

ALTER TABLE "Automation" ADD COLUMN "stopOnReply" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LinkClick" ADD COLUMN "contactId" TEXT;
CREATE INDEX "LinkClick_contactId_automationId_idx" ON "LinkClick"("contactId", "automationId");
ALTER TABLE "LinkClick" ADD CONSTRAINT "LinkClick_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
