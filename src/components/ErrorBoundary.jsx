import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-terracotta/5 border border-terracotta/20 rounded-2xl text-ink max-w-lg mx-auto my-8">
          <div className="flex items-center gap-3 text-terracotta mb-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <h2 className="text-base font-bold">This screen encountered an unexpected error</h2>
          </div>
          <p className="text-xs text-ink/70 leading-relaxed mb-5">
            The error details have been logged to the developer console. You can try reloading this screen or restarting the application.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white text-xs font-bold rounded-xl hover:bg-emerald transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Screen</span>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-ink/15 text-ink text-xs font-bold rounded-xl hover:bg-slate-50 transition-all"
            >
              <span>Reload App</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
