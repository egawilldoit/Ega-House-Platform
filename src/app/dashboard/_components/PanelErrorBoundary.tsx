"use client";

import { Component, type ReactNode } from "react";

interface PanelErrorBoundaryProps {
  children: ReactNode;
  panelName: string;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
}

export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[Dashboard panel error: ${this.props.panelName}]`, error);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="ega-glass rounded-xl p-4 border border-[var(--signal-error)]/20">
          <p className="text-[var(--signal-error)] text-sm">{this.props.panelName} failed to load.</p>
          <button
            type="button"
            className="mt-2 text-xs underline text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
            onClick={this.handleRetry}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
