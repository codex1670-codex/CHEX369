import { Component } from 'react';

// Keeps one crashing screen (or game) from blanking the whole app.
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[chex] UI error:', error, info?.componentStack); }
  reset = () => { this.setState({ error: null }); this.props.onReset?.(); };
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);
    return (
      <div className="empty-state" role="alert" style={{ padding: 32 }}>
        <div className="glyph">😵</div>
        <div style={{ fontSize: 15, color: 'var(--text-hi)', marginBottom: 6 }}>{this.props.title || 'Something went wrong here.'}</div>
        <div style={{ fontSize: 13, marginBottom: 14 }}>The rest of the app is fine.</div>
        <button type="button" className="btn-ghost" onClick={this.reset}>Try again</button>
        {this.props.full && <button type="button" className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => window.location.reload()}>Reload app</button>}
      </div>
    );
  }
}
