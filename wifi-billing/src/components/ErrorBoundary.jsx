import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error, errorInfo) {
    // Catch errors in any components below and re-render with error message
    this.setState({ error, errorInfo });
    // Optionally log error to a service
    console.error("Error caught by ErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      // Render fallback UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Something went wrong.</h2>
            <p className="mb-4">{this.state.error?.message || "An unexpected error occurred."}</p>
            <p className="mb-4">Please try refreshing the page or contact support.</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-500 text-white py-2 px-4 rounded-full hover:bg-blue-600"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;