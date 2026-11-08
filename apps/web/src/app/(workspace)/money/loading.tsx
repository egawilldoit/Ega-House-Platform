export default function MoneyLoading() {
  return <main aria-busy="true" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
    <h1 className="text-xl font-semibold">Money</h1>
    <p role="status" className="mt-6 text-ega-text-secondary">Loading expenses…</p>
  </main>;
}
