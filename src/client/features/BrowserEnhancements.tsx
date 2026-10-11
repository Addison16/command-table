import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useApp, notify } from '../app/store.js';
import { ask } from '../components/ui.js';
import { useAppearance } from './appearance.js';

export function PwaUpdates() {
  const {
    needRefresh: [update],
    updateServiceWorker,
  } = useRegisterSW();
  const pending = useApp((s) => s.pending);
  return update ? (
    <div className="update-notice">
      Update available{' '}
      <button
        disabled={pending > 0}
        onClick={async () => {
          if (await ask('Apply update?', 'Your committed game is saved. This will reload the app.'))
            void updateServiceWorker(true);
        }}
      >
        Save & update
      </button>
    </div>
  ) : null;
}
export function Enhancements() {
  const profile = useApp((s) => s.profile);
  useAppearance(profile);
  useEffect(() => {
    document.documentElement.dataset.effects = profile.effects;
    const hidden = () => {
      document.documentElement.dataset.hidden = String(document.hidden);
    };
    document.addEventListener('visibilitychange', hidden);
    hidden();
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [profile.effects]);
  useEffect(() => {
    if (!profile.wake) {
      document.documentElement.dataset.wake = 'off';
      return;
    }
    let lock: WakeLockSentinel | undefined,
      stopped = false;
    const acquire = async () => {
      if (document.hidden || stopped) return;
      if (!('wakeLock' in navigator)) {
        notify('Keep-awake is unavailable in this browser. Core play still works.');
        return;
      }
      try {
        lock = await navigator.wakeLock.request('screen');
        if (stopped) {
          void lock.release();
          return;
        }
        document.documentElement.dataset.wake = 'active';
        lock.addEventListener('release', () => {
          document.documentElement.dataset.wake = 'off';
        });
      } catch {
        notify('Keep-awake is unavailable here. Check battery settings or use HTTPS.');
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
      document.documentElement.dataset.wake = 'off';
    };
  }, [profile.wake]);
  return null;
}
