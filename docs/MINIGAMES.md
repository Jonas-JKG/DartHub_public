# Minigames

`/minigames` replaces the DartDeck section with shared lobbies for **DartDeck**
**Dart Bingo**, **Tic-Tac-Toe** and **Connect Four**. Old `/dartdeck` links redirect to the matching new route. Existing
card games, accounts, account invitations, local players and saved Autodarts profiles
remain usable. Invitations appear through Friends. No public join codes are added.

## Lobby and play

Choose the mode, difficulty and mode-specific rules before creating a lobby. The host
or Admin can edit rules and participants while waiting. Everyone invited must accept
or be removed before starting. A rematch returns to the same lobby, permits changing
mode and retains the last result. Lobbies can be deleted from their overview.

Bingo uses the same full-screen match toolbar, settings drawer, three dart slots,
correction/undo/confirmation, board/keypad, camera and automatic takeout as DartDeck.
New Bingo games show the active player's own grid, with the same target layout for
everyone. The player list shows each player's own marked cells and completed lines. There is no average or card Skip vote in Bingo.

## Dart Bingo

New games use identical 4×4 or 8×8 target layouts but independent marks per player.
Only the active player's own board is shown. Other players' hits never occupy or
block cells on that board. Player colors are kept for identification.

A hit marks **every compatible occurrence** of that number on the player's board.
A plain number accepts any ring; D/T targets require the specified multiplier.
For example, D20 marks all D20 and unrestricted 20 cells, but no T20 cells.
Repeated hits on already marked cells add no score. Draft marks are replayed from
recorded darts, so correction and undo remove all affected unconfirmed marks while
preserving previously confirmed visits.

Difficulty remains Easy (any ring), Medium (one quarter doubles), or Hard (half
doubles, half triples). Choose one line, two lines, or full house, including with
multiple players. After the first confirmed goal, the current round finishes so
all players have equal turns and may share the win.

New games carry `bingo.markAll: true` and no shared ownership flag. Existing shared
color games and older one-cell-per-hit games retain their recorded rules until
finished; the next new game/rematch uses the new independent marking rules. No SQL
migration is required.

## Data and compatibility

The existing private tables and SQL functions from migrations 024–025 store the
mode/settings and game state as JSON. No new migration or environment variable is
required. Old settings without a mode mean DartDeck. New games add an optional
`bingo` state while retaining the common game/players/current/visits/nonce fields.
Authenticated membership/controller checks, expected versions, SQL row locks and
private camera authorization remain in force. Mode changes during play are denied.

The Autodarts provider endpoints, parser, ticket flow and takeout safeguards are
unchanged. Existing school-device WebSocket restrictions still require school IT
to allow WSS to play.ws.autodarts.com:443. A real-board hardware check remains needed.

## Tic-Tac-Toe and rematch records

Exactly two accepted account/local players share one 3×3 grid as X and O. Each turn
allows exactly one dart for one free cell; the first matching target locks the
turn until confirmation, with corrections/undo still available. Targets of free cells
reroll after both players have taken a turn. Occupied cells never move or change
owner. Three own marks in a row/column/diagonal win; a full grid without a line is a
draw. Difficulty selects unrestricted targets, three doubles, or all D/T targets.

Every new start retains a flat list of previous finished result snapshots in the
existing private game JSON. Future card decks are omitted from those snapshots.
Finished results and the waiting lobby show every retained rematch, its participants,
mode, result, visits, darts and timestamp when available. Old versions retained only
the latest result: older overwritten matches cannot be recovered. No SQL migration
is needed. The right-hand player list includes the active player in every mode.

## Connect Four and one-dart duel turns

Connect Four uses two accepted account/local players on a 7×6 board. A hit on a
column's displayed number/ring previews one coin in its lowest free cell; one dart
is permitted per turn, including misses and full-column hits. Those invalid placements
consume the turn without a coin or an API error. Confirmation/takeout commits the
move. Targets reroll after both players have taken a turn, while all coins remain
fixed. Four own coins horizontally, vertically or along either diagonal win; a full
board without a line draws. The board shows a CSS gravity drop with a small bounce,
without replaying it on ordinary polling; reduced-motion preferences disable it.

Tic-Tac-Toe now also permits only one dart even when it misses. Pending darts from
an older game remain correctable and confirmable; no further darts can be appended.
Shared manual/Autodarts inputs use the same domain limit, and extra provider throws
are consumed without pausing automatic scoring. Existing match history and private
camera/participant/controller/SQL version safeguards also apply to Connect Four.
No migration or environment variable is added.

The inline account picker uses intrinsic grid rows and start alignment, bounded
native touch scrolling, and compact input/button heights. Local-player fields no
longer stretch to the full account-list height. Empty immediate-pick counters are
hidden. These account-list scrolling improvements also apply to other invitations.
