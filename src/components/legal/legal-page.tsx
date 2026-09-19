import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

export type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type LegalPageProps = {
  documentType: 'privacy' | 'terms' | 'deletion';
  eyebrow: string;
  title: string;
  description: string;
  updatedAt: string;
  sections: LegalSection[];
};

const legalLinks = [
  { href: '/politica-de-privacidade', label: 'Política de Privacidade' },
  { href: '/termos-de-uso', label: 'Termos de Uso' },
  { href: '/exclusao-de-dados', label: 'Exclusão de Dados' },
] as const;

export function LegalPage({
  documentType,
  eyebrow,
  title,
  description,
  updatedAt,
  sections,
}: LegalPageProps) {
  const DocumentIcon =
    documentType === 'privacy'
      ? ShieldCheck
      : documentType === 'deletion'
        ? Trash2
        : FileText;

  return (
    <div className="bg-background text-foreground relative min-h-screen overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_top_left,var(--primary-soft-2),transparent_48%)]"
      />
      <div
        aria-hidden="true"
        className="bg-primary/5 pointer-events-none absolute top-32 -right-40 h-96 w-96 rounded-full blur-3xl"
      />

      <header className="border-border/80 bg-background/85 relative border-b backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            href="/login"
            className="group focus-visible:ring-ring flex items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
            aria-label="WACRM — ir para o login"
          >
            <span className="border-primary/20 bg-primary/10 shadow-primary/10 group-hover:bg-primary/15 flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm transition-colors">
              <MessageSquare className="text-primary h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">
                WACRM
              </span>
              <span className="text-muted-foreground block text-xs">
                Atendimento e vendas no WhatsApp
              </span>
            </span>
          </Link>

          <nav
            aria-label="Documentos legais"
            className="hidden items-center gap-1 sm:flex"
          >
            {legalLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={
                  (documentType === 'privacy' &&
                    link.href === '/politica-de-privacidade') ||
                  (documentType === 'terms' &&
                    link.href === '/termos-de-uso') ||
                  (documentType === 'deletion' &&
                    link.href === '/exclusao-de-dados')
                    ? 'page'
                    : undefined
                }
                className="text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary rounded-lg px-3 py-2 text-sm transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              className="bg-primary text-primary-foreground hover:bg-primary-hover ml-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              Acessar o WACRM
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
        <div className="mb-10 max-w-3xl sm:mb-14">
          <div className="border-primary/20 bg-primary/10 text-primary mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium tracking-wide uppercase">
            <DocumentIcon className="h-3.5 w-3.5" />
            {eyebrow}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
            {title}
          </h1>
          <p className="text-muted-foreground mt-5 max-w-2xl text-base leading-7 sm:text-lg">
            {description}
          </p>
          <div className="text-muted-foreground mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="inline-flex items-center gap-2">
              <LockKeyhole className="text-primary h-4 w-4" />
              Documento público
            </span>
            <span>Última atualização: {updatedAt}</span>
          </div>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
          <aside className="lg:sticky lg:top-6">
            <div className="border-border bg-card/80 rounded-2xl border p-4 shadow-sm backdrop-blur-sm">
              <p className="text-muted-foreground px-2 pb-3 text-xs font-semibold tracking-wider uppercase">
                Neste documento
              </p>
              <nav aria-label={`Índice de ${title}`}>
                <ol className="space-y-1">
                  {sections.map((section, index) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="text-muted-foreground hover:bg-muted hover:text-foreground flex gap-3 rounded-lg px-2 py-2 text-sm leading-5 transition-colors"
                      >
                        <span className="text-primary/80 font-mono text-xs leading-5">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span>{section.title}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </div>
          </aside>

          <article className="border-border bg-card/75 min-w-0 rounded-3xl border px-5 py-2 shadow-xl shadow-black/5 backdrop-blur-sm sm:px-8 lg:px-10">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className="border-border/70 [&_a]:text-primary [&_p]:text-muted-foreground [&_strong]:text-foreground [&_ul]:text-muted-foreground scroll-mt-8 border-b py-8 last:border-b-0 sm:py-10 [&_a]:font-medium [&_a]:underline-offset-4 hover:[&_a]:underline [&_li]:pl-1 [&_p]:leading-7 [&_p+p]:mt-4 [&_strong]:font-semibold [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5"
              >
                <div className="mb-4 flex items-start gap-3">
                  <span className="text-primary/80 mt-1 font-mono text-xs">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                    {section.title}
                  </h2>
                </div>
                <div>{section.content}</div>
              </section>
            ))}
          </article>
        </div>
      </main>

      <footer className="border-border/80 bg-card/40 relative border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 text-sm sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <p className="text-foreground font-medium">WACRM</p>
            <p className="mt-1">crm.luizangelo.com.br</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {legalLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              className="text-primary hover:text-primary-hover inline-flex items-center gap-1.5 font-medium transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar ao login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
