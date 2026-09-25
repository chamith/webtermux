import { useState } from "react";
import { api } from "../api";

export default function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onLoggedIn();
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950">
      <form
        onSubmit={submit}
        className="flex w-72 flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-6"
      >
        <h1 className="text-lg font-semibold text-neutral-100">Webtermux</h1>
        <input
          autoFocus
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none ring-1 ring-neutral-700 focus:ring-emerald-600"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          disabled={busy}
          className="rounded bg-emerald-700 px-2 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
