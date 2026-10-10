import { useEffect, useMemo, useState } from 'react';
import type { Game } from '../../shared/schema.js';
import { Field, Icon, Sheet } from '../components/ui.js';
import { createRecap, renderRecap, type Recap } from './gameRecap.js';
import '../styles/game-recap.css';

type ImageAsset = { file: File; url: string; recap: Recap };

function canShare(file: File) {
  try {
    return !!navigator.share && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

export function GameRecapSheet({
  game,
  capturedAt,
  onClose,
}: {
  game: Game;
  capturedAt?: number;
  onClose: () => void;
}) {
  const [at] = useState(() => capturedAt ?? Date.now());
  const [result, setResult] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [asset, setAsset] = useState<ImageAsset | null>(null);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const recap = useMemo(() => createRecap(game, at, result), [game, at, result]);
  const ready = asset?.recap === recap ? asset : null;
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    setError('');
    void renderRecap(recap)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setAsset({
          file: new File([blob], `command-table-recap-${game.id.slice(0, 8)}.png`, { type: 'image/png' }),
          url,
          recap,
        });
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'The recap could not be created. Try again.');
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [recap, game.id, attempt]);

  const share = async () => {
    if (!ready || sharing) return;
    setSharing(true);
    setError('');
    try {
      // The PNG already exists before this click so mobile browsers keep their
      // required user activation when the native share sheet opens.
      await navigator.share({ title: 'Command Table · Game recap', files: [ready.file] });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError'))
        setError(
          'Sharing did not complete. You can download the image and share it from your photos or files.',
        );
    } finally {
      setSharing(false);
    }
  };

  const download = () => {
    if (!ready) return;
    // Give the download its own URL lifetime so closing the sheet does not
    // revoke a pending browser download (especially on mobile Safari).
    const url = URL.createObjectURL(ready.file);
    const link = document.createElement('a');
    link.href = url;
    link.download = ready.file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <Sheet
      title="Game recap"
      description={
        recap.final
          ? 'Your final table, ready to share. Choosing a winner only changes this image.'
          : 'A snapshot of your table right now. End the game for a final recap and optional winner.'
      }
      onClose={onClose}
    >
      {recap.final && (
        <Field label="Game result" hint="Optional. Choose a winner or draw for this recap.">
          <select
            aria-label="Game result"
            value={result}
            onChange={(event) => setResult(event.target.value)}
            disabled={sharing}
          >
            <option value="">Leave result off</option>
            <option value="draw">Draw</option>
            {game.archenemy && <option value="team">The team wins</option>}
            {recap.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
                {player.archenemy ? ' (archenemy)' : ''} wins
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="recap-preview" aria-busy={!ready && !error}>
        {ready ? (
          <img
            src={ready.url}
            alt={`${recap.final ? 'Final game' : 'In-progress game'} recap for ${recap.players.length} players. A text version is available below.`}
          />
        ) : (
          <p role="status">{error ? 'Preview unavailable' : 'Creating your recap…'}</p>
        )}
      </div>
      {error && (
        <div className="recap-error" role="alert">
          <p>{error}</p>
          {!ready && (
            <button className="secondary" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          )}
        </div>
      )}
      <div className="recap-actions">
        {ready && canShare(ready.file) && (
          <button className="primary" disabled={sharing} onClick={() => void share()}>
            <Icon name="link" /> {sharing ? 'Sharing…' : 'Share image'}
          </button>
        )}
        <button
          className={ready && canShare(ready.file) ? 'secondary' : 'primary'}
          disabled={!ready || sharing}
          onClick={download}
        >
          <Icon name="download" /> Download PNG
        </button>
      </div>
      <details className="recap-text">
        <summary>Text version</summary>
        <p>
          {recap.preset} · {recap.final ? 'Final' : 'In progress'} · {recap.duration}
          {recap.result ? ` · ${recap.result}` : ''}
        </p>
        <ul>
          {recap.players.map((player) => (
            <li key={player.id}>
              <strong>{player.name}</strong> · {player.life} life
              {player.winner ? ' · Winner' : player.eliminated ? ' · Eliminated' : ''}
              {player.commanders.length > 0 && <span>{player.commanders.join(' / ')}</span>}
            </li>
          ))}
        </ul>
      </details>
    </Sheet>
  );
}
