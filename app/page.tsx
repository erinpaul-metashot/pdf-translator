import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="max-w-2xl rounded-3xl border border-slate-200 bg-white/90 p-10 shadow-xl shadow-slate-200/40 backdrop-blur-xl">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950">
          OpenGrad PDF Hub
        </h1>
        <p className="mt-4 text-lg leading-8 text-slate-700">
          Choose a PDF experience: translate documents with Sarvam AI or convert them to editable HTML.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link
            href="/sarvam"
            className="inline-flex h-12 w-full items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white transition hover:bg-emerald-700"
          >
            Sarvam PDF Translator
          </Link>
          <Link
            href="/pdf-to-editable-html"
            className="inline-flex h-12 w-full items-center justify-center rounded-md bg-slate-100 px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-200"
          >
            PDF to Editable HTML
          </Link>
        </div>
      </div>
    </main>
  );
}
