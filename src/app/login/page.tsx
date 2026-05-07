export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--color-bg)] p-6">
      <form
        action="/api/auth/login"
        method="post"
        className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-8 shadow-sm space-y-5"
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">Local sign-in</p>
        </div>
        <input type="hidden" name="next" value={next ?? "/calendar"} />
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
            Password
          </span>
          <input
            type="password"
            name="password"
            autoFocus
            required
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
          />
        </label>
        {error && (
          <p className="text-sm text-[var(--color-danger)]">Wrong password.</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-3 py-2 text-sm font-medium hover:opacity-90"
        >
          Sign in
        </button>
        <p className="text-xs text-[var(--color-fg-muted)]">
          Set <code className="font-mono">APP_PASSWORD</code> in <code className="font-mono">.env</code>.
        </p>
      </form>
    </div>
  );
}
