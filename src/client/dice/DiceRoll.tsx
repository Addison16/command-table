import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { type Game, type Roll } from '../../shared/schema.js';
import { act, isHost, useApp } from '../app/store.js';
import { Icon } from '../components/ui.js';
import { DiceCanvas } from './DiceCanvas.js';
import { visualDice } from './presentation.js';
import { playCue, playImpacts, stopSounds } from '../components/feedback.js';
import '../styles/dice.css';

export function rollTitle(roll: Roll) {
  return roll.kind === 'dice'
    ? `${roll.values.length}d${roll.sides}`
    : roll.kind === 'coin'
      ? 'Coin flip'
      : roll.kind === 'd20-each'
        ? 'd20 for everyone'
        : 'Who goes first?';
}
export function DiceRoll({
  roll,
  game,
  replay,
  onClose,
}: {
  roll: Roll;
  game: Game;
  replay?: boolean;
  onClose: () => void;
}) {
  const effects = useApp((s) => s.profile.effects);
  const audio = useApp((s) => s.profile.audio);
  const live = useApp((s) => s.mode === 'local' || s.connected);
  const readOnly = useApp((s) => s.readOnly);
  const reduced = effects !== 'full' || matchMedia('(prefers-reduced-motion: reduce)').matches || !!replay;
  const [round, setRound] = useState(reduced ? Math.max(0, roll.rounds.length - 1) : 0);
  const [settled, setSettled] = useState(reduced);
  const [skipped, setSkipped] = useState(false);
  const lastRound = round >= roll.rounds.length - 1;
  const revealed = (settled && lastRound) || skipped || reduced;
  const rollingPlayer = roll.playerId ? game.players[roll.playerId] : undefined;
  useEffect(() => {
    if (!audio || replay) return;
    // A still result gets one knock. A thrown die sounds its own strikes below.
    if (reduced || skipped) playCue('roll', 0.15);
    return stopSounds;
  }, [audio, replay, roll.id, round, reduced, skipped]);
  useEffect(() => {
    if (!settled || lastRound || skipped || reduced) return;
    const timer = setTimeout(() => {
      setRound((r) => r + 1);
      setSettled(false);
    }, 850);
    return () => clearTimeout(timer);
  }, [settled, lastRound, skipped, reduced]);
  const dice = useMemo(() => visualDice(roll, game, round), [roll, game, round]);
  const finalScores = useMemo(() => {
    const scores = new Map<string, number>();
    for (const round of roll.rounds) for (const r of round) scores.set(r.playerId, r.value);
    return scores;
  }, [roll]);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dice-backdrop" />
        <Dialog.Content
          className="dice-screen"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById('dice-dismiss')?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            document.querySelector<HTMLButtonElement>('[aria-label="Game controls"] button')?.focus();
          }}
        >
          <Dialog.Title className="sr-only">{rollTitle(roll)}</Dialog.Title>
          <Dialog.Description className="sr-only">
            Dice roll over the life-counter table. The result is revealed when they settle.
          </Dialog.Description>
          <div className="dice-screen-heading">
            <span className="eyebrow">
              {roll.actor} rolled{rollingPlayer ? ` for ${rollingPlayer.name}` : ''}
            </span>
            <strong>{rollTitle(roll)}</strong>
            {!revealed && (
              <span>
                {settled && !lastRound
                  ? 'Tied highest — rolling again…'
                  : round > 0
                    ? `Tie reroll ${round}`
                    : 'Let them roll…'}
              </span>
            )}
          </div>
          <DiceCanvas
            key={`${roll.id}:${round}:${skipped}`}
            dice={dice}
            seed={`${roll.id}:${round}`}
            animate={!reduced && !skipped}
            onImpacts={audio && !replay ? playImpacts : undefined}
            resultSpace={
              roll.winner
                ? Math.min(415, 230 + Math.ceil(roll.candidates.length / 2) * 48)
                : roll.values.length > 10
                  ? 320
                  : 265
            }
            onFinish={() => setSettled(true)}
          />
          <div
            className={`dice-scorecard ${revealed ? 'revealed' : ''}`}
            data-testid="dice-result"
            data-revealed={revealed}
          >
            {revealed ? (
              <>
                <div aria-live="polite" aria-atomic="true">
                  {roll.winner ? (
                    <>
                      <p className="eyebrow gold">FIRST TO PLAY</p>
                      <h2 className="winner-name">{game.players[roll.winner]?.name}</h2>
                      {roll.kind === 'd20-each' && (
                        <div className="player-roll-scores">
                          {roll.candidates.map((id) => (
                            <div className={id === roll.winner ? 'winning-score' : ''} key={id}>
                              <span>{game.players[id]?.name}</span>
                              <strong>{finalScores.get(id) ?? '—'}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                      {roll.rounds.length > 1 && (
                        <p className="hint">
                          {roll.rounds.length - 1} tie reroll{roll.rounds.length === 2 ? '' : 's'} · tied
                          players’ latest scores shown
                        </p>
                      )}
                    </>
                  ) : roll.kind === 'coin' ? (
                    <h2 className="rolled-total die">{roll.values[0] === 1 ? 'Heads' : 'Tails'}</h2>
                  ) : (
                    <>
                      <p className="eyebrow gold">{roll.values.length > 1 ? 'TOTAL' : 'YOU ROLLED'}</p>
                      <h2 className="rolled-total">{roll.values.reduce((sum, value) => sum + value, 0)}</h2>
                      <div className="rolled-values" aria-label="Individual dice results">
                        {roll.values.map((value, i) => (
                          <span className="die" key={i}>
                            {value}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {roll.winner && game.settings.turnTracking && game.status === 'active' && isHost() && (
                  <button
                    className="primary full"
                    disabled={!live || readOnly}
                    onClick={async () => {
                      await act({ type: 'turn', playerId: roll.winner, advance: false });
                      onClose();
                    }}
                  >
                    Confirm first player
                  </button>
                )}
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={!live || readOnly}
                    onClick={() =>
                      void act({
                        type: 'roll',
                        kind: roll.kind,
                        sides: roll.kind === 'dice' ? (roll.sides as 4 | 6 | 8 | 10 | 12 | 20 | 100) : 20,
                        count: Math.max(1, roll.values.length),
                        ...((roll.kind === 'dice' || roll.kind === 'coin') && roll.playerId
                          ? { playerId: roll.playerId }
                          : {}),
                      })
                    }
                  >
                    <Icon name="dice" />
                    Roll again
                  </button>
                  <button id="dice-dismiss" className="primary" onClick={onClose}>
                    Back to game
                  </button>
                </div>
              </>
            ) : (
              <button
                id="dice-dismiss"
                className="secondary"
                onClick={() => {
                  setSkipped(true);
                  setRound(Math.max(0, roll.rounds.length - 1));
                  setSettled(true);
                }}
              >
                Skip animation
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
