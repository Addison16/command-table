import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { act, isHost, notify, report, repository, useApp } from '../app/store.js';
import {
  seatProfileSchema,
  type Envelope,
  type Game,
  type RoomView,
  type SeatProfile,
} from '../../shared/schema.js';
import { gameExport } from '../storage/repository.js';
import { ask, downloadText, Field, Icon, Sheet, Toggle } from '../components/ui.js';
import { CommanderInput } from '../components/CommanderInput.js';
import { PlayerNameInput } from '../components/PlayerNameInput.js';
import type { CommanderCard } from '../../shared/cards.js';
import '../styles/archenemy.css';
export function JoinSheet({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState(new URLSearchParams(location.search).get('join') ?? ''),
    [name, setName] = useState(() => {
      const remembered = useApp.getState().profile.displayName;
      return /^(?:Host|Player(?: [1-8])?)$/.test(remembered) ? '' : remembered;
    }),
    [busy, setBusy] = useState(false);
  return (
    <Sheet
      title="There’s a seat for you"
      description="Enter your name, then choose your seat and commanders."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const { joinRoom } = await import('../adapters/room.js');
            await joinRoom(code, name.trim() || 'Player');
            onClose();
          } catch (err) {
            report(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Room code" hint={`Room codes work on this instance: ${location.host}`}>
          <input
            className="join-code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD EFGH"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={16}
            required
          />
        </Field>
        <PlayerNameInput
          label="Your display name"
          hint="This will be your player name at the table."
          value={name}
          defaultName="Player"
          onChange={setName}
        />
        <button className="primary full" disabled={busy}>
          <Icon name="people" />
          {busy ? 'Finding your table…' : 'Join room'}
        </button>
        <p className="hint center">Your local game stays saved while you join.</p>
      </form>
    </Sheet>
  );
}
export function Lobby({ openRoom }: { openRoom: () => void }) {
  const room = useApp((s) => s.room);
  if (!room)
    return (
      <main className="lobby">
        <h1>Reconnecting to your table…</h1>
        <p>The last room is unavailable. Retry above or return to the home screen.</p>
        <button onClick={() => useApp.setState({ screen: 'home' })}>Open home</button>
      </main>
    );
  return (
    <main className="lobby">
      <div className="eyebrow gold">WELCOME, {room.me.name.toUpperCase()}</div>
      <h1>Pick your place.</h1>
      <p>Make this seat yours. The host only needs to approve your request.</p>
      <SeatRequest key={room.id} room={room} />
      <button className="text-button full" onClick={openRoom}>
        Room details
      </button>
      <button className="text-button full" onClick={() => useApp.setState({ screen: 'home' })}>
        Back to home
      </button>
    </main>
  );
}
function SeatRequest({ room }: { room: RoomView }) {
  const connected = useApp((s) => s.connected),
    pending = useApp((s) => s.pending);
  const requestedSeatIndex = room.seats.findIndex((seat) => seat.id === room.me.requestedSeat);
  const defaultName = requestedSeatIndex < 0 ? 'Player' : `Player ${requestedSeatIndex + 1}`;
  const [name, setName] = useState(() => {
      const savedName = room.me.seatProfile?.name ?? room.me.name;
      return savedName === defaultName || (!room.me.seatProfile && savedName === 'Player') ? '' : savedName;
    }),
    [commanders, setCommanders] = useState(room.me.seatProfile?.commanders ?? ['']);
  const [commanderCards, setCommanderCards] = useState<(CommanderCard | null)[]>(
    room.me.seatProfile?.commanderCards ?? commanders.map(() => null),
  );
  const commanderEnabled = room.commanderEnabled ?? true;
  const profile: SeatProfile = {
    name: name.trim() || defaultName,
    ...(commanderEnabled && (commanders.length === 2 || commanders.some((label) => label.trim()))
      ? {
          commanders: commanders.map((label, index) => label.trim() || `Commander ${index + 1}`),
          ...(commanderCards.some(Boolean) ? { commanderCards } : {}),
        }
      : {}),
  };
  const changed = JSON.stringify(profile) !== JSON.stringify(room.me.seatProfile);
  const disabled = !connected || pending > 0;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const playerId = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
        if (!playerId || disabled) return;
        const seatIndex = room.seats.findIndex((seat) => seat.id === playerId);
        if (seatIndex < 0) return;
        const parsed = seatProfileSchema.safeParse({
          ...profile,
          name: name.trim() || `Player ${seatIndex + 1}`,
        });
        if (!parsed.success) {
          report(
            new Error(
              'Use a player name up to 40 characters and commander names up to 100. Select artwork to use a pasted card link.',
            ),
          );
          return;
        }
        void act({ type: 'requestSeat', playerId, profile: parsed.data });
      }}
    >
      <fieldset className="lobby-profile" disabled={disabled}>
        <legend>Your player</legend>
        <PlayerNameInput label="Player name" value={name} defaultName={defaultName} onChange={setName} />
        {commanderEnabled && (
          <>
            {commanders.map((label, index) => (
              <CommanderInput
                key={index}
                label={`Commander ${index + 1} name`}
                value={label}
                card={commanderCards[index]}
                disabled={disabled}
                onChange={(name, card) => {
                  setCommanders((current) => current.map((value, at) => (at === index ? name : value)));
                  setCommanderCards((current) =>
                    commanders.map((_, at) => (at === index ? card : (current[at] ?? null))),
                  );
                }}
              />
            ))}
            <Toggle
              checked={commanders.length === 2}
              onChange={(partners) => {
                setCommanders((current) => (partners ? [current[0], ''] : [current[0]]));
                setCommanderCards((current) =>
                  partners ? [current[0] ?? null, null] : [current[0] ?? null],
                );
              }}
            >
              Two commanders / partners
            </Toggle>
          </>
        )}
        <p className="hint">
          Your choices appear on everyone’s board once the host approves. You can edit them during the game.
        </p>
      </fieldset>
      <div className="pending-message">
        {room.me.status === 'rejected'
          ? 'The host declined your request. Choose another seat or check with them.'
          : room.me.status === 'seat-taken'
            ? 'That seat was taken. Choose another below.'
            : room.me.requestedSeat
              ? `Waiting for approval · ${room.seats.find((s) => s.id === room.me.requestedSeat)?.name}`
              : 'Choose an available seat below.'}
      </div>
      {room.seats.map((s) => (
        <div className="lobby-seat" key={s.id}>
          <span>
            {s.name}
            {s.archenemy && <small className="role-tag archenemy"> Archenemy</small>}
          </span>
          <button
            type="submit"
            value={s.id}
            disabled={disabled || s.taken || (room.me.requestedSeat === s.id && !changed)}
          >
            {s.taken
              ? 'Taken'
              : room.me.requestedSeat === s.id
                ? changed
                  ? 'Update request'
                  : 'Requested'
                : 'Request seat'}
          </button>
        </div>
      ))}
    </form>
  );
}
export function RoomSheet({ onClose }: { onClose: () => void }) {
  const room = useApp((s) => s.room)!,
    connected = useApp((s) => s.connected),
    pending = useApp((s) => s.pending),
    unresolved = useApp((s) => s.unresolved);
  const [qr, setQr] = useState('');
  const [submitted, setSubmitted] = useState<Envelope[]>([]);
  const [archives, setArchives] = useState<Game[] | null>(null);
  const host = isHost(),
    ready = host && connected && pending === 0;
  useEffect(() => {
    if (room.joinUrl)
      void QRCode.toDataURL(room.joinUrl, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
        .then(setQr)
        .catch(report);
  }, [room.joinUrl]);
  useEffect(() => {
    let current = true;
    void repository
      .pending(room.id)
      .then((items) => {
        if (current) setSubmitted(items);
      })
      .catch(report);
    return () => {
      current = false;
    };
  }, [room.id, pending, connected]);
  const copyLink = async () => {
    if (!room.joinUrl) return;
    try {
      await navigator.clipboard.writeText(room.joinUrl);
      notify('Join link copied');
    } catch {
      const input = document.querySelector<HTMLInputElement>('#join-url');
      input?.focus();
      input?.select();
      notify('Select and copy the join link below');
    }
  };
  return (
    <Sheet
      title={host ? 'Invite your table' : 'Your shared room'}
      description={
        host
          ? 'Friends choose their names and commanders. Approve their seats below.'
          : 'Choose your name and commanders. The host approves seat assignments.'
      }
      onClose={onClose}
    >
      {host && (
        <>
          {qr && <img className="qr-code" src={qr} alt="QR code to join this room" />}
          <div className="room-code">
            {room.code?.slice(0, 4)} {room.code?.slice(4)}
          </div>
          <p className="join-address">{room.joinUrl ? new URL(room.joinUrl).origin : location.origin}</p>
          <button className="primary full" onClick={() => void copyLink()}>
            <Icon name="link" />
            Copy join link
          </button>
          <Field label="Join link">
            <input id="join-url" readOnly value={room.joinUrl ?? ''} onFocus={(e) => e.target.select()} />
          </Field>
          <Toggle
            disabled={!ready}
            checked={room.locked}
            onChange={(locked) => void act({ type: 'lock', locked })}
          >
            Lock joining
          </Toggle>
          <p className="hint">
            Each player controls their own seat. Everyone can view the table and commanders.
          </p>
          <button
            className="secondary full"
            disabled={!ready}
            onClick={async () => {
              if (
                await ask(
                  'Rotate invitation code?',
                  'Existing members keep access. The old link and QR code will stop inviting new guests.',
                )
              )
                void act({ type: 'rotateCode' });
            }}
          >
            Rotate invitation code
          </button>
        </>
      )}
      <section className="detail-section">
        <h3>People at the table</h3>
        {room.members.map((m) => (
          <div className="member-row" key={m.id}>
            <h4>
              <span className={`presence-dot ${m.connected ? 'online' : ''}`} />
              {m.name}
              {m.id === room.hostId && <span className="gold">· Host</span>}
              {m.id === room.me.id && <span className="muted">· You</span>}
            </h4>
            <p>
              {m.seatId
                ? room.seats.find((s) => s.id === m.seatId)?.name
                : m.requestedSeat
                  ? `Requests ${room.seats.find((s) => s.id === m.requestedSeat)?.name}`
                  : m.status === 'approved'
                    ? 'No seat assigned'
                    : m.status}
            </p>
            {m.requestedSeat && m.seatProfile && (
              <p className="seat-request-preview">
                <strong>{m.seatProfile.name}</strong>
                {m.seatProfile.commanders && <> · {m.seatProfile.commanders.join(' + ')}</>}
              </p>
            )}
            <div className="member-actions">
              {host && m.requestedSeat && (
                <>
                  <button
                    className="primary"
                    disabled={!ready}
                    onClick={() =>
                      void act({
                        type: 'approve',
                        memberId: m.id,
                        playerId: m.requestedSeat!,
                        replace: false,
                      })
                    }
                  >
                    Approve seat
                  </button>
                  <button disabled={!ready} onClick={() => void act({ type: 'reject', memberId: m.id })}>
                    Decline
                  </button>
                </>
              )}
              {host && m.id !== room.hostId && m.status === 'approved' && (
                <button
                  disabled={!ready}
                  onClick={async () => {
                    if (
                      await ask(
                        `Transfer host to ${m.name}?`,
                        'They will manage the room. Your seats stay the same; you lose host controls. This needs their cooperation to reverse.',
                      )
                    )
                      void act({ type: 'transfer', memberId: m.id });
                  }}
                >
                  Transfer host
                </button>
              )}
              {host && m.seatId && (
                <button disabled={!ready} onClick={() => void act({ type: 'release', memberId: m.id })}>
                  Release seat
                </button>
              )}
              {host && m.id !== room.hostId && (
                <button
                  disabled={!ready}
                  onClick={async () => {
                    if (
                      await ask(
                        `Remove ${m.name}?`,
                        'This revokes their membership and disconnects their devices. Their seat remains in the game.',
                      )
                    )
                      void act({ type: 'remove', memberId: m.id });
                  }}
                >
                  Remove guest
                </button>
              )}
            </div>
            {host && m.status !== 'revoked' && (
              <Field label={`Assign ${m.name} a seat`}>
                <select
                  disabled={!ready}
                  value=""
                  onChange={async (e) => {
                    const playerId = e.target.value;
                    if (!playerId) return;
                    const occupied = room.seats.find((s) => s.id === playerId)?.taken;
                    if (
                      occupied &&
                      !(await ask(
                        'Replace the current guest?',
                        'The former guest’s room membership and sockets will be revoked before granting this seat.',
                      ))
                    )
                      return;
                    void act({ type: 'approve', memberId: m.id, playerId, replace: !!occupied });
                  }}
                >
                  <option value="">Choose seat…</option>
                  {room.seats.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.archenemy ? ' · archenemy' : ''}
                      {s.taken ? ' · replace guest' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        ))}
      </section>
      {!host && (
        <p className="hint">
          You can adjust your own seat and view everyone’s information and commanders. Contact the host to
          change seats.
        </p>
      )}
      {unresolved.length > 0 && (
        <details open>
          <summary>Submitted action notices</summary>
          {unresolved.map((s, i) => (
            <p className="hint" key={i}>
              {s}
            </p>
          ))}
        </details>
      )}
      {submitted.length > 0 && (
        <details open>
          <summary>Actions awaiting confirmation ({submitted.length})</summary>
          <p className="hint">
            These were recorded before sending. Reconnecting checks the same actions without applying them
            twice.
          </p>
          {submitted.map(({ operationId, command }) => (
            <p className="hint" key={operationId}>
              {'playerId' in command
                ? `${room.seats.find((s) => s.id === command.playerId)?.name ?? 'Player'} · `
                : ''}
              {command.type === 'adjust'
                ? `${command.field} ${command.delta > 0 ? '+' : ''}${command.delta}`
                : command.type === 'set'
                  ? `Set ${command.field} to ${command.value}`
                  : command.type === 'damage'
                    ? `Record ${command.amount} commander damage`
                    : command.type.replace(/([A-Z])/g, ' $1')}
            </p>
          ))}
        </details>
      )}
      {room.me.status === 'approved' && (
        <details
          onToggle={(event) => {
            if (event.currentTarget.open && connected && archives === null)
              void import('../adapters/room.js')
                .then(({ roomArchives }) => roomArchives(room.id))
                .then(setArchives)
                .catch(report);
          }}
        >
          <summary>Previous matches</summary>
          <p className="hint">
            The last ten rematches stay on the server until this room expires. Export a copy to keep one.
          </p>
          {archives === null ? (
            <p className="hint">
              {connected ? 'Open to load saved matches.' : 'Reconnect to load saved matches.'}
            </p>
          ) : archives.length === 0 ? (
            <p className="hint">No completed matches yet.</p>
          ) : (
            archives.map((game) => (
              <button
                className="secondary full"
                key={game.id}
                onClick={() =>
                  downloadText(gameExport(game), `command-table-match-${game.id.slice(0, 8)}.json`)
                }
              >
                <Icon name="download" />
                {new Date(game.timer.startedAt).toLocaleString()} · {game.order.length} players
              </button>
            ))
          )}
        </details>
      )}
      <section className="detail-section">
        <h3>Room persistence</h3>
        <p className="hint">
          Saved on this server for {room.retentionDays} days after the last game or administration action.
          Currently expires {new Date(room.expiresAt).toLocaleString()}. Connected phones alone do not extend
          retention.
        </p>
        <p className="hint">
          Losing your browser’s guest cookie loses your identity. Ask the host to replace your seat. Transfer
          host before leaving if someone else should run this room; a lost host identity cannot be recovered
          through the invitation code.
        </p>
      </section>
    </Sheet>
  );
}
