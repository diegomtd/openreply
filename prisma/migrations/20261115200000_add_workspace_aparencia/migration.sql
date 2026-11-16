-- Aparência do painel por workspace (tema, cor de destaque, nome da marca).
ALTER TABLE "Workspace" ADD COLUMN "uiTema" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "Workspace" ADD COLUMN "uiAcento" TEXT NOT NULL DEFAULT 'gelo';
ALTER TABLE "Workspace" ADD COLUMN "uiMarca" TEXT;
