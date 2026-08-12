# 🏥 FRONT-END HOSPITAL

### The Website Is Sick. Can You Save It?

A **real-time multiplayer** classroom game that runs over the internet. One person
opens an Emergency Room from any device, up to **12 students** join from their own
phones or laptops **on any network**, and each one claims **one sick website** to
diagnose. Every change is shared instantly: the moment Doctor 1 takes Patient 04,
everyone else sees `🔒 TAKEN` and can no longer choose it.

```
                          INTERNET
                             │
                  ┌──────────────────────┐
                  │   ONE Node process   │
                  │  Express + Socket.IO │
                  │  all game state here │
                  └──────────┬───────────┘
        ┌──────────┬─────────┼─────────┬──────────┐
        │          │         │         │          │
      HOST      DOCTOR 1  DOCTOR 2  DOCTOR 3 … DOCTOR 12
     laptop      laptop    phone     tablet     phone
      Wi-Fi      Wi-Fi   mobile data  Wi-Fi   mobile data
```

Everyone connects to the same server and the same room. Nobody installs anything.

---

## Read this first

**The game only works across networks once the server is deployed.** Running
`npm start` on your laptop gives you `http://localhost:3000`, and `localhost`
means *this machine* — it is not an address anyone else can reach, no matter
which network they are on. Same for `192.168.x.x`: that is your home Wi-Fi's
private numbering, invisible from outside your house.

There is nothing to fix in the code for this. Deploy the server once
([§ Deployment](#deployment)), and every link the app produces automatically
points at the public URL.

---

## Table of contents

1. [Quick start (local)](#quick-start-local)
2. [Deployment](#deployment)
3. [Running a session: host and students](#running-a-session)
4. [How the multiplayer works](#how-the-multiplayer-works)
5. [Project structure](#project-structure)
6. [Environment variables](#environment-variables)
7. [The 12 patients](#the-12-patients)
8. [Scoring](#scoring)
9. [Tests](#tests)
10. [Troubleshooting](#troubleshooting)
11. [Extending the game](#extending-the-game)

---

## Quick start (local)

For developing and for trying it out on one machine.

**Requires Node.js 18.17+** (`node --version`).

```bash
cd front-end-hospital
npm install
npm start
```

No database to create, no `.env` needed, no credentials anywhere.

| Who | Opens |
|---|---|
| Host | `http://localhost:3000/host` |
| Students | `http://localhost:3000/join` |

To see the multiplayer without 12 devices: open `/host` in a normal window and
three or four **incognito windows** at `/join` (incognito windows have separate
storage, so each is a separate doctor). Click `CHOOSE PATIENT` on the same card
in two windows at once — one wins, the other is told `Patient already taken`.

Auto-restart while editing: `npm run dev`.

---

## Deployment

### Render — the recommended path

The repo contains `render.yaml`, so this is a five-minute job.

1. Push this project to a GitHub repository.
2. Go to **[dashboard.render.com](https://dashboard.render.com)** → **New** →
   **Blueprint**.
3. Connect the repository. Render reads `render.yaml` and fills everything in:
   build `npm ci --omit=dev`, start `npm start`, health check `/api/health`.
4. Click **Apply**. First build takes 1–2 minutes.
5. You get a public URL, e.g. `https://front-end-hospital.onrender.com`.

That URL is now the game. **Nothing needs configuring** — no API keys, no
database, no origin settings.

If you would rather not use the Blueprint, create a **Web Service** manually with:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Instances | **1 — see the warning below** |

### ⚠️ One instance only

All game state (rooms, patients, who holds what, phases, timers, scores) lives in
the memory of a **single Node process**. Two instances behind a load balancer
would be two separate hospitals — the host would land in one, half the students
in the other, and nothing would appear to sync. Do not enable autoscaling or
raise the instance count.

Scaling beyond one instance is possible but is a real change: it needs a shared
store (Redis) plus the Socket.IO Redis adapter. For a classroom of 12, one
instance is far more capacity than you need.

### ⚠️ Free tier: the server sleeps

Render's free tier stops the instance after ~15 minutes with no traffic. The next
visitor waits **up to a minute** while it wakes. If twelve students all open the
link at once on a sleeping server, it looks broken.

**Open `/host` two minutes before class** to wake it, and leave the tab open.
The app now shows *"Waking the hospital server… this can take up to a minute"*
instead of a connection error, but the wait is still real.

A paid instance ($7/mo) never sleeps and can also keep snapshots on a disk.

### Other platforms

Anything that runs a long-lived Node process with WebSocket support works:
**Railway**, **Fly.io**, **a VPS**, **Heroku**.

- Build `npm ci --omit=dev`, start `npm start`.
- `PORT` is read from the environment; the server binds `0.0.0.0` so it is
  reachable inside a container.

**Will NOT work:** GitHub Pages, Netlify, Vercel static hosting, or any
static-file host. There is a real server here that must stay running — a static
host has nowhere to run it.

### Docker

```bash
docker build -t front-end-hospital .
docker run -p 3000:3000 -e PERSIST=true -v feh-data:/app/.data front-end-hospital
```

### Behind Nginx (VPS only)

WebSockets need the upgrade headers forwarded:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade    $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host       $host;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 3600s;
}
```

---

## Running a session

Replace `DOMAIN` with your deployed URL.

### The host

Open **`https://DOMAIN/host`** on a laptop.

You will see **CREATE GAME**. Press it once — a room opens with a code like
`FH-4827` and a join link ready to copy.

The host does **not** need to be the person who deployed the project, and nothing
runs on their machine. Send `https://DOMAIN/host` to a colleague and they can run
the whole session from their own device on their own network.

**The host key.** In the room panel there is a collapsed section, *🔑 Host key —
keep private*. It contains a link like
`https://DOMAIN/host?room=FH-4827&key=…`. Opening that link on **another
device** moves control of the running room there. Use it if you switch laptops
mid-session or your browser loses its storage.

> Treat that link like a password. Anyone who opens it becomes the host of your
> room. Never paste it in the class chat — the students' link is the other one.

### The students

Send them **`https://DOMAIN/join`** plus the room code, or the direct link which
fills the code in for them. All three of these work:

```
https://DOMAIN/join/FH-4827
https://DOMAIN/join?room=FH-4827
https://DOMAIN/join?code=FH-4827
```

They enter a doctor name, press **JOIN HOSPITAL**, and wait in the lobby.

### The eight phases

The host drives the room with the **`Next phase →`** button; everyone else
follows automatically.

| # | Phase | What the host does |
|---|---|---|
| 1 | Waiting Room | Wait for doctors, then **🚨 START EMERGENCY** |
| 2 | Emergency Alert | Let the ~9s cinematic play, then **`Next phase →`** |
| 3 | Patient Selection | Optionally start a 1-minute timer; wait for 12/12 |
| 4 | Diagnosis | Start a 10-minute timer |
| 5 | Medical Conference | **🔀 Shuffle order**, **⏱ 60s**, **Next presenter →** |
| 6 | Reveal | **Reveal** one patient at a time; score in **📋 Reports** |
| 7 | Leaderboard | Podium and confetti fire automatically |
| 8 | Final Patient | One site, five faults, everyone at once |
|  | End | **🏁 End game** |

Nothing advances by itself. After **End game**, stop pressing buttons.

---

## How the multiplayer works

### Nothing is hard-coded to any machine

The client opens its socket with `io()` — **no URL**. Socket.IO connects back to
the exact origin that served the page. The same build talks to `localhost` when
served from localhost and to your Render domain when served from there. Every
shareable link is built from `window.location.origin` for the same reason.

There is no address, IP or hostname anywhere in the client code. You can verify:

```bash
grep -rn "localhost\|127.0.0.1\|192.168" public/
```

### The reservation is atomic by construction

All 12 patient slots live in one `Map` in one Node process, and the claim runs
inside one synchronous function (`server/game/rooms.js`):

```js
// ── the critical section ──
if (slot.takenBy && slot.takenBy !== player.id) {
  fail('TAKEN', `Patient already taken — Doctor ${owner.name} got there first.`);
}
slot.takenBy = player.id;
player.patientId = slot.id;
// ── end critical section ──
```

Node never interrupts a function mid-execution, so two clicks in the same
millisecond are still two separate turns of the event loop and the second one
sees `takenBy` already set. A test fires **eight simultaneous claims** at one
patient and asserts exactly one succeeds.

### Clients cannot lie about who they are

At join time the server issues a public `playerId` and a **secret token**. The
token is stored in that browser and never appears in any broadcast. A socket's
identity is bound once, from the token, and every handler reads it from
`socket.data` — never from the message. So:

- a player cannot submit a diagnosis as someone else;
- a player emitting `host:score` is refused with `NOT_HOST`;
- **knowing the room code is not enough to become the host** — the host token is
  a separate secret, and a test asserts eleven different host commands are all
  refused for a player who knows the code.

### Students only receive what they may see

The server keeps **two projections** of a room. A player's payload contains their
own patient file and nothing else — no other doctor's evidence, no submissions,
no answer key. The host's payload contains everything. Enforced where state is
built, not by hiding things in CSS.

### One clock for the whole room

The server broadcasts an **absolute deadline**, never a countdown. Each browser
measures its own offset from the server clock with a small round-trip ping. A
phone whose system clock is four minutes off still shows the same number as the
projector.

### Rooms are isolated

Each room is keyed by its code and each socket joins only that room's channels. A
host token is bound to one room, not to "being a host". Tested.

### A refresh or a dropped connection costs nothing

Disconnecting does **not** remove a player: their patient stays reserved, their
diagnosis stays filed, their score stays. On reconnect the browser presents its
token again and walks straight back in, at the right phase. This is why a phone
locking its screen, or a student walking through a dead spot, is a non-event.

### Where state does *not* live

`localStorage` holds only **identity** — room code, player id, secret token, and
the sound preference. No game state. Clearing it logs you out; it cannot
desynchronise the game, because the browser is not the source of truth for
anything.

---

## Project structure

```
front-end-hospital/
├── server/
│   ├── index.js              Express, static files, /api routes, 0.0.0.0 bind
│   ├── realtime.js           Every Socket.IO event; identity & permission checks
│   ├── config.js             Environment configuration with defaults
│   ├── game/
│   │   ├── rooms.js          THE source of truth: rooms, atomic claim, state views
│   │   ├── patients.js       The 12 cases + the final patient + answer keys
│   │   ├── phases.js         The 8 phases
│   │   └── scoring.js        Rubric, auto-grader suggestions, leaderboard
│   └── util/{ids,sanitize}.js
│
├── public/                   Served as-is. No build step.
│   ├── index.html  host.html  join.html  play.html  404.html
│   ├── css/{theme,components,animations}.css
│   └── js/
│       ├── bus.js            Shared clock + connection status (no transport)
│       ├── net.js            The socket, URL helpers, session storage
│       ├── ui.js             DOM helpers, toasts, the synchronised countdown
│       ├── evidence.js       Renders code / console / files / screenshots
│       ├── cinematic.js  sound.js  confetti.js
│       └── join.js  play.js  host.js
│
├── test/
│   ├── deployment.test.js    Spawns the real server; networking + the 14 checks
│   ├── multiplayer.test.js   Races, privacy, permissions, resume
│   ├── render.test.js        Evidence rendering, highlighter safety, URL helpers
│   ├── screens.test.js       Real server projections → real player screens
│   ├── host-screens.test.js  …and the host dashboard
│   └── host-entry.test.js    The /host entry screen and host-key recovery
│
├── Dockerfile  render.yaml  .env.example  package.json
```

---

## Environment variables

**All optional.** Copy `.env.example` to `.env` only to change something.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Injected by the platform. Never hard-code it. |
| `HOST` | `0.0.0.0` | Bind address. **Do not change** — a container needs `0.0.0.0`. |
| `MAX_PLAYERS` | `12` | Doctors per room (hard ceiling 12) |
| `MIN_PLAYERS` | `2` | Minimum before **START EMERGENCY** unlocks |
| `ROOM_TTL_MINUTES` | `240` | How long an empty room survives |
| `PERSIST` | `true` | Set **`false`** on Render free — its disk is ephemeral |
| `DATA_DIR` | `.data` | Where snapshots are written when `PERSIST=true` |
| `PUBLIC_ORIGIN` | *(empty)* | Cosmetic only — prints your real URL in the boot log. The browser never needs it. |

No secrets, no API keys, no third-party credentials anywhere in this project.

---

## The 12 patients

Students see only `PATIENT 01 · CLASSIFIED` until they claim a case. The
condition names below are **never shown** to them until Reveal.

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
are pure code, some a folder tree, some a single console error — because reading
whichever clue you happen to be handed *is* the skill.

> Screenshots are live HTML mocks inside a sandboxed `<iframe>`, not PNGs. They
> stay crisp on every display and there is nothing that can 404.

---

## Scoring

Grading is a human act. The host awards points:

| Criterion | Points |
|---|---|
| Correct Diagnosis | +5 |
| Correct Cause | +5 |
| Correct Treatment | +5 |
| Good Explanation | +5 |
| **Maximum** | **20 per doctor** |

Plus an optional ±5 bonus and a note the student sees at Reveal.

**✨ Suggest score** compares the answer against the case's keyword lists and
fills the four rows in for you to adjust. It is deliberately conservative, and a
test asserts that *asking* for a suggestion never grades anybody by itself.

---

## Tests

```bash
npm test
```

**72 tests.** The important ones use real sockets against a real server — no
mocks where mocking would hide the answer.

`test/deployment.test.js` spawns the actual `node server/index.js`, then connects
to it **over a non-loopback network interface** with a foreign `Origin` header,
from clients that share no storage:

- the server binds a real interface, not just localhost
- 12 independent clients share one room; the 13th is refused
- two doctors grab the same patient at once — exactly one wins
- a phase change reaches every doctor
- the timer arrives as one identical deadline everywhere
- a submitted diagnosis reaches the host; a reveal reaches the students
- a refresh, and a hard connection drop, both recover with the patient intact
- a doctor is refused on **eleven** host commands, and on the room code alone
- the host role moves to a different device via the host key
- polling-only clients work (for networks that block WebSocket)
- two rooms on one server stay completely isolated

**What the tests do not prove:** they run on one machine, so they say nothing
about the public internet, NAT or a mobile carrier. Only a real deployment proves
that — see the checklist in [§ Troubleshooting](#troubleshooting).

---

## Troubleshooting

### Connection refused / the page will not load

| Cause | Fix |
|---|---|
| You sent a `localhost` or `192.168.x.x` link | Those are not internet addresses. Deploy, and share the public URL. |
| Server not deployed yet | See [§ Deployment](#deployment). |
| Deployed but bound to `127.0.0.1` | `HOST` must be `0.0.0.0` (the default). Do not override it. |
| Wrong port | Never hard-code a port — the platform injects `PORT`. |

### The server is sleeping

Free tiers stop an idle instance. The first request waits up to a minute. The app
says *"Waking the hospital server…"* rather than showing an error. **Open `/host`
two minutes before class.** To remove the behaviour entirely, use a paid instance.

### WebSocket problems

Symptom: it works at home but not on the university network, or it connects then
drops repeatedly.

The client already falls back to HTTP long-polling automatically when the
WebSocket upgrade is blocked — a test covers polling-only clients. If you are
behind your own Nginx, the usual cause is missing upgrade headers; see the config
in [§ Deployment](#deployment).

Check which transport is in use — in DevTools console on the game page:

```js
// "websocket" or "polling" — both are fine
```
Open the Network tab and filter for `socket.io`.

### CORS errors

Should not happen: the client is served by the same server it connects to, so
every connection is same-origin, and the server reflects the requesting origin
anyway. If you see a CORS error, you are almost certainly opening the HTML file
from disk (`file://…`) instead of from the server. Open the `https://DOMAIN/...`
URL.

### "Room not found" / "No emergency room with that code"

| Cause | Fix |
|---|---|
| Typo — codes are always `FH-` + 4 digits | Re-check, or use the join link |
| The server restarted (deploy, crash, or free-tier sleep) with `PERSIST=false` | Rooms are in memory. The host opens `/host` and creates a new room. |
| Room expired | Empty rooms are swept after `ROOM_TTL_MINUTES` (default 4 hours). |

### The host lost their room / host disconnected

- **Brief disconnect:** nothing to do. The host console re-presents its token on
  every reconnect and control returns by itself.
- **Different device, or cleared browser data:** use the **🔑 Host key** link
  from the room panel, or paste the room code + key into *"Already running a
  room?"* on `/host`.
- **No key saved and the browser is gone:** the room keeps running but is
  unreachable. Students keep their patients and diagnoses; a new host cannot take
  over. Save the host key at the start of a session if this matters.

While the host is away the game simply pauses — students keep their patients,
their work and their place, and everything resumes when the host returns.

### Students see each other but not the host's phase changes

Almost always **two instances**. Check the platform shows exactly one running
instance and autoscaling is off.

### Nothing syncs / everyone seems alone

Confirm everybody is on the **same domain**. A `www.` vs apex mismatch, or one
person still on an old preview URL, puts them on different servers.

---

## Extending the game

**Add a 13th case:** append an object to `PATIENTS` in
`server/game/patients.js` — `symptoms`, `evidence` (mix the kinds!), and an
`answer` with `keywords`. Nothing else needs touching.

**Change the rubric:** edit `RUBRIC` in `server/game/scoring.js`. The host's
point pickers and the leaderboard columns follow automatically.

**More than one instance:** add Redis plus `@socket.io/redis-adapter`, and move
the room `Map` in `server/game/rooms.js` into Redis. Only worth it above a few
hundred concurrent players.

---

## License

MIT. Use it in your classes, change the patients, make it yours.
