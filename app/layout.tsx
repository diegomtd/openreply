import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenReply — Automação de comentário para DM no Instagram",
  description:
    "Alternativa ao ManyChat, gratuita e no seu próprio servidor. Envia um DM automático quando alguém comenta uma palavra-chave no seu post ou reel, pela API oficial da Meta.",
  keywords: [
    "automação instagram",
    "comentário para dm",
    "resposta privada instagram",
    "alternativa manychat",
    "automação de dm",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full dark">
      <body className="min-h-full bg-background text-foreground font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
