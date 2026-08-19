import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex min-h-[400px] flex-col items-center justify-center p-6 text-center">
            <h2 className="mb-2 text-xl font-bold text-gray-900">Something went wrong</h2>
            <p className="mb-4 text-gray-600">
              We encountered an error while processing your request. Please try again or refresh the page.
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
