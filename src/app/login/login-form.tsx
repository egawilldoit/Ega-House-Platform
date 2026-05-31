"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const PLATFORM_HOST = "egawilldoit.online";

function getSafeRedirect(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    if (raw.startsWith("/") && !raw.startsWith("//")) {
      return new URL(raw, window.location.origin);
    }
    const url = new URL(raw);
    if (
      url.hostname === PLATFORM_HOST ||
      url.hostname.endsWith(`.${PLATFORM_HOST}`) ||
      url.hostname === "localhost"
    ) {
      return url;
    }
  } catch {
    // ignore
  }
  return null;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const supabase = createClient();

      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        if (authError.message.includes("Missing env.NEXT_PUBLIC_SUPABASE_URL")) {
          setError("Supabase URL is not configured. Check your environment variables.");
        } else if (authError.message.includes("Missing env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) {
          setError("Supabase key is not configured. Check your environment variables.");
        } else {
          setError(authError.message);
        }
        return;
      }

      const nextParam = searchParams.get("next");
      const safeRedirect = getSafeRedirect(nextParam);

      if (!safeRedirect || safeRedirect.origin === window.location.origin) {
        const path = safeRedirect
          ? safeRedirect.pathname + safeRedirect.search + safeRedirect.hash
          : "/dashboard";
        router.replace(path);
        router.refresh();
      } else {
        window.location.assign(safeRedirect.href);
      }
    });
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ega-root {
          min-height: 100vh;
          background: #F2E97E;
          background-image:
            radial-gradient(ellipse 80% 60% at 20% 10%, rgba(255,255,255,0.38) 0%, transparent 60%),
            radial-gradient(ellipse 60% 80% at 85% 90%, rgba(210,195,40,0.28) 0%, transparent 60%);
          font-family: 'DM Sans', sans-serif;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
        }

        .ega-noise {
          position: fixed;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
          pointer-events: none;
          z-index: 0;
          opacity: 0.6;
        }

        .ega-inner {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: 1fr 520px;
          grid-template-rows: 1fr auto;
          min-height: 100vh;
          max-width: 1400px;
          margin: 0 auto;
          width: 100%;
          padding: 0 48px;
          gap: 0 64px;
          align-items: center;
        }

        .ega-left {
          padding: 80px 0 60px;
          display: flex;
          flex-direction: column;
          animation: fadeUp 0.7s cubic-bezier(.22,1,.36,1) both;
        }

        .ega-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px 6px 10px;
          border: 1px solid rgba(18,58,62,0.18);
          border-radius: 100px;
          background: rgba(255,255,255,0.35);
          backdrop-filter: blur(8px);
          width: fit-content;
          margin-bottom: 44px;
        }

        .ega-badge-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #C8392B;
          box-shadow: 0 0 0 3px rgba(200,57,43,0.18);
          animation: pulse 2.5s ease-in-out infinite;
        }

        .ega-badge-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.12em;
          color: #1E3A3D; text-transform: uppercase;
        }

        .ega-headline {
          font-family: 'DM Serif Display', serif;
          font-size: clamp(64px, 7vw, 96px);
          line-height: 0.95;
          letter-spacing: -0.02em;
          color: #1E3A3D;
          margin-bottom: 4px;
        }

        .ega-headline-accent {
          color: #C8392B;
          font-style: italic;
          display: block;
        }

        .ega-sub {
          font-size: 16px;
          color: rgba(18,48,52,0.65);
          line-height: 1.6;
          max-width: 440px;
          margin-top: 24px;
          margin-bottom: 52px;
        }

        .ega-cards { display: flex; gap: 14px; }

        .ega-card {
          background: rgba(255,255,255,0.45);
          border: 1px solid rgba(18,58,62,0.1);
          border-radius: 16px;
          padding: 20px 22px;
          flex: 1;
          backdrop-filter: blur(12px);
          transition: all 0.25s ease;
          cursor: default;
        }

        .ega-card:hover {
          background: rgba(255,255,255,0.62);
          border-color: rgba(18,58,62,0.18);
          transform: translateY(-2px);
        }

        .ega-card-icon { color: #1E3A3D; opacity: 0.7; margin-bottom: 14px; }

        .ega-card-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px; font-weight: 500;
          letter-spacing: 0.14em;
          color: rgba(18,58,62,0.5);
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .ega-card-desc { font-size: 13px; color: #1E3A3D; line-height: 1.5; }

        .ega-right {
          padding: 80px 0 60px;
          display: flex;
          align-items: center;
          animation: fadeUp 0.7s 0.12s cubic-bezier(.22,1,.36,1) both;
        }

        .ega-form-card {
          width: 100%;
          background: rgba(255,255,255,0.72);
          border: 1px solid rgba(255,255,255,0.9);
          border-radius: 28px;
          padding: 48px 44px;
          backdrop-filter: blur(32px);
          box-shadow:
            0 2px 0 rgba(255,255,255,0.9) inset,
            0 32px 80px rgba(18,48,52,0.10),
            0 8px 24px rgba(18,48,52,0.06);
        }

        .ega-form-eyebrow {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.14em;
          color: rgba(18,58,62,0.45);
          text-transform: uppercase;
          margin-bottom: 12px;
        }

        .ega-form-title {
          font-family: 'DM Serif Display', serif;
          font-size: 32px; color: #1E3A3D;
          line-height: 1.1; letter-spacing: -0.01em;
          margin-bottom: 10px;
        }

        .ega-form-sub {
          font-size: 14px; color: rgba(18,58,62,0.55);
          line-height: 1.55; margin-bottom: 36px;
        }

        .ega-field { margin-bottom: 20px; }

        .ega-label {
          display: block; font-size: 13px; font-weight: 500;
          color: #1E3A3D; margin-bottom: 8px; letter-spacing: -0.01em;
        }

        .ega-input-wrap { position: relative; }

        .ega-input {
          width: 100%;
          padding: 14px 44px 14px 16px;
          background: rgba(255,255,255,0.7);
          border: 1.5px solid rgba(18,58,62,0.12);
          border-radius: 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px; color: #1E3A3D;
          outline: none; transition: all 0.2s ease;
          -webkit-appearance: none;
        }

        .ega-input::placeholder { color: rgba(18,58,62,0.3); }

        .ega-input:focus {
          border-color: #1E3A3D;
          background: rgba(255,255,255,0.95);
          box-shadow: 0 0 0 4px rgba(18,58,62,0.06);
        }

        .ega-input-icon {
          position: absolute; right: 14px; top: 50%;
          transform: translateY(-50%);
          color: rgba(18,58,62,0.35);
          cursor: pointer; display: flex; align-items: center;
          transition: color 0.2s;
          background: none; border: none; padding: 2px;
        }

        .ega-input-icon:hover { color: #1E3A3D; }

        .ega-forgot {
          display: block; text-align: right; margin-top: 8px;
          font-size: 12.5px; color: rgba(18,58,62,0.5);
          text-decoration: none; transition: color 0.2s;
        }
        .ega-forgot:hover { color: #1E3A3D; }

        .ega-btn {
          width: 100%; padding: 16px; margin-top: 8px;
          background: #1E3A3D; color: #F2E97E;
          border: none; border-radius: 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px; font-weight: 600;
          cursor: pointer; transition: all 0.2s ease;
          display: flex; align-items: center;
          justify-content: center; gap: 10px;
        }

        .ega-btn:hover:not(:disabled) {
          background: #152C2F;
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(18,48,52,0.25);
        }

        .ega-btn:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
        .ega-btn:disabled { cursor: not-allowed; opacity: 0.7; }

        .ega-spinner {
          width: 18px; height: 18px;
          border: 2px solid rgba(242,233,126,0.3);
          border-top-color: #F2E97E;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        .ega-error {
          margin-bottom: 16px;
          padding: 12px 16px;
          border-radius: 10px;
          border: 1px solid rgba(200,57,43,0.25);
          background: rgba(200,57,43,0.08);
          font-size: 13px;
          color: #C8392B;
          line-height: 1.5;
        }

        .ega-trust {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1px;
          background: rgba(18,58,62,0.08);
          border-radius: 20px;
          overflow: hidden;
          margin-bottom: 48px;
          animation: fadeUp 0.7s 0.22s cubic-bezier(.22,1,.36,1) both;
        }

        .ega-trust-item {
          background: rgba(255,255,255,0.32);
          padding: 24px 28px;
          display: flex; align-items: flex-start;
          gap: 16px;
          backdrop-filter: blur(8px);
          transition: background 0.2s;
        }

        .ega-trust-item:hover { background: rgba(255,255,255,0.48); }
        .ega-trust-icon { color: #1E3A3D; opacity: 0.7; flex-shrink: 0; margin-top: 2px; }
        .ega-trust-title { font-size: 14px; font-weight: 600; color: #1E3A3D; margin-bottom: 4px; }
        .ega-trust-desc { font-size: 12.5px; color: rgba(18,58,62,0.55); line-height: 1.5; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

        @media (max-width: 960px) {
          .ega-inner { grid-template-columns: 1fr; padding: 32px 24px; gap: 32px; align-items: start; }
          .ega-left { padding: 48px 0 0; }
          .ega-right { padding: 0; }
          .ega-trust { grid-column: 1; grid-template-columns: 1fr; }
          .ega-cards { flex-direction: column; }
          .ega-headline { font-size: 56px; }
        }
      `}</style>

      <div className="ega-root">
        <div className="ega-noise" aria-hidden />
        <div className="ega-inner">

          {/* LEFT */}
          <div className="ega-left">
            <div className="ega-badge">
              <div className="ega-badge-dot" />
              <span className="ega-badge-text">Root Domain Access</span>
            </div>
            <h1 className="ega-headline">
              Enter control
              <span className="ega-headline-accent">room.</span>
            </h1>
            <p className="ega-sub">
              Sign in once on root domain, then continue into dashboard, goals,
              tasks, timer, and review with shared-session flow.
            </p>
            <div className="ega-cards">
              {[
                { label: "DASHBOARD", desc: "Operational snapshot after successful sign in.", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
                { label: "TASKS", desc: "Execution boards and structured delivery.", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> },
                { label: "REVIEW", desc: "Reflection loops and operating cadence.", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> },
              ].map((f) => (
                <div key={f.label} className="ega-card">
                  <div className="ega-card-icon">{f.icon}</div>
                  <div className="ega-card-label">{f.label}</div>
                  <div className="ega-card-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — form */}
          <div className="ega-right">
            <div className="ega-form-card">
              <div className="ega-form-eyebrow">Login</div>
              <h2 className="ega-form-title">Sign in to continue</h2>
              <p className="ega-form-sub">
                Use your email and password to unlock the protected EGA House workspaces.
              </p>

              <form onSubmit={handleSubmit}>
                {error && <div className="ega-error">{error}</div>}

                <div className="ega-field">
                  <label className="ega-label" htmlFor="email">Email</label>
                  <div className="ega-input-wrap">
                    <input id="email" type="email" className="ega-input"
                      placeholder="you@egawilldoit.online"
                      value={email} onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email" required disabled={isPending} />
                    <span className="ega-input-icon" aria-hidden>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    </span>
                  </div>
                </div>

                <div className="ega-field">
                  <label className="ega-label" htmlFor="password">Password</label>
                  <div className="ega-input-wrap">
                    <input id="password" type={showPassword ? "text" : "password"}
                      className="ega-input" placeholder="Enter your password"
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password" required disabled={isPending} />
                    <button type="button" className="ega-input-icon"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}>
                      {showPassword
                        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                </div>

                <button type="submit" className="ega-btn" disabled={isPending}>
                  {isPending
                    ? <><span className="ega-spinner" />Signing in…</>
                    : <>Sign in <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></>
                  }
                </button>
              </form>
            </div>
          </div>

          {/* TRUST BAR */}
          <div className="ega-trust">
            {[
              { title: "Secure by default", desc: "Supabase auth with server-side session validation.", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
              { title: "Single sign-on", desc: "Session flows across all subdomains automatically.", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg> },
              { title: "Built for operators", desc: "The Plan → Execute → Reflect loop.", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> },
            ].map((t) => (
              <div key={t.title} className="ega-trust-item">
                <div className="ega-trust-icon">{t.icon}</div>
                <div>
                  <div className="ega-trust-title">{t.title}</div>
                  <div className="ega-trust-desc">{t.desc}</div>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}
