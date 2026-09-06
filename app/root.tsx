import {
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import { InterruptedBanner } from "~/components/state";
import { readInterruption } from "~/lib/processing.server";
import type { Route } from "./+types/root";
import "@scope-creep/design/tokens.css";
import "./app.css";

/**
 * App-wide processing state (work-011): the one global interruption fact, read on every
 * navigation so the banner + greyed-out shell are present on any page while the backend is
 * blocked, and gone the instant it resumes.
 */
export async function loader(_: Route.LoaderArgs) {
  return { interruption: await readInterruption() };
}

function TopNav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? "topnav__link topnav__link--active" : "topnav__link";
  return (
    <nav className="topnav">
      <NavLink to="/" end className={linkClass}>
        Console
      </NavLink>
      <NavLink to="/explore" className={linkClass}>
        Explore
      </NavLink>
      <NavLink to="/work" className={linkClass}>
        Work
      </NavLink>
      <NavLink to="/threads" className={linkClass}>
        Threads
      </NavLink>
      <NavLink to="/settings" className={linkClass}>
        Settings
      </NavLink>
    </nav>
  );
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  // Available on every navigation; undefined while the root loader hasn't run (e.g. the
  // error path), so read defensively.
  const data = useRouteLoaderData<typeof loader>("root");
  const interruption = data?.interruption ?? null;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <TopNav />
        {interruption ? <InterruptedBanner interruption={interruption} /> : null}
        {/* While blocked, the working surface is dimmed and made inert — submitting into a
            paused backend would only fail — but the top nav stays live so the Owner can
            still read and move around. */}
        <div
          className="app-shell"
          data-interrupted={interruption ? "" : undefined}
          inert={!!interruption}
        >
          {children}
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Something went wrong</p>
          <h1 className="console__title">{message}</h1>
        </div>
      </header>
      <p className="console__notice">{details}</p>
      {stack && (
        <pre className="error__stack">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
