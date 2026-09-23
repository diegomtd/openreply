-- Login por e-mail e senha, como alternativa ao link mágico.
-- Nulo é o padrão: continua funcionando exatamente como antes para quem não
-- definir uma senha. Aditiva, sem DROP.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
