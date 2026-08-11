# 🏥 FRONT-END HOSPITAL

### The Website Is Sick. Can You Save It?

A **real-time multiplayer** classroom game. One host opens an Emergency Room, up to
**12 students** join from their own phones or laptops, and each one claims **one sick
website** to diagnose. Every change is shared instantly: the moment Doctor 1 takes
Patient 04, everyone else sees `🔒 TAKEN` and can no longer choose it.

```
Landing → Create / Join → Hospital Lobby → 🚨 Emergency Alert → 12 Patient Cards
→ Choose ONE Patient → Patient LOCKED globally → Private Patient File → Diagnosis
→ Medical Conference → Reveal → Leaderboard → 🚨 Final Emergency
```

---

## Table of contents

1. [The stack, and why](#1-the-stack-and-why)
2. [Quick start](#2-quick-start)
3. [Playing with several devices](#3-playing-with-several-devices)
4. [Project structure](#4-project-structure)
5. [Environment variables](#5-environment-variables)
6. [How the multiplayer actually works](#6-how-the-multiplayer-actually-works)
7. [The 12 patients](#7-the-12-patients)
8. [Running the game — a host's script](#8-running-the-game--a-hosts-script)
9. [Host control panel](#9-host-control-panel)
10. [Scoring](#10-scoring)
11. [Tests](#11-tests)
12. [Deployment](#12-deployment)
13. [Troubleshooting](#13-troubleshooting)
14. [Extending the game](#14-extending-the-game)

---

## 1. The stack, and why

| Layer | Choice |
|---|---|
| Realtime | **Socket.IO** over WebSockets (auto-fallback to polling) |
| Server | **Node.js + Express**, server-authoritative game state |
| Storage | In-memory, with periodic **JSON snapshots to disk** for crash recovery |
| Client | **Vanilla ES modules**, zero build step |
| Styling | Hand-written CSS with custom properties |

**Why not Firebase or Supabase?** Both would work, but both need you to create an
account, provision a project, paste credentials into a config file, and write
security rules — and if you get the rules wrong, students can read one another's
patient files or edit their own score. Here the entire game runs in **one Node
process**, and Node executes JavaScript on a single thread: it never interrupts a
function halfway through. That property alone makes patient reservation atomic
without a single database transaction, and it means:

- **no accounts, no API keys, nothing to configure** — `npm install && npm start`
- **the answer key never leaves the server** unless the host reveals it
- **works fully offline**, on a classroom Wi-Fi with no internet at all

**Why no front-end framework?** Your students read this code. It is the same HTML,
CSS and vanilla JS they are learning, just organised.

---

## 2. Quick start

**Requirements:** Node.js **18.17 or newer** (`node --version`).

```bash
cd front-end-hospital
npm install
npm start
```

That is the whole setup. There is **no database to create**, **no `.env` file
required**, and **no credentials to obtain anywhere**.

The terminal prints something like:

```
  🏥  FRONT-END HOSPITAL — Emergency Room online
  ─────────────────────────────────────────────
  Host screen   →  http://localhost:3000/host
  Join screen   →  http://localhost:3000/join
  Landing page  →  http://localhost:3000/

  Students on the same Wi-Fi should open:
    →  http://192.168.0.101:3000/join
```

| Who | Opens | Does |
|---|---|---|
| **You (host)** | `http://localhost:3000/host` | A room opens **automatically**, showing a code like `FH-4827` |
| **Students** | `http://<your-ip>:3000/join` | Type a doctor name + the room code |

For development with auto-restart on file changes:

```bash
npm run dev
```

---

## 3. Playing with several devices

### On the same Wi-Fi (a normal classroom)

1. Run `npm start` on your laptop.
2. Read the LAN address it printed, e.g. `http://192.168.0.101:3000/join`.
3. Write that address (or the room code) on the board. Students open it on their
   phones. **They install nothing.**

> **Windows firewall:** the first run may pop up a firewall prompt. Allow Node.js
> on **private networks**, or students will not be able to connect. If you missed
> the prompt: *Windows Security → Firewall & network protection → Allow an app
> through firewall → Node.js → tick Private*.

### Testing it alone, right now

You do not need 12 devices to see the multiplayer working:

1. Open `http://localhost:3000/host` in a normal window.
2. Open **3 or 4 incognito / private windows** at `http://localhost:3000/join`.
   Incognito windows have separate `localStorage`, so each is a separate doctor.
   (Different browsers — Chrome, Edge, Firefox — work too.)
3. Join with a different name in each.
4. Arrange the windows side by side, press **START EMERGENCY** on the host, and
   click **CHOOSE PATIENT** on the same card in two windows at once.

One wins. The other gets `Patient already taken.` — instantly, in every window.

---

## 4. Project structure

```
front-end-hospital/
├── server/
│   ├── index.js              Express + HTTP entry point, static files, /api routes
│   ├── realtime.js           Every Socket.IO event; identity & permission checks
│   ├── config.js             Environment configuration with defaults
│   ├── game/
│   │   ├── rooms.js          THE source of truth: rooms, atomic claim, state views
│   │   ├── patients.js       The 12 cases + the final patient + answer keys
│   │   ├── phases.js         The 8 phases
│   │   └── scoring.js        Rubric, auto-grader suggestions, leaderboard
│   └── util/
│       ├── ids.js            Room codes, public ids, secret tokens
│       └── sanitize.js       Input cleaning for anything a student types
│
├── public/                   Served as-is. No build step.
│   ├── index.html            Landing page
│   ├── host.html             Host control panel
│   ├── join.html             Student join screen
│   ├── play.html             Doctor station
│   ├── 404.html
│   ├── css/
│   │   ├── theme.css         Design tokens, base layer
│   │   ├── components.css    Panels, patient cards, tables, leaderboard…
│   │   └── animations.css    ECG, sirens, cinematics, confetti canvas
│   └── js/
│       ├── bus.js            Shared clock + connection status (no transport)
│       ├── net.js            The socket, promise-based emit, session storage
│       ├── ui.js             DOM helpers, toasts, the synchronised countdown
│       ├── evidence.js       Renders code / console / files / screenshots
│       ├── cinematic.js      The Emergency Alert sequence
│       ├── sound.js          Web-Audio cues (mutable, no audio files)
│       ├── confetti.js       Canvas particle burst
│       ├── join.js           Join screen logic
│       ├── play.js           Doctor station — all 8 phase screens
│       └── host.js           Host control panel
│
├── test/
│   ├── multiplayer.test.js   Real sockets: races, privacy, permissions, resume
│   ├── render.test.js        Evidence rendering + highlighter safety
│   ├── screens.test.js       Real server projections → real player screens
│   └── host-screens.test.js  …and the host panel
│
├── Dockerfile
├── render.yaml
├── .env.example
└── package.json
```

---

## 5. Environment variables

**All optional.** Copy `.env.example` to `.env` only if you want to change something.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `PUBLIC_ORIGIN` | *(empty)* | Only needed behind a proxy that rewrites the host header |
| `MAX_PLAYERS` | `12` | Doctors per room (hard ceiling is 12) |
| `MIN_PLAYERS` | `2` | Minimum before **START EMERGENCY** unlocks |
| `ROOM_TTL_MINUTES` | `240` | How long an empty room survives before cleanup |
| `DATA_DIR` | `.data` | Where crash-recovery snapshots are written |
| `PERSIST` | `true` | Set `false` for pure in-memory mode |

**There are no secrets, no API keys and no third-party credentials anywhere in
this project.**

---

## 6. How the multiplayer actually works

### The reservation is atomic — structurally, not by luck

All 12 patient slots live in one `Map` in one Node process, and the claim runs
inside one synchronous function ([`server/game/rooms.js`](server/game/rooms.js)):

```js
// ── the critical section ──
if (slot.takenBy && slot.takenBy !== player.id) {
  fail('TAKEN', `Patient already taken — Doctor ${owner.name} got there first.`);
}
slot.takenBy = player.id;
slot.takenAt = now();
player.patientId = slot.id;
// ── end critical section ──
```

Node never interrupts a function mid-execution. Two clicks in the same
millisecond are still two separate turns of the event loop, so the second one
sees `takenBy` already set. There is no window to lose. This is verified by a
test that fires **eight simultaneous claims at the same patient** and asserts
exactly one succeeds.

### Clients cannot lie about who they are

At join time the server issues a public `playerId` and a **secret token**. The
token is stored in that browser's `localStorage` and never appears in any
broadcast. The socket's identity is bound once, from the token, and every
handler reads it from `socket.data` — never from the message:

- a player asking to submit a diagnosis cannot say *whose* diagnosis it is
- a player emitting `host:score` is rejected with `NOT_HOST`
- knowing the room code is not enough to become the host

### Students only receive what they are allowed to see

The server keeps **two projections** of a room. A player's payload contains
their own patient file and nothing else — no other doctor's evidence, no
submissions, and no answer key at all. The host's payload contains everything.
This is enforced at the point the state is built, not by hiding things in CSS.
Tested: a player's entire wire payload is searched for the other patient's
evidence and disease names.

### One clock for the whole room

The server broadcasts an **absolute deadline** (`endsAt`), never a countdown
value. Each browser measures its own offset from the server clock with a small
round-trip ping and renders `endsAt − serverNow()`. A phone whose system clock
is four minutes off still shows the same number as the projector.

### A refresh costs nothing

Disconnecting does **not** remove a player. Their patient stays reserved, their
diagnosis stays filed, their score stays. On reconnect the browser presents its
token again and walks straight back into the room, at the right phase. The
server also snapshots every room to `.data/rooms.json` every few seconds, so
even restarting the server mid-class does not end the game.

---

## 7. The 12 patients

Students see only `PATIENT 01 · CLASSIFIED` until they claim a case. The disease
names below are **never shown** to them until the Reveal phase.

| # | Patient | Condition | Evidence they get |
|---|---|---|---|
| 01 | Bakery Order Form | Form validation failure | HTML + screenshot |
| 02 | Travel Landing Page | Responsive design failure | Screenshot + HTML head + CSS |
| 03 | Newsletter Widget | Wrong selector & script timing | Console error + HTML + JS |
| 04 | E-Commerce Site | Broken file path | Folder tree + HTML + console + note |
| 05 | Results Portal | CSS overflow / box model | Screenshot + CSS |
| 06 | Booking Modal | Invisible element (opacity + z-index) | Console + CSS + JS |
| 07 | Photo Portfolio | Performance / asset weight | Network table + HTML |
| 08 | Restaurant Menu | Flexbox axis confusion | CSS + screenshot + design note |
| 09 | To-Do App | Event listener never attached | JS + empty console + triage note |
| 10 | Registration Form | Wrong input types | HTML + mobile keyboard screenshot |
| 11 | Conference Site | Broken navigation & anchors | HTML + folder tree + console |
| 12 | Developer Blog | Dark mode toggle failure | JS + CSS + Elements panel |
| 🚨 | **MEDCART** | **Five faults at once** | Everything, for everyone |

Evidence is **deliberately not uniform**. Some cases are a screenshot only, some
are pure code, some are a folder tree, some are a single console error — because
reading whichever clue you happen to be handed *is* the skill.

> Screenshots are rendered as live HTML mocks inside a sandboxed `<iframe>`
> rather than shipped as PNGs. They stay crisp on every display, the repo stays
> tiny, and there is nothing that can 404.

---

## 8. Running the game — a host's script

**Phase 1 · Waiting Room.** Open `/host`. A room opens by itself. Read the code
out, or share the join link. Watch doctors appear live.

**Phase 2 · Emergency Alert.** Press **🚨 START EMERGENCY**. A short cinematic
plays on *every* screen at once. Let it run — it is the moment the room goes quiet.

**Phase 3 · Patient Selection.** Advance to Patient Selection. Twelve classified
cards appear everywhere. Start a **90-second timer** from the sidebar for pressure.
Cards flip to `🔒 TAKEN` in real time. Say nothing; let them discover that
first-click-wins is real.

**Phase 4 · Diagnosis.** Advance. Each doctor now sees a file only they can see.
Start a **10-minute timer**. Their answers autosave as drafts.

**Phase 5 · Medical Conference.** Advance. Use **🔀 Shuffle order**, then give
each presenter **⏱ 60s**. The current presenter's own screen says *"Your turn to
present"* with their notes laid out in the order they should say them.

**Phase 6 · Reveal.** Go to the **Reveal** tab and reveal **one patient at a
time** while you discuss it. Each reveal shows the model answer, that doctor's
answer, and their score side by side.

**Phase 7 · Leaderboard.** Advance. Podium, confetti, per-doctor cards.

**Phase 8 · Final Patient.** Advance. One site, five faults, everyone at once.
Start a 10-minute timer. Collect findings in the **Final patient** tab, then
reveal the post-op report.

---

## 9. Host control panel

Everything in the requirements, in one screen:

- **Create Room** (automatic on opening `/host`), copyable code and join link
- **Start / next phase**, plus a clickable rail to jump to any of the 8 phases
- **Pause / Resume** — every student screen switches to a paused state
- **Lock patient selection** · **Allow re-picking** · **Re-open a diagnosis**
  (globally or for one named doctor)
- **Reset a patient** — frees it for someone else
- **Remove a doctor**
- **Shared timer**: presets, custom seconds, ±30s, pause, resume, stop
- **Ward view** — all 12 patients, who holds each, who has submitted
- **Doctors view** — live roster, connection state, per-doctor actions
- **Reports & scoring** — every submission next to the answer key, with the
  0–5 rubric pickers, bonus, approve / reject, and a written note
- **Reveal** — one patient at a time, or all at once
- **Leaderboard** — full breakdown table
- **Final patient** — team/individual mode, collected findings, answer key
- **Log** — a timestamped record of everything that happened in the room
- **Restart** (keep doctors or clear the room) · **End game** · **🎉 confetti**

---

## 10. Scoring

Grading is a **human act**. The host awards points:

| Criterion | Points |
|---|---|
| Correct Diagnosis | +5 |
| Correct Cause | +5 |
| Correct Treatment | +5 |
| Good Explanation | +5 |
| **Maximum** | **20 per doctor** |

Plus an optional ±5 bonus, an Approve/Reject mark, and a free-text note the
student sees at Reveal.

**✨ Suggest score** compares the answer against the case's keyword lists and
pre-fills a *suggestion* — deliberately conservative, and it never writes a score
on its own. The host always has the last word. (There is a test asserting that
asking for a suggestion does not grade anybody.)

---

## 11. Tests

```bash
npm test
```

44 tests, no mocks where it matters — the multiplayer suite runs a real server
and real sockets. Highlights:

- `THE RACE: eight doctors slam the same patient — exactly one wins`
- `a player never receives another doctor's patient file or any answer key`
- `a player cannot act as the host`
- `a stolen player id without the token is refused`
- `a refresh restores identity, patient, diagnosis and score`
- `the shared timer is expressed as an absolute server deadline`
- `highlight() never emits live markup from a snippet`
- `each case is complete, distinct and keeps its disease name out of the file`

The screen tests are worth knowing about: they take the **real projection the
server would send** and push it through the **real client renderers**, so a
mismatch between server and UI fails the build rather than the lesson.

---

## 12. Deployment

The game needs **WebSockets** and **a single instance** (state lives in one
process — do not scale it to 2+ replicas without adding a shared store).

### Render (free tier works)

The repo contains `render.yaml`. In Render: **New → Blueprint → point at the
repo**. Or manually:

- Build: `npm ci --omit=dev`
- Start: `node server/index.js`
- Health check: `/api/health`

### Railway / Fly.io / any Node host

- Build: `npm ci --omit=dev`
- Start: `node server/index.js`
- Set `PORT` if the platform does not inject it.

### Docker

```bash
docker build -t front-end-hospital .
docker run -p 3000:3000 -v feh-data:/app/.data front-end-hospital
```

### Behind Nginx (WebSockets need the upgrade headers)

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade    $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host       $host;
  proxy_read_timeout 3600s;
}
```

> On a free/ephemeral host, set `PERSIST=false` — the filesystem is wiped on
> every restart, so snapshots buy nothing there.

---

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Students cannot reach the LAN address | Windows firewall | Allow Node.js on **private** networks |
| `EADDRINUSE` on start | Port 3000 is busy | `PORT=3001 npm start` |
| "No emergency room with that code" | Server restarted with `PERSIST=false`, or a typo | Re-open `/host` for a fresh code |
| Everyone is the same doctor in one browser | Tabs share `localStorage` | Use incognito windows or different browsers |
| Nothing happens on the students' screens | They are on a different network (guest Wi-Fi) | Put every device on the same network |
| No sound | Browsers block audio until a click | Click anywhere once; 🔊 in the top bar toggles it |
| Copy link button does nothing | `http://` on a LAN IP is not a secure context | It falls back automatically; otherwise select the field and copy manually |

---

## 14. Extending the game

**Add a 13th case:** append an object to `PATIENTS` in
[`server/game/patients.js`](server/game/patients.js) — `symptoms`, `evidence`
(mix the kinds!), and an `answer` with `keywords`. Nothing else needs touching;
the ward, the reveal and the host panel all read from that array.

**Change the rubric:** edit `RUBRIC` in
[`server/game/scoring.js`](server/game/scoring.js). The host's point pickers and
the leaderboard columns follow it automatically.

**Team mode for the final patient:** the toggle and the `mode` field already
exist and are broadcast to every client; grouping doctors into teams is the
piece left to write.

---

## License

MIT. Use it in your classes, change the patients, make it yours.
