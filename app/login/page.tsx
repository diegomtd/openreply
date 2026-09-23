import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";

export const metadata = {
  title: "Entrar — OpenReply",
  description: "Entre para gerenciar suas automações de comentário para DM no Instagram.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkEmail?: string;
    callbackUrl?: string;
    template?: string;
    mode?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const checkEmail = params.checkEmail === "1";
  const usePassword = params.mode === "senha";
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate
    ? `/campaigns/new?template=${selectedTemplate.slug}`
    : null;
  const callbackUrl = params.callbackUrl ?? templateCallbackUrl ?? "/dashboard";
  const templateQuery = params.template
    ? `&template=${encodeURIComponent(params.template)}`
    : "";

  async function sendMagicLink(formData: FormData) {
    "use server";
    await signIn("resend", {
      email: String(formData.get("email") ?? ""),
      redirectTo: callbackUrl,
    });
  }

  async function loginWithPassword(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: callbackUrl,
      });
    } catch (error) {
      // O próprio signIn() usa redirect() por baixo para levar ao
      // callbackUrl no sucesso, o que também lança — precisa deixar passar,
      // senão um login CERTO cairia aqui e voltaria pra tela de erro.
      if (error instanceof AuthError) {
        redirect(`/login?mode=senha&error=1${templateQuery}`);
      }
      throw error;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground">
            OpenReply
          </h1>
          <p className="text-muted text-sm leading-relaxed mt-2">
            {selectedTemplate
              ? `Entre para usar o modelo ${selectedTemplate.title}.`
              : "Entre pelo e-mail e depois conecte sua conta profissional do Instagram."}
          </p>
        </div>

        <div className="panel rounded p-8 shadow-black/40">
          {selectedTemplate && !checkEmail && (
            <div className="mb-5 border border-accent/20 bg-accent/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                Modelo escolhido
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {selectedTemplate.title}
              </p>
            </div>
          )}

          {checkEmail ? (
            <div className="text-center py-4">
              <h2 className="text-lg font-semibold mb-2">Confira seu e-mail</h2>
              <p className="text-sm text-muted">
                Mandamos um link de acesso. Abra nesta mesma máquina para
                continuar.
              </p>
            </div>
          ) : usePassword ? (
            <>
              {params.error && (
                <p className="mb-4 text-sm text-error">
                  E-mail ou senha incorretos. Se errou várias vezes seguidas,
                  espere alguns minutos e tente de novo.
                </p>
              )}
              <form action={loginWithPassword} className="space-y-5">
                <div className="space-y-2">
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-foreground"
                  >
                    Seu e-mail
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="voce@email.com"
                    className="w-full px-4 py-3 rounded bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-foreground"
                  >
                    Senha
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full px-4 py-3 rounded bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-indigo-500/25 transition-all hover:shadow-indigo-500/30"
                >
                  Entrar
                </button>
              </form>
              <p className="mt-4 text-center text-xs text-muted">
                Esqueceu a senha?{" "}
                <Link
                  href={`/login${params.template ? `?template=${encodeURIComponent(params.template)}` : ""}`}
                  className="text-accent hover:underline"
                >
                  entre pelo link por e-mail
                </Link>{" "}
                e defina uma nova em Configurações.
              </p>
            </>
          ) : (
            <>
              <form action={sendMagicLink} className="space-y-5">
                <div className="space-y-2">
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-foreground"
                  >
                    Seu e-mail
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="voce@email.com"
                    className="w-full px-4 py-3 rounded bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-indigo-500/25 transition-all hover:shadow-indigo-500/30"
                >
                  Me manda o link de acesso
                </button>
              </form>
              <p className="mt-4 text-center text-xs text-muted">
                Tem e-mail e senha?{" "}
                <Link
                  href={`/login?mode=senha${templateQuery}`}
                  className="text-accent hover:underline"
                >
                  entre por aqui
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
