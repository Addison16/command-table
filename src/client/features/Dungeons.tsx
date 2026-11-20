import { useState } from 'react';
import { act, canEdit, useApp } from '../app/store.js';
import { ask, Field, Icon, Sheet } from '../components/ui.js';
import { dungeon, dungeons, type DungeonId } from '../../shared/dungeons.js';
import '../styles/extras.css';

/** Venture into the dungeon: each player's marker, room by room. Players move their own. */
export function Dungeons({ onClose }: { onClose: () => void }) {
  const game = useApp((s) => s.game)!,
    pending = useApp((s) => s.pending),
    seatId = useApp((s) => s.room?.me.seatId);
  const [chosen, setChosen] = useState(() => seatId ?? game.turn.playerId ?? game.order[0]);
  const playerId = game.players[chosen] ? chosen : game.order[0];
  const player = game.players[playerId];
  const editable = canEdit(playerId) && game.status === 'active' && pending === 0;
  const current = dungeon(player.dungeon?.id);
  const room = current && player.dungeon ? current.rooms[player.dungeon.room] : undefined;
  const venture = (change: { dungeon?: DungeonId; room?: number } = {}) =>
    void act({ type: 'venture', playerId, ...change });
  const elsewhere = game.order.filter((id) => id !== playerId && game.players[id].dungeon);
  return (
    <Sheet
      title="Dungeons"
      description="Venture into the dungeon and keep each player’s place, room by room."
      onClose={onClose}
    >
      <Field label="Player">
        <select value={playerId} onChange={(event) => setChosen(event.target.value)}>
          {game.order.map((id) => (
            <option key={id} value={id}>
              {game.players[id].name}
            </option>
          ))}
        </select>
      </Field>
      <p className="hint" data-testid="dungeons-completed">
        {player.dungeonsCompleted
          ? `${player.name} has completed ${player.dungeonsCompleted} ${player.dungeonsCompleted === 1 ? 'dungeon' : 'dungeons'} this game.`
          : `${player.name} has not completed a dungeon this game.`}
      </p>
      {current && room ? (
        <>
          <section className="dungeon" aria-label={current.name}>
            <h3>{current.name}</h3>
            <ol>
              {current.rooms.map((entry, index) => (
                <li
                  key={entry.name}
                  className={
                    index === player.dungeon!.room ? 'here' : room.next.includes(index) ? 'next' : ''
                  }
                  aria-current={index === player.dungeon!.room ? 'step' : undefined}
                >
                  <strong>{entry.name}</strong>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ol>
          </section>
          <div className="dungeon-actions" role="group" aria-label="Venture">
            {room.next.length ? (
              room.next.map((index) => (
                <button
                  key={index}
                  className="primary"
                  disabled={!editable}
                  onClick={() => venture({ room: index })}
                >
                  <Icon name="arrow" />
                  {current.rooms[index].name}
                </button>
              ))
            ) : (
              <button className="primary" disabled={!editable} onClick={() => venture()}>
                <Icon name="check" />
                Complete {current.name}
              </button>
            )}
          </div>
          <button
            className="text-button full"
            disabled={!editable}
            onClick={async () => {
              if (await ask('Leave this dungeon?', 'The marker is removed without completing the dungeon.'))
                void act({ type: 'leaveDungeon', playerId });
            }}
          >
            Leave without completing
          </button>
        </>
      ) : (
        <section className="detail-section first">
          <h3>Enter a dungeon</h3>
          <div className="dungeon-choices">
            {dungeons.map((entry) => (
              <button
                key={entry.id}
                className="secondary"
                disabled={!editable}
                onClick={() => venture({ dungeon: entry.id })}
              >
                <strong>{entry.name}</strong>
                <small>
                  {entry.id === 'undercity'
                    ? 'Only when you take the initiative'
                    : `${entry.rooms.length} rooms · starts at ${entry.rooms[0].name}`}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
      {!canEdit(playerId) && game.status === 'active' && (
        <p className="hint">Each player moves their own dungeon marker.</p>
      )}
      {elsewhere.length > 0 && (
        <section className="detail-section">
          <h3>
            <Icon name="people" />
            Around the table
          </h3>
          <ul className="dungeon-others">
            {elsewhere.map((id) => {
              const other = game.players[id];
              const where = dungeon(other.dungeon!.id)!;
              return (
                <li key={id}>
                  <button onClick={() => setChosen(id)}>
                    <strong>{other.name}</strong>
                    <span>
                      {where.name} · {where.rooms[other.dungeon!.room]?.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <button className="secondary full" onClick={onClose}>
        Back to game
      </button>
    </Sheet>
  );
}
