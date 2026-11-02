import { reportError } from "../../lib/monitoring";
import { Component, ErrorInfo, ReactNode } from "react";
import toast from "react-hot-toast";

/**
 * Keeps one broken part of the page from taking the rest down with it.
 *
 * Without a boundary, an error while rendering unmounts the whole React tree:
 * the customer is left with a blank page and, as a guest, loses the board. So
 * the store is fenced into parts — the app as a whole, the header, the design
 * area, the sidebar, and each dialog — and a failure stays inside its part.
 *
 * Two shapes:
 *  - A region (`name` only): shows a small message in its place, with Try again
 *    (re-render) and Reload (for errors that would just happen again).
 *  - A dialog (`onDismiss`): closes the dialog and says so in a toast, so the
 *    board underneath is untouched. `resetKey` — the dialog's open flag — lets
 *    it open again afterwards.
 */
interface Props {
  children: ReactNode;
  /** Replaces the built-in message entirely. */
  fallback?: ReactNode;
  /** What broke, in the customer's words: "The design area". */
  name?: string;
  /** For dialogs: close it instead of showing a message in its place. */
  onDismiss?: () => void;
  /** Clears the error when this changes (e.g. the dialog was closed). */
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
    console.error(`[ErrorBoundary] ${this.props.name ?? "part of the page"} crashed:`, error, errorInfo);
    if (this.props.onDismiss) {
      toast.error(`${this.props.name ?? "That window"} ran into a problem and was closed. Please try again.`, {
        id: `boundary-${this.props.name ?? "dialog"}`,
      });
      this.props.onDismiss();
    }
  }

  public componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private reset = () => this.setState({ hasError: false });

  public render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    // A dismissed dialog renders nothing until it is opened again.
    if (this.props.onDismiss) return null;

    const what = this.props.name ?? "This part of the page";
    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center p-6 text-center ${
          this.props.fullPage ? "min-h-screen bg-white" : "min-h-[200px]"
        }`}
      >
        <h2 className="mb-2 text-lg font-bold text-gray-900">Something went wrong</h2>
        <p className="mb-4 max-w-md text-sm text-gray-600">
          {what} ran into a problem. Sheets you've saved are safe. Try again, or reload the page if it keeps happening.
        </p>
        <div className="flex gap-2">
          <button
            onClick={this.reset}
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
