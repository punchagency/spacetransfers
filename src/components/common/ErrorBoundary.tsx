import { reportError } from "../../lib/monitoring";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * Keeps one broken page from blanking the whole app.
 *
 * Without a boundary, an error while rendering unmounts everything and leaves a
 * white screen. The app as a whole and each page are fenced separately: a page
 * that fails shows a message in its place, and moving to another page (the
 * boundary resets on navigation) or pressing Try again recovers.
 */
interface Props {
  children: ReactNode;
  /** Clears the error when this changes — the current path, for pages. */
  resetKey?: unknown;
  /** Fill the screen — for the boundary around the whole app. */
  fullPage?: boolean;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, { componentStack: errorInfo.componentStack, boundary: (this.props as any).name });
    console.error("[ErrorBoundary] page crashed:", error, errorInfo);
  }

  public componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) this.setState({ hasError: false });
  }

  public render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center p-6 text-center ${this.props.fullPage ? "min-h-screen bg-white" : "min-h-[240px]"}`}
      >
        <h2 className="mb-2 text-lg font-bold text-gray-900">Something went wrong</h2>
        <p className="mb-4 max-w-md text-sm text-gray-600">
          This page ran into a problem. Try again, open another page, or reload if it keeps happening.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => this.setState({ hasError: false })}
            className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

/** A page's boundary, cleared whenever the route changes. */
export function PageBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
