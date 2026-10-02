import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useApp, updateProfile, notify, report } from '../app/store.js';
import { ask, Field, Sheet, Toggle } from '../components/ui.js';
import { TableLayoutOptions } from './TableLayout.js';
import { playCue, stopSounds } from '../components/feedback.js';
import { useAppearance } from './appearance.js';
import { AppearanceOptions } from './AppearanceOptions.js';
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
export function Settings({ onClose }: { onClose: () => void }) {
  const profile = useApp((s) => s.profile);
  const [full, setFull] = useState(!!document.fullscreenElement);
  return (
    <Sheet
      title="Your table, your way"
      description="Display preferences are remembered on this browser."
      onClose={onClose}
    >
      <AppearanceOptions />
      <section className="detail-section">
        <h3>Table layout</h3>
        <TableLayoutOptions />
      </section>
      <Field label="Effects">
        <select
          value={profile.effects}
          onChange={(e) => void updateProfile({ effects: e.target.value as typeof profile.effects })}
        >
          <option value="full">Full · a little atmosphere</option>
          <option value="reduced">Reduced · quiet & quick</option>
          <option value="off">Off · just the essentials</option>
        </select>
      </Field>
      <p className="hint">Your system’s reduced-motion preference always takes priority.</p>
      <Toggle
        checked={profile.audio}
        onChange={(audio) => {
          void updateProfile({ audio });
          if (audio) playCue('roll');
          else stopSounds();
        }}
      >
        Sound effects
      </Toggle>
      {profile.audio && (
        <>
          <button className="secondary full" onClick={() => playCue('roll')}>
            Test dice sound
          </button>
          <p className="hint">
            Use your phone’s media volume. If it is still quiet, check silent mode and your audio output.
          </p>
        </>
      )}
      <Toggle
        checked={profile.haptics}
        onChange={(haptics) => {
          void updateProfile({ haptics });
          if (haptics && !navigator.vibrate) notify('Vibration is not supported in this browser.');
        }}
      >
        Haptic feedback
      </Toggle>
      <Toggle checked={profile.wake} onChange={(wake) => void updateProfile({ wake })}>
        Keep the screen awake
      </Toggle>
      <p className="hint">
        Optional on supported HTTPS browsers. Battery settings may release the wake lock. The board shows when
        it is active.
      </p>
      <button
        className="secondary full"
        disabled={!document.fullscreenEnabled}
        onClick={async () => {
          try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await document.documentElement.requestFullscreen();
            setFull(!!document.fullscreenElement);
          } catch (e) {
            report(e);
          }
        }}
      >
        {full
          ? 'Exit fullscreen'
          : document.fullscreenEnabled
            ? 'Enter fullscreen'
            : 'Fullscreen unavailable in this browser'}
      </button>
      <section className="detail-section">
        <h3>Make a place on your home screen</h3>
        <p>
          On iPhone Safari, open Share, then choose <strong>Add to Home Screen</strong>. On Android Chrome,
          open the browser menu and choose <strong>Add to Home screen</strong> or <strong>Install app</strong>
          .
        </p>
        <p className="hint">
          Installation is optional. Offline reopening and installation need HTTPS, or localhost. Installed
          apps and browser tabs may keep separate saved data.
        </p>
      </section>
      <section className="detail-section">
        <h3>Remembered in this browser</h3>
        <p>
          Games and preferences are remembered in this browser. Export a backup before clearing site data or
          changing browsers.
        </p>
        <p className="hint">
          A different browser, private session, or site address can start fresh. No account or device
          fingerprint is used.
        </p>
      </section>
      <p className="hint">
        Command Table is unofficial Fan Content permitted under the{' '}
        <a href="https://company.wizards.com/fancontentpolicy" target="_blank" rel="noreferrer">
          Fan Content Policy
        </a>
        . Not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the
        Coast. © Wizards of the Coast. Optional commander artwork is provided by{' '}
        <a href="https://scryfall.com" target="_blank" rel="noreferrer">
          Scryfall
        </a>
        ; artist credits appear in player details.
      </p>
    </Sheet>
  );
}
