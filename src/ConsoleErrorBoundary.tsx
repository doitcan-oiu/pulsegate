import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui";

export default class ConsoleErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Console page failed", error, info.componentStack); }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="console-page-error" role="alert">
      <span className="console-empty-icon"><AlertTriangle size={26} /></span>
      <h2>这个页面暂时无法显示</h2>
      <p>请尝试重新加载页面，或从导航中打开其他模块。</p>
      <Button variant="primary" onClick={() => window.location.reload()}><RefreshCw size={16} />重新加载</Button>
    </div>;
  }
}
