-- Condição por tag de contato.
--
-- `Contact.tags` já existia mas não tinha como preencher nem usar. Agora uma
-- automação pode exigir tags e excluir tags — o equivalente ao nó de Condição do
-- ManyChat, mas como configuração em vez de flow.

-- AlterEnum
-- IF NOT EXISTS: ver a nota na migration de frequencia.
ALTER TYPE "DmStatus" ADD VALUE IF NOT EXISTS 'SKIPPED_TAG_RULE';

-- AlterTable
ALTER TABLE "Automation"
  ADD COLUMN "requiredTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "excludedTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
