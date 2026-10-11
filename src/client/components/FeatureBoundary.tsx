import { Component, type ReactNode } from 'react';
import { useApp } from '../app/store.js';
import { Sheet } from './ui.js';

function Unavailable({ onClose }: { onClose: () => void }) {
  const pending = useApp((s) => s.pending);
  return (
    <Sheet title="Unable to open this tool" onClose={onClose}>
      <p>Your saved game is still here. Reconnect and reload to try again.</p>
      <button className="primary full" disabled={pending > 0} onClick={() => location.reload()}>
        Reload app
      </button>
      {pending > 0 && <p className="hint">Waiting for your submitted changes to be saved.</p>}
    </Sheet>
  );
}

export class FeatureBoundary extends Component<
  { children: ReactNode; onClose: () => void; dismissOnError?: boolean },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    if (this.props.dismissOnError) this.props.onClose();
  }
  render() {
    return this.state.failed ? (
      this.props.dismissOnError ? null : (
        <Unavailable onClose={this.props.onClose} />
      )
    ) : (
      this.props.children
    );
  }
}
