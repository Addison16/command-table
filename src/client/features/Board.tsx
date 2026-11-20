import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useApp, act, updateProfile } from '../app/store.js';
import { Icon, Sigil } from '../components/ui.js';
import { HoldButton } from '../components/HoldButton.js';
import { facesAcross } from './TableLayout.js';
import { useTableLayout } from './useTableLayout.js';
import { CommanderBackdrop } from '../components/CommanderArtwork.js';
import type { CommanderCard } from '../../shared/cards.js';
import { playerStatuses, type PlayerStatus } from './playerStatuses.js';
import { sharesTurn, teamIndex, teamName } from '../../shared/game.js';
import '../styles/extras.css';
import '../styles/player-statuses.css';
import '../styles/archenemy.css';

const clock = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : minutes}:${String(seconds % 60).padStart(2, '0')}`;
};
/** How long the current turn has run. It stops with the game timer and when the game ends. */
function TurnClock() {
  const startedAt = useApp((s) => s.game?.turn.startedAt);
  const pausedAt = useApp((s) => s.game?.timer.pausedAt ?? null);
  const offset = useApp((s) => (s.mode === 'room' ? s.clockOffset : 0));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === undefined || pausedAt !== null) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt, pausedAt]);
  if (startedAt === undefined) return null;
  const elapsed = (pausedAt ?? now + offset) - startedAt;
  return (
    <time className="turn-clock" data-testid="turn-clock" aria-label={`Turn time ${clock(elapsed)}`}>
      {' · '}
      {clock(elapsed)}
    </time>
  );
}
const PlayerTile = memo(function PlayerTile({
  id,
  index,
  openPlayer,
  openCommander,
  openSchemes,
  myView,
  autoFlipped = false,
  automatic = false,
  span,
}: {
  id: string;
  index: number;
  openPlayer: (id: string) => void;
  openCommander: (playerId: string, commanderId?: string) => void;
  openSchemes: () => void;
  myView: boolean;
  autoFlipped?: boolean;
  automatic?: boolean;
  span?: number;
}) {
  // Snapshots are immutable. Select the visible primitives so changing another
  // seat does not rerender this panel or interrupt its input feedback.
  const player = useApp(
    useShallow((s) => {
      const game = s.game,
        seat = game?.players[id];
      if (!game || !seat) return null;
      const member = s.room?.members.find((m) => m.seatId === id && m.status === 'approved');
      const editable =
        !s.readOnly &&
        (s.mode === 'local' || (s.connected && s.room?.me.status === 'approved' && s.room.me.seatId === id));
      return {
        name: seat.name,
        color: seat.color,
        life: seat.life,
        eliminated: seat.eliminated,
        flipped: automatic ? autoFlipped : (s.profile.rotations[id] ?? autoFlipped),
        disabled: !editable || seat.eliminated || game.status === 'ended',
        flags: seat.life <= 0 ? 'Life ≤ 0' : '',
        statuses: JSON.stringify(playerStatuses(game, id)),
        monarch: game.markers.monarch === id,
        initiative: game.markers.initiative === id,
        role: game.archenemy ? (game.archenemy.playerId === id ? 'archenemy' : 'team') : null,
        // The team shares one turn in Archenemy, so every team seat shows it.
        turn: game.settings.turnTracking && sharesTurn(game, id) ? game.turn.number : 0,
        team: game.teams ? teamIndex(game, id) : -1,
        // A photo chosen on this device wins over shared card art.
        photo: s.playmats[seat.name.trim().toLowerCase()] ?? '',
        playmat: seat.playmat ? JSON.stringify(seat.playmat) : '',
        presence: member ? Boolean(member.connected) : null,
        artwork: JSON.stringify(
          Object.values(game.commanders)
            .filter((c) => c.ownerId === id && c.card)
            .map((c) => c.card),
        ),
      };
    }),
  );
  const artwork = player?.artwork ?? '[]';
  const playmat = player?.playmat ?? '';
  // A chosen seat background replaces the commander art behind the life total.
  const cards = useMemo(
    () => (playmat ? [JSON.parse(playmat) as CommanderCard] : (JSON.parse(artwork) as CommanderCard[])),
    [artwork, playmat],
  );
  const statusData = player?.statuses ?? '[]';
  const statuses = useMemo(() => JSON.parse(statusData) as PlayerStatus[], [statusData]);
  const [delta, setDelta] = useState(0);
  const life = player?.life ?? 0;
  const last = useRef(life);
  useEffect(() => {
    const d = life - last.current;
    last.current = life;
    if (!d) return;
    setDelta((v) => v + d);
    const t = setTimeout(() => setDelta(0), 1400);
    return () => clearTimeout(t);
  }, [life]);
  if (!player) return null;
  const { disabled, flags, flipped } = player;
  const chars = String(player.life).length;
  return (
    <section
      className={`player-tile ${player.color} ${player.eliminated ? 'eliminated' : ''} ${player.turn ? 'active-turn' : ''} ${player.role === 'archenemy' ? 'archenemy' : ''}`}
      data-role={player.role ?? undefined}
      aria-label={`${player.name}${player.role === 'archenemy' ? ' (archenemy)' : ''} seat`}
      data-player-id={id}
      style={span ? ({ '--seat-span': span } as CSSProperties) : undefined}
    >
      <div
        className={`tile-content ${flipped && !myView ? 'flipped' : ''} ${cards.length || player.photo ? 'with-commander-art' : ''}`}
        data-facing={flipped && !myView ? 'across' : 'near'}
      >
        <Sigil index={index} className="tile-sigil" />
        {player.photo ? (
          <div className="commander-backdrop" aria-hidden="true">
            <div className="commander-art-pane">
              <img src={player.photo} alt="" draggable={false} />
            </div>
          </div>
        ) : (
          <CommanderBackdrop cards={cards} />
        )}
        <button
          className="player-heading"
          onClick={() => openPlayer(id)}
          aria-label={`${player.name} details`}
        >
          <span className="seat-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="player-name">{player.name}</span>
          {player.team >= 0 && (
            <span className="team-mark" data-team={player.team}>
              {teamName(player.team).toUpperCase()}
            </span>
          )}
          {player.role === 'archenemy' && (
            // A compact mark keeps long names readable; the seat label and border say the rest.
            <span className="archenemy-mark" title="Archenemy" role="img" aria-label="Archenemy">
              <Icon name="scheme" size={13} />
            </span>
          )}
          {player.presence !== null && (
            <span
              className={`presence-dot ${player.presence ? 'online' : ''}`}
              title={player.presence ? 'Connected' : 'Disconnected'}
            />
          )}
          <Icon name="arrow" size={14} />
        </button>
        <div className="life-controls">
          <HoldButton
            className="decrease"
            label={`Decrease ${player.name}'s life`}
            disabled={disabled}
            accelerate
            onStep={(group, size) =>
              void act({ type: 'adjust', playerId: id, field: 'life', delta: -size }, group)
            }
          >
            <Icon name="minus" size={26} />
          </HoldButton>
          <div className={`life-value digits-${Math.min(chars, 7)}`}>
            <span
              className="life-total"
              data-testid={`life-${index}`}
              aria-label={`${player.name}: ${player.life} life`}
            >
              {player.life}
            </span>
            <span className={`life-delta ${delta > 0 ? 'gain' : 'loss'}`} aria-hidden="true">
              {delta ? `${delta > 0 ? '+' : '−'}${Math.abs(delta)}` : ''}
            </span>
          </div>
          <HoldButton
            className="increase"
            label={`Increase ${player.name}'s life`}
            disabled={disabled}
            accelerate
            onStep={(group, size) =>
              void act({ type: 'adjust', playerId: id, field: 'life', delta: size }, group)
            }
          >
            <Icon name="plus" size={26} />
          </HoldButton>
        </div>
        {statuses.length > 0 && (
          <div className="player-statuses" role="group" aria-label="Player status">
            {statuses.map((status) => {
              const Tag = status.kind === 'poison' ? 'span' : 'button';
              const action =
                status.kind === 'scheme'
                  ? 'open the scheme deck'
                  : status.kind === 'counter'
                    ? 'open player details'
                    : `open commander ${status.kind === 'tax' ? 'tax' : 'damage'}`;
              return (
                <Tag
                  className={`status-chip ${status.warning ? 'is-warning' : ''}`}
                  data-status={status.kind}
                  data-key={status.key}
                  key={status.key}
                  role={status.kind === 'poison' ? 'img' : undefined}
                  aria-label={`${status.kind === 'poison' ? '' : `${player.name}: ${action}. `}${status.warning ? 'Warning. ' : ''}${status.description}`}
                  aria-haspopup={status.kind === 'poison' ? undefined : 'dialog'}
                  onClick={
                    status.kind === 'poison'
                      ? undefined
                      : status.kind === 'scheme'
                        ? openSchemes
                        : status.kind === 'counter'
                          ? () => openPlayer(id)
                          : () => openCommander(id, status.kind === 'tax' ? status.key.slice(4) : undefined)
                  }
                  title={status.description}
                >
                  <Icon
                    name={status.warning ? 'warning' : status.kind === 'counter' ? 'spark' : status.kind}
                    size={13}
                  />
                  <span className="status-chip-label">{status.label}</span>
                  <strong className="status-chip-value">{status.value}</strong>
                </Tag>
              );
            })}
          </div>
        )}
        <div
          className={`tile-foot ${player.eliminated || flags || player.monarch || player.initiative || player.turn ? 'has-status' : ''}`}
        >
          {player.eliminated ? (
            <span>Eliminated · tap name to restore</span>
          ) : flags.length ? (
            <span className="warning-badge">! {flags}</span>
          ) : (
            <span
              className="life-caption"
              title={
                cards.length
                  ? cards
                      .map(
                        (card) =>
                          `Art by ${card.artist} · © Wizards of the Coast · Source: Scryfall. Credits in player details.`,
                      )
                      .join(' / ')
                  : undefined
              }
            >
              {player.photo ? 'LIFE TOTAL' : cards.length ? 'ART · SCRYFALL' : 'LIFE TOTAL'}
            </span>
          )}
          <span className="tile-trackers">
            {player.monarch && (
              <span title="Monarch" aria-label="Monarch">
                ♛
              </span>
            )}
            {player.initiative && (
              <span title="Initiative" aria-label="Initiative">
                ◆
              </span>
            )}
            {player.turn > 0 && (
              <span>
                {player.role === 'team' || player.team >= 0 ? 'TEAM ' : ''}TURN {player.turn}
                <TurnClock />
              </span>
            )}
          </span>
        </div>
      </div>
    </section>
  );
});
export function Board({
  openPlayer,
  openCommander,
  openSchemes,
}: {
  openPlayer: (id: string) => void;
  openCommander: (playerId: string, commanderId?: string) => void;
  openSchemes: () => void;
}) {
  const game = useApp((s) => s.game)!,
    profile = useApp((s) => s.profile),
    room = useApp((s) => s.room),
    mode = useApp((s) => s.mode);
  const seat = mode === 'room' ? room?.me.seatId : profile.mySeat;
  const { layout, automatic } = useTableLayout();
  const mine = profile.view === 'mine' && seat && game.players[seat];
  const shared = layout === 'shared';
  const farCount = Math.ceil(game.order.length / 2),
    nearCount = Math.max(1, Math.floor(game.order.length / 2));
  return (
    <>
      {mode === 'room' && (
        <div className="view-switch">
          <button className={!mine ? 'selected' : ''} onClick={() => void updateProfile({ view: 'table' })}>
            Table view
          </button>
          <button
            disabled={!seat}
            className={mine ? 'selected' : ''}
            onClick={() => void updateProfile({ view: 'mine' })}
          >
            My seat{!seat ? ' · claim a seat' : ''}
          </button>
        </div>
      )}
      {mine ? (
        <div className="my-view">
          <PlayerTile
            id={seat!}
            index={game.order.indexOf(seat!)}
            openPlayer={openPlayer}
            openCommander={openCommander}
            openSchemes={openSchemes}
            myView
          />
          <div className="seat-overview">
            {game.order
              .filter((id) => id !== seat)
              .map((id) => (
                <button
                  className={`overview-item ${game.players[id].color}`}
                  key={id}
                  onClick={() => openPlayer(id)}
                >
                  <span>{game.players[id].name}</span>
                  <strong>{game.players[id].life}</strong>
                </button>
              ))}
          </div>
        </div>
      ) : (
        <div
          className={`board seats-${game.order.length} ${shared ? 'shared-table' : ''}`}
          data-layout={shared ? 'shared' : 'upright'}
          style={shared ? ({ '--table-columns': farCount * nearCount } as CSSProperties) : undefined}
        >
          {game.order.map((id, i) => (
            <PlayerTile
              key={id}
              id={id}
              index={i}
              openPlayer={openPlayer}
              openCommander={openCommander}
              openSchemes={openSchemes}
              myView={false}
              autoFlipped={facesAcross(layout, i, game.order.length)}
              automatic={automatic}
              span={shared ? (i < farCount ? nearCount : farCount) : undefined}
            />
          ))}
          {!shared && game.order.length > 2 && game.order.length % 2 === 1 && (
            <div className="empty-seat">
              <Sigil />
              <span>A little room for magic.</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
