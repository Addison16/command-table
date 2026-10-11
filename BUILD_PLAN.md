# Command Table — product and implementation handoff

This document describes Command Table as it is built in this repository: the product decisions, how each feature behaves, how the code is organized, and how changes are verified and shipped. It replaces the original build specification of September 15, 2026, which described an empty folder and handed the build to another agent. That version remains in Git history (first added in commit `0f455e3`). Where the built app intentionally differs from that specification, section 14 records the change.

Read this before changing the app. The detailed references are:

| Document | Contents |
| --- | --- |
| [README.md](README.md) | Docker installation and updates, how to play, what is remembered, development and checks |
| [docs/architecture.md](docs/architecture.md) | Detailed contracts for the domain, storage, synchronization, retention, PWA and operations |
| [docs/deployment.md](docs/deployment.md) | Docker hosting, configuration, HTTPS proxies, backup/restore, updates and publishing |
| [docs/testing.md](docs/testing.md) | Dated verification record, reproduction commands and the physical-device checklist |
| [docs/progress.md](docs/progress.md) | Milestone and release history |
| [docs/assets.md](docs/assets.md) | Fonts, artwork, icons and license provenance |
| [docs/releases/](docs/releases/) | Notes for each published version |

**Status.** The latest GitHub release is [v0.3.2.1](https://github.com/Addison16/command-table/releases/tag/v0.3.2.1). The current main branch preserves its Archenemy preset, centered dice layout, commander suggestion fixes and home game lists, and adds elimination and winner screens, physically simulated dice, coordinated table looks, artwork framing, and the server reliability work in sections 8–10 (schema 3, bounded receipts, shared traffic budgets, automatic backups and private diagnostics). Docker installation templates are available with v0.3.1; these newer source changes await a Docker release. Publishing a new release or image requires a separate, explicit request from the owner.

## 1. Product goal and settled decisions

Command Table is a beautiful, fast browser companion for playing physical Magic: The Gathering with friends. Its central job is tracking life and common game information for one to eight players. It is meant to sit on the table for an entire game: readable at a glance, easy to touch, visually distinctive, and dependable after a refresh or interruption.

**Audience priority: about 99% of use is on iPhone and Android browsers. Design, implementation tradeoffs and acceptance testing start with phones; desktop is a secondary adaptation.** The complete experience works in an ordinary mobile browser tab. Installing the app is optional.

There are two play modes:

| Mode | Experience | Where the authoritative game lives |
| --- | --- | --- |
| One device | One phone or tablet manages the whole table; everyone uses its controls. Works offline and needs no server session. | That browser's IndexedDB database |
| Shared room | The host creates a room; friends join by code, link or QR and see live updates. Each approved player controls their own seat; the host also manages the room and table controls. | The self-hosted server's SQLite database |

Settled decisions:

- 2–8 normal seats plus a 1-seat practice mode.
- Home offers **Quick 4 · 40 life** (Commander) as the primary action and **Quick 2 · 20 life** (commander tools off). **Set up a game** opens full setup.
- iPhone Safari and Android Chrome are the primary targets. Other mobile browsers, tablets and desktop browsers must also work.
- Complete features: life, poison, per-commander damage and tax, 3D dice and coin, first-player selection, opt-in turn tracking, a game timer, group life changes (one device), end/reopen/rematch, game recaps, and optional commander artwork, card text and rulings.
- No accounts, analytics, hardware fingerprinting or IP-based identity. Games resume from the same browser profile at the same site address.
- Warnings never eliminate anyone. Command Table is a manual tracker, not a rules engine; elimination and rules decisions stay with the players.
- The design is an original arcane fantasy style influenced by Magic's colors and tabletop atmosphere. Card artwork appears only when a player chooses it from Scryfall.
- The product name is **Command Table**. Internal identifiers keep the original `mtg-util` names for compatibility (section 8).
- Hosts run the published Docker image; Docker/Compose is the primary installation and update path in all documentation. Direct Node/npm setup is for contributors.
- Since v0.1.2 the project is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). It is unofficial Fan Content under the Wizards of the Coast Fan Content Policy.

## 2. Account-free identity and resuming games

### What "remember this device" means

A browser cannot read a MAC address, and the app does not try to identify hardware. On first use it generates a random local installation ID and stores it with preferences and local games. The ID organizes local data; it never grants room or host access.

The experience is: open the same site in the same browser profile and resume where you left off. A different browser, private session, cleared storage or a changed scheme/host/port starts fresh, because browser storage is scoped to the origin. **Export game backup** and import move a local game between addresses or browsers.

On launch the app:

1. Hydrates and validates saved data before showing setup or allowing changes. Unreadable or future-version data is preserved, and Home offers **Export recovery data**, **Restore checkpoint** or an explicitly confirmed **Start a fresh local game**.
2. Resumes a valid local game directly.
3. For a saved room, reauthenticates and fetches the current server state before enabling controls.
4. If the room is unreachable, shows its last confirmed state with a connection message, **Reconnect now**, and **Continue a copy on this device**.
5. Otherwise shows Home.

Home lists up to ten unfinished local and shared games with **Resume**, and recently ended games for 24 hours with **Reopen** and **View final game**. The Game menu keeps up to ten archived local games with delete controls. **New game** asks **One phone** or **Multiple phones**, saves the outgoing game, and opens a fresh setup with default players.

### Guest identity in shared rooms

Creating or joining a room creates an anonymous guest session: a random 256-bit opaque token in a persistent `HttpOnly`, `SameSite=Lax`, `Path=/` cookie with no `Domain`, marked `Secure` on HTTPS. Only token hashes are stored. Sessions use a configurable rolling lifetime (90 days by default). The cookie and server expiry renew together over HTTP at launch, on foreground and reconnect, and every 15 minutes during play. Expired or revoked authority is never renewed; it requires a new join. A guest session that belongs to no room is removed a day after its last use.

Room references are saved locally, but permissions always come from the server. A returning guest recovers their seat while their session and the room exist. Losing the cookie means a new guest identity, and the host can approve them as a replacement for their old seat. A lost host credential cannot be recovered with the invitation code, so the host should transfer host before leaving. If the host's session expires while the room is still active, the longest-seated approved member becomes host.

Settings say: "Games and preferences are remembered in this browser. Export a backup before clearing site data or changing browsers." Room details show the room's retention period. The app never promises permanent storage.

## 3. Screens and primary flows

### Home

A hero with the mana emblem. **Quick 4 · 40 life** is the main button, beside **Create room** and **Join room**, then **Set up a game** and **Quick 2 · 20 life**. The start, create and join actions fit on the first small-phone screen. Below them are Recent games and **Display & browser settings**. Tapping the **Command Table** logo during play returns Home.

### Setup

Players 1–8 (1 is practice mode), **Game preset** (Commander, Archenemy, 20-life game, Custom) and **Starting life**. The optional **Names, colors & commanders** section has one commander or **Two commanders / partners** per seat, each with optional artwork. **Trackers & house rules** covers the poison and commander toggles and their warning thresholds. Defaults are Player 1–8 with the first eight palette colors, 40 or 20 life, a poison warning at 10 and a commander-damage warning at 21. Room setup adds **Your player**, because the first seat belongs to the host.

**Archenemy** requires at least two players. Setup selects the archenemy and separate starting life for that seat (60 by default) and the team (40 each). The archenemy's scheme deck tracks named and ongoing schemes. Turn tracking alternates the archenemy and the team's shared turn, and group life changes target only the opposing side. A team victory is announced on the board and remains shared; the individual winner screen applies to the archenemy or the last player in games without teams.

### Game board

The board dominates the viewport. Each player tile shows the name, a large life total, and minus/plus controls that repeat when held. An accumulated change label such as `−7` appears briefly. When commander tools are on, **Damage** and **Tax** shortcuts sit under the life total, even at zero. Damage shows the highest total received from one commander, and partners get **Tax I / Tax II**. Status badges appear for poison above zero, warnings, elimination and the current turn. Chosen commander artwork fills the panel behind the controls.

The toolbar holds **Utilities**, **Undo**, **Next turn** (only when turn tracking is on) and **Game menu**. Shared rooms add a connection indicator and a **Table / My seat** switch. **My seat** enlarges the assigned player's controls and shows the rest of the table compactly.

### Player details

Opened from a player's name, as a bottom sheet that stays upright whichever way the tile faces:

- **Edit player & commanders**: name, color, commander labels and artwork, saved together with one **Save changes** and undone as one entry. Recorded damage and casts are kept.
- Exact life, poison and any legacy manual counters.
- Commander damage received: **Record combat damage**, which can also subtract life, and **Correct recorded totals**, which changes damage only.
- Command-zone casts per commander, with **Next cast: +N** and **Correct casts**.
- **View commander**, the card reader described in section 6.
- **Artwork framing on this device**, with portrait and landscape previews.
- Seat rotation, plus **Eliminate player** and **Restore player**.

Exact-value drafts stay in their fields until the save is confirmed, and a rejected correction keeps its draft for review.

### Utilities, Game menu and Settings

- **Utilities** ("A little luck & magic"): roll dice and flip a coin for a chosen player or the table, **Group life change**, **Who goes first?**, recent rolls with replay, the turn-tracking toggle and current player, and the game timer.
- **Game menu** ("Around the table"): table layout, game history (with **Redo** in one-device games), **Share game recap**, display and preferences, **Room & players** in rooms, export and import, **Rematch · same seats**, **New game · change setup**, **End game**, archived games, tab takeover, and **Continue a copy on this device** in rooms.
- **Settings** ("Your table, your way"): appearance, table layout, effects level, sound with **Test dice sound**, haptics, keep the screen awake, fullscreen, home-screen installation help, the storage note and the Fan Content notice.

### Shared-room lobby and participation

The join flow is modeled on low-friction party games such as Jackbox: a browser, a room code and a display name, with no login or app install.

**Create room → choose table size and your player → share code/QR → friends enter a name and choose their player and commanders → host approves seats → play.**

- Room codes are 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. They are displayed as two groups of four, accept any case, spaces or hyphens, and are regenerated on collision. A code only works on the instance that created it, so the join sheet shows the site address.
- The **Invite your table** sheet shows the code, a locally generated QR code, and the join link `PUBLIC_ORIGIN/?join=CODE`, which prefills the code. Guests use their normal phone camera; there is no in-app scanner.
- Joining creates a pending participant who sees seat availability and their own request, never the game. In the lobby ("There's a seat for you") a guest picks a seat, their player name and optionally one or two commanders with artwork, then requests the seat. Requests survive refresh and server restarts, and **Update request** revises them.
- The host previews each request and taps **Approve seat**, or rejects it or replaces a guest. Approval is atomic: a partial unique index allows one approved member per seat. It applies the requested profile without resetting life, damage, casts or the timer.
- **People at the table** offers **Transfer host**, **Release seat**, **Remove guest** and seat replacement. Removing or replacing someone revokes their membership and closes their sockets. Transferring host does not swap seats.
- The host can **Lock joining** and **Rotate invitation code**; existing members keep access.
- Room details show expiry, **Previous matches** (exports of up to ten final match snapshots), actions awaiting confirmation and notices about set-aside actions.

Permissions are enforced on the server for HTTP and WebSocket alike:

| Action | Host | Approved player | Pending participant |
| --- | --- | --- | --- |
| View the board, history and any player's commander card | Yes | Yes | Lobby only |
| Edit life, poison, damage received, casts, own player name/color/commanders | Own seat only | Own seat only | No |
| Roll dice/coin, d20 for everyone, choose a first player | Yes | Yes | No |
| Turn tracking, current turn, timer, end, reopen, rematch | Yes | No | No |
| Approve/reject/replace seats, release, remove, transfer host, lock joining, rotate code | Yes | No | No |
| Undo | Their own latest action, when they still own every affected seat/commander; also their own table-control actions | Their own latest eligible action | No |
| Group life change | Not available in rooms | Not available in rooms | No |

The same room is kept across rematches; each match gets a new game ID. Presence (connected/reconnecting) is transient and never confused with elimination. The room stays available when the host's phone sleeps.

## 4. Game behavior and rules-aware tracking

### Life and input

- A tap is −1/+1 with immediate feedback. A hold repeats after 350 ms, then every 130 ms. Every increment is saved immediately, and one uninterrupted hold forms one undo group.
- Holds cancel on release, pointer cancellation, lost capture, opening a sheet, window blur or backgrounding, navigation and connection loss. Each pointer is tracked separately, so two players can hold different seats on a shared tablet.
- Exact values are set in player details. Negative life is allowed. Numbers are bounded safe integers: life −999,999 to 999,999 and counters 0 to 999,999. These are storage limits, not Magic rules.

### Poison, warnings and elimination

Poison is a separate nonnegative counter. Life at or below zero, poison at its threshold (10 by default) and 21 damage from one commander (by default) produce warnings, never automatic elimination. Infect, toxic and replacement effects are never inferred.

**Eliminate player** is manual and reversible with **Restore player** or Undo. An eliminated tile stays in place, dimmed, and is excluded from first-player selection, turn choice and group life targets. Eliminating a player shows a short non-blocking notice on every device. When exactly one player remains in a game of two or more, a winner screen names them and offers **Rematch** and **End game** (one device, or the room's host) and **Back to the table**. Both notices are derived from confirmed snapshots, appear only for the same match, are driven by timers so they work with motion off, and never change the saved game.

### Commander damage

Damage is stored as `damageReceived[recipientId][commanderId]`. Commander IDs identify individual commanders and survive renames, seat changes and partners. Partners have separate damage totals and separate cast counts.

**A player's own commanders are not damage sources.** The shared reducer rejects `damage` and `damageSet` for that pairing in local games and rooms. Older saves keep any stored self-damage, but it no longer counts toward displayed totals or warnings.

Damage operations:

- **Record combat damage**: choose a source and amount, with "Also subtract this much life" on by default. The damage and life change are one atomic, undoable event.
- **Correct recorded totals**: edits damage history only and never changes life.

The board's **Damage** shortcut remembers the last source chosen for each seat on that device. With eight players and partners, one recipient can have fourteen opposing sources, so sources are grouped by owner in a scrollable list.

### Commander tax

Command-zone casts are stored per commander. The additional cost of the next cast is `2 × previous casts`, shown as **Next cast: +N additional mana**. **Tax** shortcuts record a cast; **Correct casts** sets the count. Casts from other zones are not tracked.

### Group life change (one device)

**Utilities → Group life change**: choose the caster; every other active player is selected initially and can be deselected. Enter the life each opponent loses and, optionally, the total life the caster gains. Gain is never guessed or multiplied. Review each before/after total, then apply. The whole effect is one command and one Undo. It is unavailable in shared rooms, where each player records their own life.

### Turns, timer and legacy trackers

Turn tracking is off by default. When enabled (host-controlled in rooms) it shows **Next turn** beside Undo and a current-player choice in Utilities. Confirming a first-player result sets the turn only when tracking is on. The game timer derives elapsed time from start/pause timestamps; room clients estimate the server clock offset so phones with different clocks agree.

Named manual counters (energy, experience and so on) and the Monarch/Initiative markers still exist in the schema so older games stay readable. They are displayed when present, but the Extra trackers UI was removed and new games do not enable them.

### Undo, history, ending and rematches

- History keeps the latest 200 human-readable entries with actor names. Dice have their own bounded list.
- One device: up to 60 undo groups, with **Redo** in Game history until a new action branches.
- Shared rooms: conservative undo of the actor's own latest eligible action, checked against the room revision and current ownership. Administrative changes are a barrier. There is no shared redo.
- **End game** offers **Rematch**, **End game** and **Cancel**. Ending returns everyone Home and keeps the game under **Recently ended** for 24 hours. **Reopen** restores totals, damage, commanders and history with the timer paused; in rooms only the host can reopen. **View final game** inspects it, and dice still work there.
- **Rematch** keeps names, colors, commanders, artwork and seat assignments, restores the configured starting life, and clears counters, damage, casts, markers, elimination, turns, timer, dice, history and undo. It creates a new game ID; the room revision never rewinds.
- **New game** starts fresh defaults; previous players and house rules are not copied.
- **Share game recap** draws a PNG on the device: player colors, names, commanders, life and duration, marked **In progress** during play. A final recap can name a winner or a draw for the image only. **Share image** where supported, otherwise **Download PNG**.

## 5. Dice and utilities

- d4, d6, d8, d10, d12, d20 and d100 (percentile, shown as paired d10s; 1–100), 1–20 dice per roll, and a coin.
- **Roll for** a player gives resin dice in that player's seat color. **The table** gives warm ivory dice. Local rolls default to the last player saved or selected; shared guests default to their own seat.
- **Who goes first?** offers **d20 for everyone**, where each eligible player gets a matching colored d20 and tied leaders reroll before the winner is revealed, or **Just choose a player**. Choosing a first player never reorders seats.
- Every approved room member can roll. Results work on ended games too.

**The result is chosen once and recorded before any animation.** Local mode uses `crypto.getRandomValues()` with rejection sampling. In rooms the server chooses and persists the roll and broadcasts the same result to everyone. Skipping, dismissing, refreshing or replaying never rolls again. Each game keeps its 30 most recent rolls; Utilities lists the latest eight for replay.

The presentation is a full-screen Canvas2D overlay above the board, with no 3D library or downloaded assets:

- Each die is a seeded rigid-body throw (240 Hz simulation, recorded at 120 Hz) with gravity, corner impacts, friction and rolling resistance. It tumbles in from the players' side and settles on a face by itself in about 2.3 seconds. The face that lands on top carries the recorded value, and the die finishes square and upright in its own cell.
- Solids have rounded fillets, soft lighting, resin grain and recessed ink numbers. The coin has a metallic face and a milled rim.
- Detail and pixel ratio drop for crowded throws or slow devices without changing results or motion.
- Reduced motion shows the landed pose directly. Tie rounds animate in order, and winner text appears only after the last round. Browser Back dismisses the result.
- Synthesized sound knocks once per strike, louder for harder hits.

## 6. Optional commander cards (Scryfall)

Commander names always work as plain text. Card data adds to them without being required:

- **Artwork**: setup, joining and **Edit player & commanders** suggest card names as you type, or accept a pasted Scryfall card link (**Find artwork**). The game saves validated public metadata (`id`, front-face `name`, `imageUrl`, `scryfallUrl`, `artist`). Artwork follows approved guests, saved games, exports and rematches. Partners share the panel. Renaming a commander by hand clears the old card. Player details credit the artist and link to the card.
- **View commander**: the full card with rules text, mana cost, type and stats. Players can switch partners and double-faced card faces. **Rulings & notes** loads dated rulings with attribution. Reading another player's card never grants permission to edit their seat.
- **Server boundary**: `/api/cards/suggest`, `/resolve`, `/details` and `/rulings` need no session. They map input onto fixed Scryfall API paths, never fetch arbitrary URLs, share one bounded cache and one serialized upstream queue (550 ms spacing), back off for at least 30 seconds on upstream rate limits, and share a budget of 100 requests a minute per client.
- **Caching**: card text and rulings stay in the tab's memory for up to an hour. The service worker keeps up to 64 viewed art crops for 30 days. A missing image falls back to the normal panel, and lookups never block counters.

## 7. Visual direction and interaction quality

The app should feel like a carefully art-directed fantasy game companion with the polish of a shipped product: coherent materials, typography, motion and sound, and very little friction during play. The game board is the product. Avoid marketing-page structure, dense navigation, excessive blur and walls of equally prominent buttons.

### Design system

- **Brand**: an original five-mana crest (sun, water, skull, flame and tree around a crowned commander card) in `src/client/brand/emblem.ts`. The same paths drive the header, player ornaments, recap canvas, favicon and install icons.
- **Type**: locally bundled Inter for the interface and Cormorant Garamond for titles (four WOFF2 faces), with large tabular numerals for life.
- **Player palettes**: ivory, blue, violet, ember, green, teal, rose and copper. Names and sigils always accompany color.
- **Appearance** is per browser:
  - **Light**, **Dark** or **Use device setting** (the default).
  - Four coordinated looks: **Gilded night**, **Celestial spell**, **Verdant haven** and **Dragon's hearth**.
  - Color themes: Classic, Arcane, Forest, Ocean, Ember and Monochrome.
  - Accents: Gold (default), Red, Violet, Green, Blue, Rose, Teal and Copper.
  - Table finishes: Astral silk (default), Dragonfire, Celestial atlas, Verdant sanctuary, Stormglass, Prismatic veil, Gilded marble and Onyx minimal.
  - Finishes use self-hosted SVGs in `public/table-finishes/` (with portrait variants) and are precached. `public/appearance.js` applies saved choices before hydration from validated `localStorage` mirrors. **Reset appearance** restores the defaults. None of this changes game data or other players' displays.
- Life numbers dominate. Dense layouts scale down only as far as needed and may scroll rather than clip values or shrink controls.

### Layout

- **All facing me** (`upright`) and **Shared table** (`shared`: the far row is rotated 180° and the +/− areas are larger). Landscape uses two rows, spreading odd seat counts evenly.
- **Follow device rotation** is on by default on phones and tablets: Shared table in landscape, All facing me in portrait. Choosing a layout or flipping a seat turns it off on that device. Desktop stays manual.
- Layout and rotation are local presentation only. They never change game state, room permissions or another phone's view, and **My seat** stays upright.
- Use dynamic viewport height and safe-area insets. Touch targets are at least 44 × 44 CSS pixels; eight seats on a small phone scroll instead of shrinking controls, and seats below the fold are never hidden.

### Motion, sound and device features

- **Effects**: Full, Reduced or Off. The system reduced-motion setting always wins.
- State changes never wait for animation, and effects never capture input or hide labels. No canvas render loop runs on the board; the dice canvas exists only while a roll is shown.
- Sound is opt-in, synthesized locally, starts only after a user gesture, and can be previewed. Haptics, wake lock and fullscreen are optional and feature-detected. Wake lock shows an indicator while active.
- Game results are fully readable without sound, motion or haptics.

### Accessibility and mobile requirements

These remain standing requirements for every change:

- Real buttons, visible focus, keyboard access, Radix dialog semantics with focus restoration, labels such as "Decrease Alex's life", readable contrast in both light and dark, and preserved page zoom.
- Design every screen at phone size first. Frequent actions sit within thumb reach. Form text is at least 16 px. Room-code entry accepts paste. Sheet confirmations stay above the on-screen keyboard. No hover-only or right-click-only actions.
- Work in ordinary Safari/Chrome tabs with visible browser bars. Use `viewport-fit=cover` and `env(safe-area-inset-*)`, never rely only on `100vh`, and never require orientation lock or fullscreen.
- Sheet scrolling must not adjust life behind it. Browser Back closes an open sheet or dice result before leaving a game.
- After locking the phone, switching apps or opening the camera, reconcile before accepting input. A suspended socket may never fire a clean close.
- Joining never requires installing an app or granting camera permission. Copy link and JSON download/import work through ordinary browser controls.
- Be gentle on battery: pause decorative motion when hidden, keep updates scoped to affected panels, and avoid large animated blur layers.

## 8. Implementation architecture

### Stack

| Layer | As built |
| --- | --- |
| Frontend | React 19, TypeScript 6, Vite 8 |
| Styling | Plain CSS files in `src/client/styles/` with custom-property tokens; Radix Dialog for sheets |
| Animation | CSS transitions; Canvas2D dice renderer and physics written for this project |
| UI state | Zustand 5 with narrow selectors |
| Validation | Zod 4 schemas shared by client and server |
| Local persistence | IndexedDB through `idb` |
| Server | Node 24 (Docker base image `node:24-bookworm-slim`, pinned by digest), Fastify 5 with cookie, rate-limit, static and websocket plugins |
| Shared persistence | SQLite through `better-sqlite3`: WAL, foreign keys, FULL sync, transactional migrations (schema 3) |
| PWA | `vite-plugin-pwa` with prompted updates |
| Other | `qrcode` (generated locally), `@fontsource` fonts |
| Tests | Vitest (with `fake-indexeddb`), Playwright with Chromium and WebKit phone projects, `@axe-core/playwright` |
| Packages | npm with a committed lockfile; `.nvmrc` pins Node 24, `engines` allows ≥ 22.12 |

Exact versions live in `package-lock.json`. Do not add accounts, a cloud database, Redis, Kubernetes, a card database or a rules engine. One server process with one SQLite database on local storage is the supported deployment.

### Repository layout

```text
src/
  shared/              # used by client and server; no React, DOM, storage or network
    schema.ts          #   Zod contracts: game, setup, commands, admin commands, envelopes, room views
    game.ts            #   pure reducer, setup defaults, rolls, warnings, timer, recovery window
    cards.ts           #   commander card metadata schema
    permissions.ts     #   room undo eligibility
    random.ts          #   UUIDs with getRandomValues fallback, rejection-sampled integers
  client/
    main.tsx
    app/               # App.tsx (screens, sheets, toolbar), store.ts (Zustand store and local controller)
    adapters/room.ts   # room controller: session renewal, durable outbox, sockets, reconnect, clock offset
    storage/           # repository.ts (IndexedDB, profile, archives, import/export), tabIdentity.ts
    features/          # Board, Setup, PlayerDetails, CommanderQuick, Utilities, GroupLife, GameMenu,
                       # RecentGames, Rooms, Settings, AppearanceOptions, TableLayout, GameRecap,
                       # GameMoments, BrowserEnhancements and their helpers
    components/        # ui.tsx (Sheet, Field, Toggle, Icon), HoldButton, CommanderInput/Reader/Artwork,
                       # PlayerNameInput, FeatureBoundary, feedback.ts (sound and haptics)
    dice/              # DiceRoll, DiceCanvas, geometry, rounded, ivory, motion, presentation, preference
    brand/emblem.ts
    styles/            # app, theme, appearance, table-finishes, dice, fonts, home and feature styles
  server/
    index.ts           # startup and graceful shutdown
    app.ts             # HTTP/WebSocket routes, origin/CSRF checks, headers, rate limits, static assets
    service.ts         # room service: authentication, authorization, commands, receipts, retention, broadcasts
    database.ts        # SQLite setup and migrations
    config.ts          # environment validation
    cards.ts           # Scryfall proxy, queue and cache
    traffic.ts         # shared per-session/per-room command budgets
    operations.ts      # private diagnostics and scheduled verified backups
public/                # appearance.js, icons, table-finishes/ (and portrait/), font licenses
scripts/               # dev, backup, diagnostics, container/proxy/PWA/LAN smoke tests,
                       # measure-performance, check-release, generate-emblem
tests/                 # Vitest suites (*.test.ts), e2e/ Playwright specs, deployment/ ARM64 smoke image
docs/                  # architecture, deployment, testing, progress, assets, releases/, screenshots/
.github/               # workflows (ci, release, refresh-latest, migrate-image), release notes, issue template
Dockerfile, compose.yaml, compose.local.yaml, .env.example, .env.docker.example, .dockerignore
```

Architectural rules:

- The reducer (`reduceGame`) receives IDs, timestamps and random results from its caller and never reads globals, storage, sockets or the DOM. Both modes use the same commands and rules.
- View components call store actions. Only the local controller and room adapter write persistence or talk to the server.
- Optional sheets, card tools, room/QR tools, dice and game moments load as separate chunks behind `FeatureBoundary`, which offers a recoverable error if a download fails. The service worker precaches every chunk.
- The board subscribes to visible seat data so unrelated changes do not rerender every tile.

### Data contracts

`src/shared/schema.ts` is the source of truth. In summary:

- **Game** (schema version 1): ID, revision, settings, ordered player IDs (1–8), players, commanders (one or two per seat, at most 16), `damageReceived`, markers, turn, timer timestamps, `status` (`active`/`ended`), nullable `endedAt`, up to 30 rolls, 200 history entries, and 60 undo and 60 redo frames of reversible field changes.
- **Player**: ID, name (≤ 40 characters), palette color, life, poison, legacy named counters, eliminated flag. **Commander**: ID, owner, label (≤ 100), casts, optional card.
- **Commands** form a strict discriminated union (`adjust`, `set`, `groupLife`, `damage`, `damageSet`, `cast`, `castSet`, `editPlayer`, `eliminate`, `turn`, `turnTracking`, `timer`, `end`, `reopen`, `rematch`, `undo`, `redo`, `roll` and others). Room administration uses a separate union (`requestSeat`, `approve`, `reject`, `release`, `remove`, `transfer`, `lock`, `rotateCode`, and the retired `policy`).
- **Envelope**: `protocolVersion`, `roomId`, `gameId`, `operationId` (stable through retries), `baseRevision` (room revision), optional `groupId`, and `command`. Actor and role always come from the session.
- **Local profile**: installation ID, appearance, effects, audio, haptics, wake lock, seat rotations, artwork framing, table layout and auto-rotation, last mode/room, display name, Table/My seat view and local seat. Presentation preferences never enter shared game state.

Imports are limited to 2 MB and checked for schema version, structure, integer bounds and references before replacing anything. Exports omit the profile, installation ID, room credentials and cookies.

**Compatibility identifiers that must not change.** These protect existing saves, rooms and installations:

- IndexedDB database `mtg-util` (version 1) and export format `mtg-util-game` (version 1).
- SQLite file `mtg-util.sqlite` and protocol version 1 with its `x-mtg-client` header.
- Compose project `mtg-util`, service `mtg-util` and volume `mtg-util-data`.
- `localStorage` keys `command-table-appearance` and `command-table-style`.
- Historical appearance IDs: `theme` displays Gold, `gold` displays Red, `glow` is Astral silk, `tabletop` is Dragonfire and `obsidian` is Stormglass.

The GitHub repository stays `Addison16/commanders-table`. `ghcr.io/addison16/commandtable` is the primary image, with `commanders-table` kept as a compatibility image name.

## 9. Persistence and synchronization contracts

[docs/architecture.md](docs/architecture.md) holds the full detail. The essential contracts are:

### Local games

- IndexedDB is authoritative. It holds the profile, active game, previous checkpoint, ten archives, ten unfinished games, an ended-game standby snapshot, room previews and pending room envelopes.
- Each change compares the committed game ID and revision inside a read/write transaction, writes the checkpoint and the new state together, and renews an 18-second editor lease (refreshed every six seconds). BroadcastChannel improves feedback between tabs, but the transaction check is what guarantees correctness. A stale tab becomes read-only until **Use this tab** takes over. A read-only tab acquires an expired lease automatically.
- The UI previews immediately and shows a saving state. A failed write rolls back the preview and explains the error. Blocked storage falls back to memory with a visible warning.
- Switching tables saves the outgoing game in the same transaction. Ending stores the standby snapshot used for the 24-hour reopen.

### Shared rooms

- The server is authoritative; clients submit commands, never whole-state replacements. HTTP and WebSocket commands share one validation and authorization path.
- Authenticate and validate first, then look up an existing receipt for this actor and operation before any mutable role or match checks. An identical retry returns its original receipt; reusing an ID with a different payload fails. A revoked member never receives a new private snapshot.
- New operations check membership and permissions. Relative changes apply to the current state; absolute and administrative changes require the current revision. The new game, room revision, event and receipt commit in one SQLite transaction, and acknowledgements and broadcasts happen only after commit.
- The room revision is monotonic for the life of the room, including across rematches. Receipts are kept for the current and previous match and outlive the 200-entry history.
- Each room keeps at most `ROOM_RECEIPT_LIMIT` receipts behind a durable retry floor. An unknown envelope behind the floor is refused for manual review and never reapplied.
- Clients save each envelope locally (after schema validation) before sending, render pending relative changes on top of confirmed state, and remove an envelope on its acknowledgement. Requests have a 10-second deadline and are cancelled when the connection generation changes.
- After an interruption, clients retry recorded IDs, fetch the current state, then enable input. An envelope refused outright (HTTP 400/409) is set aside with a notice so it cannot block later reconnects.
- Disconnects pause input and never quietly queue new edits. **Continue a copy on this device** forks the last confirmed snapshot into an independent local game that never merges back.
- Broadcasts coalesce over 16 ms, reuse one encoded game per room state, add per-recipient membership overlays, and skip a duplicate frame for the actor who already has it.

### Server boundaries

- Origins must match `PUBLIC_ORIGIN`. State-changing HTTP and WebSocket commands require CSRF tokens, and session bootstrap requires the protocol header. Messages and commands are limited to 16 KB, with a 1 MB outbound socket buffer.
- Commands share session (60 burst, 30/s) and room (160 burst, 80/s) budgets across tabs and transports. Socket caps default to 512 overall, 64 per room and 12 per guest session.
- Room creation and join attempts have their own rate limits. Heartbeats use jittered reconnect backoff.
- Rooms expire 30 days after the last committed gameplay or administrative activity; presence and heartbeats do not extend them. A cleanup runs every minute.
- Logs contain fixed event names, route templates, request IDs and sanitized error categories. They never contain cookies, tokens, invitation URLs, player names or payloads.

## 10. Offline behavior and PWA updates

- After a successful load over HTTPS or localhost, the service worker reopens the app offline. One-device games stay fully usable offline. A shared room needs its server and follows the outage behavior above. LAN rooms work without internet if every device can reach the host.
- Plain HTTP on a LAN supports core play and saving. ID creation falls back to `getRandomValues()`, but installation, offline reopening and wake lock need a secure context.
- Only application assets are precached, including fonts, icons, finish SVGs and lazy chunks. Viewed art crops go in a separate bounded runtime cache. `/api/` responses are `no-store` and are never cached or answered with the app shell.
- Hashed assets are immutable, while HTML and the service worker revalidate.
- An update shows a prompt, waits for **Save & update** and pending saves, then asks for confirmation. It never reloads in the middle of play. Migrations preserve valid games and refuse unsupported future versions.
- iPhone users get Add to Home Screen guidance. Installed apps and browser tabs may keep separate storage.

## 11. Development, Docker and distribution

### Local development

```sh
npm ci
npm run dev          # Vite on :5173 proxying HTTP and WebSockets to the API on :8080; data in .mtg-data/
npm run lint
npm run typecheck
npm test             # Vitest unit and integration suites
npm run build        # typecheck, client build, server compile
npm start            # serve dist/ on :8080 (reads .env if present)
npm run test:e2e     # Playwright, Chromium and WebKit phone projects
npm run test:pwa     # production offline/update checks in both engines
npm run test:proxy   # HTTPS cookies, CSRF and WSS through a temporary TLS proxy
npm run test:lan     # real insecure LAN origin
docker build -t mtg-util:local . && npm run test:container
```

Phones on the LAN need the computer's address, for example `PUBLIC_ORIGIN=http://192.168.1.50:5173 ALLOW_INSECURE_HTTP=true npm run dev`. A phone's `localhost` is the phone itself. If port 8080 is already used by a running Docker install, run browser tests with a separate `PORT` and data directory.

### Docker

- The `Dockerfile` is multi-stage: install dependencies, build and prune, then a slim runtime. It runs as the non-root `node` user on `0.0.0.0:8080`, keeps data in `/data`, shuts down cleanly and has a `PORT`-aware health check on `/api/health`. The runtime image includes `scripts/backup.mjs` and `scripts/diagnostics.mjs`.
- `compose.yaml` pulls `${MTG_IMAGE:-ghcr.io/addison16/commandtable:latest}`. `compose.local.yaml` builds the checkout as `mtg-util:local`. Both use project `mtg-util`, service `mtg-util`, volume `mtg-util-data`, `init: true` and `restart: unless-stopped`. Run only one at a time.
- Configuration (see `.env.docker.example`): `PUBLIC_ORIGIN`, `ALLOW_INSECURE_HTTP`, `TRUST_PROXY_HOPS`, `ROOM_TTL_DAYS` (30), `SESSION_TTL_DAYS` (90), `MAX_CONNECTIONS` (512), `MAX_ROOM_CONNECTIONS` (64), `ROOM_RECEIPT_LIMIT` (20,000), `RETRY_REVISION_WINDOW` (10,000), `BACKUP_INTERVAL_HOURS` (24), `BACKUP_KEEP` (14) and optional `BACKUP_COPY_DIR`.
- Startup fails on contradictory settings: HTTP requires `ALLOW_INSECURE_HTTP=true`, and HTTPS requires it to be false.
- Local games live in browsers. Shared games, sessions, memberships and receipts live in the volume. Recreating the container with the same volume and origin preserves rooms; `down -v` deletes them.
- `node scripts/backup.mjs` makes a verified online SQLite backup. The server also makes verified, checksummed backups at startup when one is overdue and then every 24 hours, keeping 14. `scripts/diagnostics.mjs` reads the private `/data/operations.json`, which is refreshed every 30 seconds. Off-host protection requires mounting a separate destination.

### Publishing

- `.github/workflows/ci.yml` (**Verify**) runs on pushes to main and pull requests: lint, typecheck, unit tests, build, Playwright, PWA and proxy smokes, plus native amd64 and arm64 container smoke tests.
- `.github/workflows/release.yml` runs on `vX.Y.Z` tags. `scripts/check-release.mjs` checks that the tag matches `package.json` and the lockfile and that a license exists. The workflow then reruns Verify and pushes multi-architecture images to `ghcr.io/<owner>/commandtable` and the `commanders-table` compatibility name, tagged with the version and commit SHA, plus `stable` and `latest` for non-prerelease tags. It also attaches `compose.yaml` and `docker.env.example` to the GitHub release.
- `refresh-latest.yml` and `migrate-image.yml` are manual maintenance workflows for the package display and the past image-name migration.
- A release bumps `package.json` and `package-lock.json` together, adds `docs/releases/vX.Y.Z.md`, commits and tags. See [publishing a release](docs/deployment.md#publishing-a-release).
- **Nothing is pushed, tagged, released or published without an explicit request from the owner.** Local builds, tests and updates to a local Docker install do not need that request.
- Keep credentials, databases, backups, browser caches, generated reports and personal exports out of Git and out of Docker build contexts (`.gitignore`, `.dockerignore`).

## 12. Verification and acceptance

Write focused tests for invariants, persistence, authorization and sync failures rather than tests that repeat component internals. Combine automation with visual and touch review at phone sizes.

- **Unit and integration (Vitest)**: `domain` (reducer and rules), `store`, `storage` and `tab-identity` (IndexedDB, leases, imports), `rooms` and `room-adapter` (authority, receipts, reconnect, retention), `cards`, `dice` and `dice-motion` (geometry, physics, symmetry), `player-statuses`, `recap`, `game-moments`, `host-setup`, `operations`, `traffic` and `socket-traffic`.
- **Browser (Playwright, Chromium and WebKit phone projects)**: local play, rooms, live editing, join profiles, player save, commander art/reading/shortcuts, group life, recap, display and auto layout, appearance, dice colors, game moments, new game/rematch, recovery and sound, offline, accessibility (axe), editor tabs, and regression suites.
- **Smoke scripts**: production PWA offline and update, HTTPS proxy with WSS, a real LAN origin, and container persistence/recreation/backup/restore.
- **Viewports**: 320×568, 390×844, 844×390, 768×1024 and 1440×900, with 1–8 seats, no horizontal overflow and 44 px controls.
- **Targets**: local input under 100 ms and shared committed updates under 300 ms on a healthy LAN. Record measurements, not guarantees (`docs/performance.json`).

Record each verification with its date, counts, failures and deployment state in `docs/testing.md`. Automated browser coverage is not physical-device validation. The [physical-device checklist](docs/testing.md#physical-device-release-checklist) remains unverified: a real iPhone in Safari, a real Android phone in Chrome, installed mode, screen readers, prolonged battery and thermal behavior, and native ARM hardware.

## 13. Not built: later additions

Accounts and cross-device personal history; cloud sync of local games; deck integrations; full team formats including Two-Headed Giant; tournament or match statistics; advanced mana, storm and phase tools; dungeon and Planechase assistance; spectator links; an in-app QR scanner; shared redo; and multi-instance or network-filesystem hosting.

Keep stable IDs, the shared domain, versioned storage and clear membership boundaries so these remain possible. Do not build speculative frameworks for them.

## 14. Changes from the original specification

These decisions were made during development, mostly at the owner's request, and supersede the September 15 plan:

| Original plan | As built |
| --- | --- |
| Host can manage every seat in a room; optional "Friends can edit every seat" policy | Every approved player, including the host, edits only their own seat. The policy was removed: legacy values are ignored and enabling it is rejected. |
| Host status never transfers automatically | It still never transfers on disconnect. When the host's session expires, cleanup promotes the longest-seated approved member. |
| Include the recipient's own commander among damage sources | Own commanders are excluded and the reducer rejects them. |
| Extra trackers (energy/experience/rad/custom counters, Monarch/Initiative) in Utilities | Removed from the UI. Legacy data is still read and displayed. |
| Turn highlight and timer always available | Turn tracking is opt-in with **Next turn** beside Undo. The timer is in Utilities. |
| Home with One device / Shared room cards | Quick 4 and Quick 2 starts plus Create/Join room on one screen; **New game** asks One phone or Multiple phones. |
| Shared undo by the host regardless of actor | Undo is limited to the actor's own eligible action, plus the host's own table-control actions. |
| CSS/SVG dice with Motion; 3D optional | Canvas2D 3D dice with rigid-body physics and no animation library. Motion for React, CSS Modules and React Testing Library were not adopted. |
| Searchable cards and art as a later addition | Optional Scryfall artwork, card reader and rulings are built in. |
| Single theme | Light/dark/system appearance with themes, accents, table finishes and coordinated looks. |
| — | Added: commander Damage/Tax shortcuts, status badges, group life change, recap PNG, 24-hour reopen, elimination notice and winner screen, seat profiles at join, automatic rotation layouts, verified automatic backups and private diagnostics. |
| Working name MTG Util; registry destination undecided | Command Table, published as `ghcr.io/addison16/commandtable` under PolyForm Noncommercial 1.0.0. Internal `mtg-util` identifiers remain. |

## 15. Working on this codebase

When continuing development:

- Read this file, then the relevant section of `docs/architecture.md`, before changing behavior. Keep phones first, and keep both play modes on the shared domain.
- Add every new game behavior as a validated command in `src/shared/schema.ts`, applied by the pure reducer. Keep server authorization, receipts and revision rules identical over HTTP and WebSocket.
- Never change the compatibility identifiers in section 8. Give storage or schema changes a migration that preserves existing data, and record rollback limits in the docs.
- Do not replace anonymous browser/session persistence with accounts or fingerprinting, and do not add external services to core play.
- Verify with lint, typecheck, unit tests, build, the relevant Chromium/WebKit cases and smoke scripts. Record actual results and any limitations in `docs/testing.md`. Update the README, the docs and this file when behavior changes.
- Present Docker/Compose installation and `latest` updates first in user-facing docs. When updating a running install, keep its Compose project, data volume and public origin, and take a verified backup first.
- Publishing (pushes, tags, releases, images) is a separate step that happens only when the owner explicitly asks.
