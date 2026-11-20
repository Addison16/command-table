import { useEffect, useMemo, useState } from 'react';
import { notify, report, repository, useApp } from '../app/store.js';
import { ask, downloadText, Field, Icon, Sheet } from '../components/ui.js';
import { recapDuration } from './gameRecap.js';
import { summarize, winRate, type StatRecord, type Tally } from './stats.js';
import '../styles/extras.css';

function Table({ label, rows }: { label: string; rows: Tally[] }) {
  return (
    <table className="stats-table">
      <thead>
        <tr>
          <th scope="col">{label}</th>
          <th scope="col">Games</th>
          <th scope="col">Wins</th>
          <th scope="col">Win rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name.toLowerCase()}>
            <td>{row.name}</td>
            <td>{row.games}</td>
            <td>{row.wins}</td>
            <td>{winRate(row)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const outcome = (record: StatRecord) => {
  const winners = record.players.filter((player) => player.winner).map((player) => player.name);
  return record.draw ? 'Draw' : winners.length ? `${winners.join(' & ')} won` : 'No winner recorded';
};

/** Every finished game this browser has seen, and who tends to win them. */
export function StatsSheet({ onClose }: { onClose: () => void }) {
  const version = useApp((s) => s.statsVersion);
  const [records, setRecords] = useState<StatRecord[] | null>(null);
  useEffect(() => {
    let current = true;
    void repository
      .stats()
      .then((stored) => {
        if (current) setRecords(stored);
      })
      .catch(report);
    return () => {
      current = false;
    };
  }, [version]);
  const summary = useMemo(() => summarize(records ?? []), [records]);
  const change = (update: Parameters<typeof repository.updateStats>[0]) =>
    void repository
      .updateStats(update)
      .then(() => useApp.setState((s) => ({ statsVersion: s.statsVersion + 1 })))
      .catch(report);
  const setWinner = (record: StatRecord, value: string) => {
    const next: StatRecord = {
      ...record,
      players: record.players.map((player, index) => ({ ...player, winner: value === String(index) })),
    };
    if (value === 'draw') next.draw = true;
    else delete next.draw;
    change({ record: next });
  };
  return (
    <Sheet
      title="Playgroup stats"
      description="Finished games are counted in this browser. Nothing is sent anywhere."
      onClose={onClose}
    >
      {records === null ? (
        <p role="status">Counting your games…</p>
      ) : !records.length ? (
        <div className="empty-state">
          <Icon name="crown" size={36} />
          <p>No finished games yet.</p>
          <span>
            End a game, or start a rematch, and it is counted here. Use “Record winner” in the game menu when
            someone wins another way.
          </span>
        </div>
      ) : (
        <>
          <div className="stat-tiles" role="group" aria-label="Totals">
            <div>
              <strong data-testid="stats-games">{summary.games}</strong>
              <span>{summary.games === 1 ? 'Game played' : 'Games played'}</span>
            </div>
            <div>
              <strong>{summary.decided}</strong>
              <span>With a result</span>
            </div>
            <div>
              <strong>{recapDuration(summary.averageMs)}</strong>
              <span>Average length</span>
            </div>
          </div>
          <section className="detail-section">
            <h3>
              <Icon name="people" />
              Players
            </h3>
            <Table label="Player" rows={summary.players} />
            <p className="hint">Players are matched by name, so keep names the same from game to game.</p>
          </section>
          {summary.commanders.length > 0 && (
            <section className="detail-section">
              <h3>
                <Icon name="crown" />
                Commanders
              </h3>
              <Table label="Commander" rows={summary.commanders} />
            </section>
          )}
          <details>
            <summary>
              Recorded games <span>{records.length}</span>
            </summary>
            <p className="hint">
              Fix a result that was recorded wrong, or remove a game that should not count.
            </p>
            {records.map((record) => (
              <div className="stat-record" key={record.id}>
                <strong>
                  {new Date(record.endedAt).toLocaleDateString()} · {record.preset} · {outcome(record)}
                </strong>
                <small>
                  {record.players.map((player) => player.name).join(', ')} ·{' '}
                  {recapDuration(record.durationMs)}
                </small>
                <div className="stat-record-actions">
                  <Field label="Result">
                    <select
                      aria-label={`Result of the ${new Date(record.endedAt).toLocaleDateString()} game`}
                      value={
                        record.draw
                          ? 'draw'
                          : record.players.filter((player) => player.winner).length === 1
                            ? String(record.players.findIndex((player) => player.winner))
                            : record.players.some((player) => player.winner)
                              ? 'team'
                              : ''
                      }
                      onChange={(event) => {
                        if (event.target.value !== 'team') setWinner(record, event.target.value);
                      }}
                    >
                      <option value="">No winner recorded</option>
                      <option value="draw">Draw</option>
                      {record.players.filter((player) => player.winner).length > 1 && (
                        <option value="team">
                          {record.players
                            .filter((player) => player.winner)
                            .map((player) => player.name)
                            .join(' & ')}{' '}
                          won
                        </option>
                      )}
                      {record.players.map((player, index) => (
                        <option key={index} value={index}>
                          {player.name} won
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    aria-label={`Remove the ${new Date(record.endedAt).toLocaleDateString()} game from stats`}
                    onClick={async () => {
                      if (
                        await ask(
                          'Remove this game from your stats?',
                          'Only the stats entry is removed. Saved games and backups are not touched.',
                        )
                      )
                        change({ remove: record.id });
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </div>
            ))}
          </details>
          <button
            className="secondary full"
            onClick={() => {
              downloadText(JSON.stringify(records, null, 2), 'command-table-stats.json');
              notify('Stats exported');
            }}
          >
            <Icon name="download" />
            Export stats
          </button>
          <button
            className="text-button full"
            onClick={async () => {
              if (
                await ask(
                  'Clear all stats?',
                  'Every counted game is forgotten on this browser. Export first to keep a copy.',
                )
              )
                change({ clear: true });
            }}
          >
            Clear all stats
          </button>
        </>
      )}
    </Sheet>
  );
}
