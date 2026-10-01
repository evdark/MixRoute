import clsx from "clsx";
import {
  Boxes,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Moon,
  Route,
  ScrollText,
  Server,
  Settings as SettingsIcon,
  Sun,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, setUnauthorizedHandler, storePassword } from "./api";
import { Badge, Button, Input } from "./components";
import { useT, type TranslationKey } from "./i18n";
import LogsPage from "./pages/Logs";
import ModelsPage from "./pages/Models";
import OverviewPage from "./pages/Overview";
import PlaygroundPage from "./pages/Playground";
import ProvidersPage from "./pages/Providers";
import SettingsPage from "./pages/Settings";

type PageId = "overview" | "models" | "providers" | "playground" | "logs" | "settings";
type Theme = "dark" | "light";

interface NavItem {
  id: PageId;
  labelKey: TranslationKey;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { id: "overview", labelKey: "nav.overview", icon: LayoutDashboard },
  { id: "models", labelKey: "nav.models", icon: Boxes },
  { id: "providers", labelKey: "nav.providers", icon: Server },
  { id: "playground", labelKey: "nav.playground", icon: FlaskConical },
  { id: "logs", labelKey: "nav.logs", icon: ScrollText },
  { id: "settings", labelKey: "nav.settings", icon: SettingsIcon },
];

function readTheme(): Theme {
  try {
    return localStorage.getItem("mixroute.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function BrandMark() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-emerald-600 text-white shadow-[0_2px_8px_-2px_rgb(25_195_125/0.6)]">
      <Route aria-hidden className="h-3.5 w-3.5" />
    </span>
  );
}

function Login({
  message,
  onSignedIn,
}: {
  message: TranslationKey | null;
  onSignedIn: () => void;
}) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(message);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password === "" || pending) return;

    setPending(true);
    setError(null);
    storePassword(password);

    try {
      // Validate the credentials before unlocking the console.
      await api("/admin/api/overview");
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Wrong password: clear it (api.ts already did) and stay here.
        setError("auth.wrongPassword");
      } else {
        // Backend unreachable or erroring — let the user in; pages show
        // their own errors, and any later 401 returns them to this screen.
        onSignedIn();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      {/* Ambient backdrop */}
      <div aria-hidden className="mesh-blob mesh-a -left-32 -top-32 h-96 w-96" />
      <div aria-hidden className="mesh-blob mesh-b -bottom-40 -right-24 h-96 w-96" />

      <div className="anim-pop relative w-full max-w-sm rounded-2xl border border-hairline bg-panel p-8 shadow-[0_24px_64px_-32px_rgb(0_0_0/0.6)]">
        <div className="flex justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-emerald-600 text-white shadow-[0_8px_24px_-8px_rgb(25_195_125/0.7)]">
            <Route aria-hidden className="h-5 w-5" />
          </span>
        </div>
        <h1 className="mt-4 text-center text-lg font-semibold tracking-tight text-ink">MixRoute</h1>
        <p className="mt-1 text-center text-sm text-ink-2">{t("auth.subtitle")}</p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-2">
              {t("auth.password")}
            </span>
            <Input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            pending={pending}
            disabled={password === ""}
          >
            {t("auth.signIn")}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const { t, lang, setLang } = useT();
  const [authed, setAuthed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("mixroute.password") !== null;
    } catch {
      return false;
    }
  });
  const [authMessage, setAuthMessage] = useState<TranslationKey | null>(null);
  const [page, setPage] = useState<PageId>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);

  // Any 401 from the API drops us back on the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthed(false);
      setAuthMessage("auth.rejected");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("mixroute.theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const handleSignedIn = useCallback(() => {
    setAuthMessage(null);
    setAuthed(true);
  }, []);

  if (!authed) {
    return <Login message={authMessage} onSignedIn={handleSignedIn} />;
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-bg/85 px-4 backdrop-blur-lg lg:hidden">
        <button
          type="button"
          aria-label={t("a11y.openNav")}
          onClick={() => setSidebarOpen(true)}
          className="rounded-md p-1.5 text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink"
        >
          <Menu aria-hidden className="h-5 w-5" />
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <BrandMark />
          MixRoute
        </span>
      </header>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-hairline bg-panel transition-transform duration-300 ease-out lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <span className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
            <BrandMark />
            MixRoute
          </span>
          <button
            type="button"
            aria-label={t("a11y.closeNav")}
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-panel-2 hover:text-ink lg:hidden"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setPage(item.id);
                  setSidebarOpen(false);
                }}
                className={clsx(
                  "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all duration-150",
                  active
                    ? "bg-panel-2 font-medium text-ink ring-1 ring-hairline"
                    : "text-ink-2 hover:bg-panel-2/60 hover:text-ink",
                )}
              >
                {active && (
                  <span className="absolute -left-3 h-4 w-0.5 rounded-r-full bg-accent" />
                )}
                <Icon
                  aria-hidden
                  className={clsx(
                    "h-4 w-4 shrink-0 transition-colors",
                    active ? "text-accent" : "text-ink-3 group-hover:text-ink-2",
                  )}
                />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-3">
          <Badge tone="default">{t("auth.admin")}</Badge>
          <div
            role="group"
            aria-label={t("a11y.language")}
            className="inline-flex shrink-0 rounded-md border border-hairline p-0.5"
          >
            {(["ru", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={lang === code}
                onClick={() => setLang(code)}
                className={clsx(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase transition-colors",
                  lang === code
                    ? "bg-panel-2 text-ink ring-1 ring-hairline"
                    : "text-ink-3 hover:text-ink",
                )}
              >
                {code}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            aria-label={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
            title={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? (
              <Sun aria-hidden className="h-4 w-4" />
            ) : (
              <Moon aria-hidden className="h-4 w-4" />
            )}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="lg:pl-[232px]">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Re-mounts the page on navigation so entrance animations replay. */}
          <div key={page} className="anim-fade">
            {page === "overview" && <OverviewPage onNavigate={setPage} />}
            {page === "models" && <ModelsPage />}
            {page === "providers" && <ProvidersPage />}
            {page === "playground" && <PlaygroundPage />}
            {page === "logs" && <LogsPage />}
            {page === "settings" && <SettingsPage />}
          </div>
        </div>
      </main>
    </div>
  );
}
