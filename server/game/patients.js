/**
 * ────────────────────────────────────────────────────────────────────────────
 *  THE WARD — 12 patient cases + 1 final patient.
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  Every case has:
 *    title      — the name of the disease. HIDDEN from students until Reveal.
 *    patientType, severity, admitted, vitals — flavour shown on the file.
 *    symptoms   — what the "user" complains about. No jargon, no giveaways.
 *    evidence[] — deliberately NOT uniform across patients. Some cases are a
 *                 screenshot only, some are pure code, some are a folder tree,
 *                 some are a console error. Diagnosing means learning to read
 *                 whichever kind of evidence you happen to be handed.
 *    answer     — the model answer revealed in PHASE 6, plus keyword lists the
 *                 host's auto-grader uses to suggest a score.
 *
 *  Evidence block shapes:
 *    { kind: 'code',       lang: 'html'|'css'|'js', label, file, content }
 *    { kind: 'console',    label, lines: [{ level:'error'|'warn'|'info', text }] }
 *    { kind: 'files',      label, tree: [ 'project/', '  index.html', ... ] }
 *    { kind: 'screenshot', label, caption, width, html }   // rendered in a
 *                 sandboxed iframe with srcdoc — a live mock, not a PNG, so the
 *                 repo stays dependency-free and the "screenshot" is crisp on
 *                 every display.
 *    { kind: 'network',    label, rows: [{ name, type, size, time, status }] }
 *    { kind: 'note',       label, text }
 */

/** Shared chrome for the screenshot mocks so they all look like one browser. */
const shot = (body, style = '') => `<!doctype html><html><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#1a2433}
  ${style}
</style></head><body>${body}</body></html>`;

export const PATIENTS = [
  // ── 01 ────────────────────────────────────────────────────────────────────
  {
    id: 'p01',
    number: 1,
    title: 'Form Validation Failure',
    patientType: 'Bakery Order Form',
    severity: 'Serious',
    admitted: 'Admitted after 340 empty orders reached the kitchen overnight.',
    vitals: { heartRate: 122, bp: '150/95', o2: 94 },
    symptoms: [
      'The order form submits even when every field is left completely empty.',
      'The bakery receives orders with no name and no phone number.',
      'No warning message ever appears to the customer.',
      'The page reloads and the customer thinks the order went through.',
    ],
    evidence: [
      {
        kind: 'code',
        lang: 'html',
        label: 'The order form',
        file: 'index.html',
        content: `<form action="/order" method="post" novalidate>
  <label>Your name</label>
  <input type="text" name="name" placeholder="Full name">

  <label>Phone number</label>
  <input type="text" name="phone" placeholder="05x xxx xxxx">

  <label>Delivery date</label>
  <input type="text" name="date" placeholder="dd/mm/yyyy">

  <button type="submit">Place order</button>
</form>`,
      },
      {
        kind: 'screenshot',
        label: 'What the kitchen dashboard shows',
        caption: 'Three of the last four orders arrived completely blank.',
        html: shot(`<div style="padding:16px">
  <h3 style="margin:0 0 12px">Incoming orders</h3>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr style="background:#f1f5f9;text-align:left"><th style="padding:8px">#</th><th>Name</th><th>Phone</th><th>Date</th></tr>
    <tr style="border-top:1px solid #e2e8f0"><td style="padding:8px">1204</td><td>Layla</td><td>0551234567</td><td>12/03</td></tr>
    <tr style="border-top:1px solid #e2e8f0;color:#dc2626"><td style="padding:8px">1205</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td></tr>
    <tr style="border-top:1px solid #e2e8f0;color:#dc2626"><td style="padding:8px">1206</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td></tr>
    <tr style="border-top:1px solid #e2e8f0;color:#dc2626"><td style="padding:8px">1207</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td></tr>
  </table>
</div>`),
      },
    ],
    answer: {
      diagnosis: 'The form performs no validation at all — neither the browser\'s built-in validation nor any JavaScript check runs before submit.',
      cause: 'No field carries the `required` attribute, and the `<form>` itself has `novalidate`, which explicitly switches off the browser\'s native constraint validation. There is also no JS `submit` handler to catch it.',
      treatment: 'Remove `novalidate` from the form, add `required` to name / phone / date, and give each input a proper type (`tel`, `date`) plus a `pattern` where useful. Optionally add a `submit` listener that calls `event.preventDefault()` and shows inline error messages when `form.checkValidity()` returns false.',
      keywords: {
        diagnosis: ['validation', 'no validation', 'empty', 'not validated', 'تحقق'],
        cause: ['novalidate', 'required', 'attribute', 'missing required'],
        treatment: ['required', 'remove novalidate', 'checkvalidity', 'preventdefault', 'type=', 'pattern'],
      },
    },
  },

  // ── 02 ────────────────────────────────────────────────────────────────────
  {
    id: 'p02',
    number: 2,
    title: 'Responsive Design Failure',
    patientType: 'Travel Agency Landing Page',
    severity: 'Critical',
    admitted: 'Admitted when 71% of mobile visitors left within four seconds.',
    vitals: { heartRate: 138, bp: '160/100', o2: 88 },
    symptoms: [
      'On a laptop the page looks perfect.',
      'On a phone everything is microscopic — the whole desktop layout is squeezed into the screen.',
      'The visitor has to pinch and zoom just to read the headline.',
      'The page also slides left and right when you drag it.',
    ],
    evidence: [
      {
        kind: 'screenshot',
        label: 'iPhone 13 — actual size',
        caption: 'The entire 1200px desktop layout crammed into a 390px screen.',
        width: 300,
        html: shot(`<div style="width:1200px;transform:scale(0.25);transform-origin:top left">
  <header style="background:#0f172a;color:#fff;padding:24px 40px;display:flex;justify-content:space-between;align-items:center">
    <strong style="font-size:28px">WANDERLUST</strong>
    <nav style="font-size:20px;display:flex;gap:28px"><span>Tours</span><span>Hotels</span><span>Flights</span><span>Contact</span></nav>
  </header>
  <div style="padding:60px 40px">
    <h1 style="font-size:56px;margin:0 0 16px">Discover the Red Sea</h1>
    <p style="font-size:22px;color:#475569;max-width:700px">Fourteen curated diving expeditions departing every week from three coastal cities.</p>
    <div style="display:flex;gap:24px;margin-top:40px">
      <div style="flex:1;height:220px;background:#e2e8f0;border-radius:12px"></div>
      <div style="flex:1;height:220px;background:#e2e8f0;border-radius:12px"></div>
      <div style="flex:1;height:220px;background:#e2e8f0;border-radius:12px"></div>
    </div>
  </div>
</div>`, 'body{width:1200px;overflow:hidden}'),
      },
      {
        kind: 'code',
        lang: 'html',
        label: 'The document head',
        file: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Wanderlust Travel</title>
  <link rel="stylesheet" href="css/style.css">
</head>`,
      },
      {
        kind: 'code',
        lang: 'css',
        label: 'Layout rules',
        file: 'css/style.css',
        content: `.container {
  width: 1200px;
  margin: 0 auto;
}

.cards {
  display: flex;
  gap: 24px;
}

.card {
  width: 380px;
}`,
      },
    ],
    answer: {
      diagnosis: 'The page is not responsive. Mobile browsers render it at a virtual 980px-wide desktop viewport and then shrink the result, so everything appears tiny.',
      cause: 'The `<meta name="viewport">` tag is missing from `<head>`, and the layout is built on fixed pixel widths (`width: 1200px`, `width: 380px`) with no media queries and no fluid units.',
      treatment: 'Add `<meta name="viewport" content="width=device-width, initial-scale=1">`, then replace fixed widths with `max-width` + `width: 100%`, let the flex row wrap (`flex-wrap: wrap`), and add media queries so the cards stack on narrow screens.',
      keywords: {
        diagnosis: ['responsive', 'not responsive', 'mobile', 'zoom', 'استجابة'],
        cause: ['viewport', 'meta', 'fixed width', 'px', 'media quer', '1200'],
        treatment: ['viewport', 'meta name', 'media quer', 'max-width', 'flex-wrap', '%', 'rem'],
      },
    },
  },

  // ── 03 ────────────────────────────────────────────────────────────────────
  {
    id: 'p03',
    number: 3,
    title: 'DOM Selector / Script Timing Error',
    patientType: 'Newsletter Signup Widget',
    severity: 'Serious',
    admitted: 'Admitted with a console full of red.',
    vitals: { heartRate: 130, bp: '145/92', o2: 91 },
    symptoms: [
      'The Subscribe button does absolutely nothing when clicked.',
      'The whole page\'s JavaScript stops working — even features further down the file.',
      'The browser console shows a red error the moment the page loads.',
    ],
    evidence: [
      {
        kind: 'console',
        label: 'DevTools → Console',
        lines: [
          { level: 'error', text: 'Uncaught TypeError: Cannot read properties of null (reading \'addEventListener\')' },
          { level: 'info', text: '    at app.js:3:14' },
        ],
      },
      {
        kind: 'code',
        lang: 'html',
        label: 'The markup',
        file: 'index.html',
        content: `<head>
  <script src="js/app.js"></script>
</head>
<body>
  <section class="newsletter">
    <input type="email" id="email-input" placeholder="you@example.com">
    <button id="subscribe-btn">Subscribe</button>
  </section>
</body>`,
      },
      {
        kind: 'code',
        lang: 'js',
        label: 'The script',
        file: 'js/app.js',
        content: `const button = document.querySelector('.subscribe-btn');

button.addEventListener('click', () => {
  const email = document.querySelector('#email-input').value;
  console.log('Subscribing', email);
});`,
      },
    ],
    answer: {
      diagnosis: '`document.querySelector` returns `null`, so calling `.addEventListener` on it throws and kills the rest of the script.',
      cause: 'Two faults stack up. First the selector is wrong: `.subscribe-btn` looks for a **class**, but the button has an **id** (`#subscribe-btn`). Second the script is loaded in `<head>` without `defer`, so it runs before the `<body>` elements exist — even the correct selector would return null.',
      treatment: 'Fix the selector to `#subscribe-btn` (or `getElementById`), and either move the `<script>` to the end of `<body>` or add the `defer` attribute. Wrapping the code in a `DOMContentLoaded` listener works too.',
      keywords: {
        diagnosis: ['null', 'not found', 'selector', 'addeventlistener', 'undefined'],
        cause: ['class', 'id', 'dot', 'hash', '#', 'head', 'before', 'timing', 'loaded'],
        treatment: ['#subscribe', 'getelementbyid', 'defer', 'end of body', 'domcontentloaded'],
      },
    },
  },

  // ── 04 ────────────────────────────────────────────────────────────────────
  {
    id: 'p04',
    number: 4,
    title: 'Broken File Path',
    patientType: 'E-Commerce Website',
    severity: 'Critical',
    admitted: 'Admitted after the product catalogue went blank in production.',
    vitals: { heartRate: 141, bp: '155/98', o2: 87 },
    symptoms: [
      'Product images are not appearing.',
      'Broken image icons are visible in every product card.',
      'Product cards look incomplete and half-empty.',
      'It worked perfectly on the developer\'s own laptop.',
    ],
    evidence: [
      {
        kind: 'files',
        label: 'Actual project folder',
        tree: [
          'shop/',
          '  index.html',
          '  css/',
          '    style.css',
          '  image/',
          '    Laptop.png',
          '    headphones.png',
          '    Camera.png',
          '  js/',
          '    cart.js',
        ],
      },
      {
        kind: 'code',
        lang: 'html',
        label: 'Product markup',
        file: 'shop/index.html',
        content: `<div class="product">
  <img src="images/laptop.png" alt="Laptop">
  <h3>UltraBook 14"</h3>
</div>

<div class="product">
  <img src="images/headphones.png" alt="Headphones">
  <h3>Studio Headphones</h3>
</div>`,
      },
      {
        kind: 'console',
        label: 'DevTools → Console',
        lines: [
          { level: 'error', text: 'GET https://shop.example.com/images/laptop.png 404 (Not Found)' },
          { level: 'error', text: 'GET https://shop.example.com/images/headphones.png 404 (Not Found)' },
        ],
      },
      {
        kind: 'note',
        label: 'Developer note',
        text: 'The developer builds on Windows. The production server runs Linux.',
      },
    ],
    answer: {
      diagnosis: 'Broken file path — the browser requests image files that do not exist at the given URL, so it renders the broken-image placeholder (404 Not Found).',
      cause: 'The HTML points at `images/` while the real folder is named `image/` (singular). On top of that the filenames differ in case — `Laptop.png` on disk vs `laptop.png` in the `src`. Windows ignores letter case, Linux does not, which is exactly why it worked locally and broke in production.',
      treatment: 'Correct the relative path to `image/` and match the filename case exactly — or, better, rename every asset to lowercase and update the markup so the project is case-safe everywhere. Verify each request returns 200 in the Network tab.',
      keywords: {
        diagnosis: ['404', 'path', 'broken', 'not found', 'مسار'],
        cause: ['images', 'image', 'folder', 'case', 'capital', 'uppercase', 'plural', 's'],
        treatment: ['rename', 'correct path', 'lowercase', 'relative', 'match'],
      },
    },
  },

  // ── 05 ────────────────────────────────────────────────────────────────────
  {
    id: 'p05',
    number: 5,
    title: 'CSS Overflow / Box Model Problem',
    patientType: 'University Results Portal',
    severity: 'Serious',
    admitted: 'Admitted with a horizontal scrollbar nobody asked for.',
    vitals: { heartRate: 118, bp: '140/88', o2: 93 },
    symptoms: [
      'A horizontal scrollbar appears at the bottom of every page.',
      'The layout is slightly wider than the screen, so content can be dragged sideways.',
      'The last column of the results table is cut off.',
      'On mobile the header sits misaligned with the rest of the page.',
    ],
    evidence: [
      {
        kind: 'screenshot',
        label: 'The page at 390px wide',
        caption: 'Notice the sliver of white on the right and the clipped Grade column.',
        width: 320,
        html: shot(`<div style="width:440px">
  <div style="background:#1e3a8a;color:#fff;padding:14px 20px;font-weight:700">Results Portal</div>
  <div style="padding:16px">
    <table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap">
      <tr style="background:#eef2ff;text-align:left"><th style="padding:6px">Course code</th><th>Course title</th><th>Credits</th><th>Grade</th></tr>
      <tr><td style="padding:6px">CS-201</td><td>Web Development Fundamentals</td><td>3</td><td>A</td></tr>
      <tr><td style="padding:6px">CS-214</td><td>Advanced JavaScript Patterns</td><td>3</td><td>B+</td></tr>
    </table>
  </div>
</div>
<div style="position:absolute;top:0;right:0;bottom:0;width:50px;background:repeating-linear-gradient(45deg,#fee2e2,#fee2e2 6px,#fecaca 6px,#fecaca 12px)"></div>`, 'body{position:relative;overflow:hidden;width:390px}'),
      },
      {
        kind: 'code',
        lang: 'css',
        label: 'Stylesheet',
        file: 'css/portal.css',
        content: `.page {
  width: 100%;
  padding: 0 25px;
  border: 1px solid #ddd;
}

.results-table {
  width: 100%;
  white-space: nowrap;
}

.header {
  width: 100vw;
}`,
      },
    ],
    answer: {
      diagnosis: 'Horizontal overflow — several elements compute wider than the viewport, so the document scrolls sideways and the table\'s last column is clipped.',
      cause: 'The default `box-sizing: content-box` means `.page` is `100%` **plus** 50px of padding **plus** 2px of border, which overflows its parent. `width: 100vw` on `.header` includes the vertical scrollbar\'s width, adding a few more pixels. `white-space: nowrap` then stops the wide table from wrapping.',
      treatment: 'Apply `*, *::before, *::after { box-sizing: border-box; }` globally so padding and border are included in the width. Replace `100vw` with `100%`. Let the table wrap, or wrap it in a container with `overflow-x: auto` so only the table scrolls, not the page. `body { overflow-x: hidden }` hides the symptom but does not cure the disease.',
      keywords: {
        diagnosis: ['overflow', 'horizontal', 'scroll', 'wider', 'تجاوز'],
        cause: ['box-sizing', 'content-box', 'padding', 'border', '100vw', 'nowrap'],
        treatment: ['border-box', 'box-sizing', 'overflow-x', 'auto', '100%', 'wrap'],
      },
    },
  },

  // ── 06 ────────────────────────────────────────────────────────────────────
  {
    id: 'p06',
    number: 6,
    title: 'Invisible Element / Stacking & Display',
    patientType: 'Clinic Booking Modal',
    severity: 'Critical',
    admitted: 'Admitted because no patient could confirm a booking for 3 days.',
    vitals: { heartRate: 133, bp: '150/94', o2: 89 },
    symptoms: [
      'Clicking "Book appointment" appears to do nothing.',
      'The screen dims slightly, but no dialog is ever visible.',
      'The page behind becomes unclickable — as if something invisible is covering it.',
      'The console prints "modal opened" every single time.',
    ],
    evidence: [
      {
        kind: 'console',
        label: 'DevTools → Console',
        lines: [
          { level: 'info', text: 'modal opened' },
          { level: 'info', text: 'modal opened' },
        ],
      },
      {
        kind: 'code',
        lang: 'css',
        label: 'Modal styles',
        file: 'css/modal.css',
        content: `.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9999;
}

.modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  padding: 32px;
  opacity: 0;
  z-index: 10;
}

.modal.is-open {
  display: block;
}`,
      },
      {
        kind: 'code',
        lang: 'js',
        label: 'Modal script',
        file: 'js/modal.js',
        content: `const modal = document.querySelector('.modal');
const overlay = document.querySelector('.overlay');

document.querySelector('#book-btn').addEventListener('click', () => {
  modal.classList.add('is-open');
  overlay.style.display = 'block';
  console.log('modal opened');
});`,
      },
    ],
    answer: {
      diagnosis: 'The modal is being added to the page correctly but is never actually visible: it is fully transparent and it sits underneath the overlay.',
      cause: '`.modal` has `opacity: 0` and the `.is-open` class only sets `display: block` — it never restores opacity. Separately, `.overlay` has `z-index: 9999` while `.modal` has `z-index: 10`, so even at full opacity the dark overlay would paint on top of it and swallow the clicks.',
      treatment: 'Have `.is-open` set `opacity: 1` (and `visibility: visible`) as well as `display: block`, and raise the modal above the overlay — e.g. overlay `z-index: 1000`, modal `z-index: 1001`. Add a `transition: opacity .2s` for a smooth fade instead of a snap.',
      keywords: {
        diagnosis: ['invisible', 'not visible', 'hidden', 'transparent', 'behind'],
        cause: ['opacity', 'z-index', 'overlay', 'display', 'stacking'],
        treatment: ['opacity: 1', 'opacity 1', 'z-index', 'visibility', 'transition', 'above'],
      },
    },
  },

  // ── 07 ────────────────────────────────────────────────────────────────────
  {
    id: 'p07',
    number: 7,
    title: 'Performance / Asset Weight Problem',
    patientType: 'Photography Portfolio',
    severity: 'Serious',
    admitted: 'Admitted with severe page-load fatigue.',
    vitals: { heartRate: 58, bp: '95/60', o2: 90 },
    symptoms: [
      'The site takes 14 seconds before anything appears on screen.',
      'On mobile data it sometimes never finishes loading at all.',
      'The tab freezes and the fan spins up while it loads.',
      'Once loaded, scrolling is smooth and everything works fine.',
    ],
    evidence: [
      {
        kind: 'network',
        label: 'DevTools → Network (first load)',
        rows: [
          { name: 'index.html', type: 'document', size: '11 KB', time: '80 ms', status: 200 },
          { name: 'hero-shot.png', type: 'png', size: '8.4 MB', time: '6.2 s', status: 200 },
          { name: 'gallery-01.png', type: 'png', size: '6.1 MB', time: '4.8 s', status: 200 },
          { name: 'gallery-02.png', type: 'png', size: '7.7 MB', time: '5.9 s', status: 200 },
          { name: 'gallery-03.png', type: 'png', size: '5.4 MB', time: '4.1 s', status: 200 },
          { name: 'style.css', type: 'stylesheet', size: '9 KB', time: '2.9 s', status: 200 },
          { name: 'slider.js', type: 'script', size: '240 KB', time: '3.4 s', status: 200 },
        ],
      },
      {
        kind: 'code',
        lang: 'html',
        label: 'Gallery markup',
        file: 'index.html',
        content: `<head>
  <script src="js/slider.js"></script>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <img src="img/hero-shot.png" class="hero">

  <div class="gallery">
    <img src="img/gallery-01.png">
    <img src="img/gallery-02.png">
    <img src="img/gallery-03.png">
    <!-- 40 more full-resolution images below the fold -->
  </div>
</body>`,
      },
    ],
    answer: {
      diagnosis: 'A performance problem caused by asset weight, not by broken code — the page ships ~28 MB of images and blocks rendering while it downloads them.',
      cause: 'Full-resolution PNG photographs are served straight to the browser with no compression and no resizing, every image below the fold is downloaded eagerly, and a render-blocking `<script>` sits in `<head>` ahead of the stylesheet.',
      treatment: 'Compress and resize the photographs, serve modern formats (WebP/AVIF) with `<picture>` and `srcset` so phones get small versions, add `loading="lazy"` to everything below the fold, give images explicit `width`/`height` to stop layout shift, and move the script to the end of `<body>` or add `defer`.',
      keywords: {
        diagnosis: ['performance', 'slow', 'heavy', 'size', 'load', 'بطيء'],
        cause: ['image', 'png', 'mb', 'large', 'not compressed', 'render-blocking', 'head', 'lazy'],
        treatment: ['compress', 'webp', 'avif', 'lazy', 'srcset', 'resize', 'defer', 'cdn'],
      },
    },
  },

  // ── 08 ────────────────────────────────────────────────────────────────────
  {
    id: 'p08',
    number: 8,
    title: 'Flexbox Axis Confusion',
    patientType: 'Restaurant Menu Page',
    severity: 'Stable',
    admitted: 'Admitted with a layout that refuses to sit still.',
    vitals: { heartRate: 96, bp: '128/82', o2: 96 },
    symptoms: [
      'The three menu cards are stacked vertically instead of sitting side by side.',
      'Trying to centre them horizontally instead centres them vertically.',
      'On a narrow screen the cards squash into unreadable slivers rather than moving to a new line.',
    ],
    evidence: [
      {
        kind: 'code',
        lang: 'css',
        label: 'Menu layout',
        file: 'css/menu.css',
        content: `.menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 400px;
  gap: 20px;
}

.menu-card {
  width: 300px;
}`,
      },
      {
        kind: 'screenshot',
        label: 'How it renders',
        caption: 'Expected: three cards in a row. Actual: a vertical tower.',
        width: 340,
        html: shot(`<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;background:#f8fafc">
  <div style="width:220px;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:8px"><strong>Mezze</strong><div style="color:#64748b;font-size:12px">12 SAR</div></div>
  <div style="width:220px;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:8px"><strong>Grills</strong><div style="color:#64748b;font-size:12px">48 SAR</div></div>
  <div style="width:220px;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:8px"><strong>Desserts</strong><div style="color:#64748b;font-size:12px">22 SAR</div></div>
</div>`),
      },
      {
        kind: 'note',
        label: 'Designer\'s intent',
        text: 'Three equal cards in a horizontal row, centred on the page, wrapping to a second line on phones.',
      },
    ],
    answer: {
      diagnosis: 'The flex container is laying out along the wrong axis, and the alignment properties are therefore doing the opposite of what the developer expects.',
      cause: '`flex-direction: column` makes the **main axis vertical**, so the cards stack. `align-items` controls the **cross axis**, which is now horizontal — that is why it appears to centre the wrong way. `flex-wrap` is left at its default `nowrap`, so narrow screens shrink the cards instead of wrapping them.',
      treatment: 'Use `flex-direction: row` (or simply delete the line — `row` is the default), centre with `justify-content: center` on the main axis, add `flex-wrap: wrap` so cards move to a new line, and give the cards `flex: 1 1 300px` instead of a rigid `width` so they flex responsively.',
      keywords: {
        diagnosis: ['flex', 'direction', 'axis', 'stack', 'vertical', 'column'],
        cause: ['column', 'main axis', 'cross axis', 'align-items', 'nowrap', 'wrap'],
        treatment: ['row', 'justify-content', 'flex-wrap', 'wrap', 'flex: 1', 'flex-basis'],
      },
    },
  },

  // ── 09 ────────────────────────────────────────────────────────────────────
  {
    id: 'p09',
    number: 9,
    title: 'Event Listener Never Attached',
    patientType: 'To-Do List App',
    severity: 'Serious',
    admitted: 'Admitted completely unresponsive. No pulse on any button.',
    vitals: { heartRate: 0, bp: '—', o2: 92 },
    symptoms: [
      'Typing a task and clicking "Add" does nothing at all.',
      'Pressing Enter does nothing either.',
      'The console is completely clean — no errors, no warnings.',
      'The delete buttons on the existing sample tasks also do nothing.',
    ],
    evidence: [
      {
        kind: 'code',
        lang: 'js',
        label: 'App script',
        file: 'js/todo.js',
        content: `const input = document.getElementById('task-input');
const addBtn = document.getElementById('add-btn');
const list = document.getElementById('task-list');

function addTask() {
  if (!input.value.trim()) return;
  const li = document.createElement('li');
  li.textContent = input.value;
  list.appendChild(li);
  input.value = '';
}

function deleteTask(event) {
  event.target.closest('li').remove();
}

document.addEventListener('DOMContentLoad', () => {
  console.log('ready');
});`,
      },
      {
        kind: 'console',
        label: 'DevTools → Console',
        lines: [
          { level: 'info', text: '(no output)' },
        ],
      },
      {
        kind: 'note',
        label: 'Triage note',
        text: 'Calling addTask() manually from the console works perfectly and adds the task.',
      },
    ],
    answer: {
      diagnosis: 'The functions are all correct but nothing ever calls them — no event listener is wired to the Add button, to the Enter key, or to the delete buttons.',
      cause: '`addTask` and `deleteTask` are defined and then never registered. The only `addEventListener` in the file listens for `"DOMContentLoad"`, which is a typo — the real event is `"DOMContentLoaded"` — so even that callback never fires, and no error is thrown because listening for a non-existent event name is perfectly legal.',
      treatment: 'Fix the event name to `DOMContentLoaded`, then attach the handlers: `addBtn.addEventListener("click", addTask)` and a `keydown` listener on the input for Enter. For the delete buttons use event delegation — one `click` listener on `#task-list` that calls `deleteTask` — so it keeps working for tasks added later.',
      keywords: {
        diagnosis: ['listener', 'not attached', 'never called', 'no event', 'nothing calls'],
        cause: ['domcontentload', 'typo', 'addeventlistener', 'missing', 'not registered'],
        treatment: ['addeventlistener', 'domcontentloaded', 'click', 'delegation', 'keydown'],
      },
    },
  },

  // ── 10 ────────────────────────────────────────────────────────────────────
  {
    id: 'p10',
    number: 10,
    title: 'Wrong Input Types',
    patientType: 'Hospital Registration Form',
    severity: 'Stable',
    admitted: 'Admitted after the records department revolted.',
    vitals: { heartRate: 102, bp: '132/85', o2: 95 },
    symptoms: [
      'On phones, every field opens the full alphabet keyboard — even the phone number.',
      'People type their date of birth in six different formats.',
      'Passwords are shown in plain text on screen while being typed.',
      'Obviously invalid email addresses are accepted without complaint.',
      'The age field accepts "twenty five" and negative numbers.',
    ],
    evidence: [
      {
        kind: 'code',
        lang: 'html',
        label: 'Registration fields',
        file: 'register.html',
        content: `<form>
  <input type="text" name="email"    placeholder="Email address" required>
  <input type="text" name="phone"    placeholder="Phone number" required>
  <input type="text" name="dob"      placeholder="Date of birth" required>
  <input type="text" name="age"      placeholder="Age" required>
  <input type="text" name="password" placeholder="Password" required>
  <button type="submit">Register</button>
</form>`,
      },
      {
        kind: 'screenshot',
        label: 'Mobile keyboard on the phone field',
        caption: 'A QWERTY keyboard for a field that only ever receives digits.',
        width: 300,
        html: shot(`<div style="padding:14px;background:#f1f5f9">
  <div style="background:#fff;border:2px solid #2563eb;border-radius:8px;padding:10px;font-size:13px;color:#94a3b8">Phone number</div>
  <div style="margin-top:12px;background:#d1d5db;border-radius:8px;padding:8px">
    ${['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((row, i) => `<div style="display:flex;gap:4px;justify-content:center;margin-bottom:5px;padding:0 ${i * 10}px">${row.split('').map((k) => `<div style="flex:1;background:#fff;border-radius:4px;text-align:center;padding:8px 0;font-size:12px">${k}</div>`).join('')}</div>`).join('')}
  </div>
</div>`),
      },
    ],
    answer: {
      diagnosis: 'Every input uses `type="text"`, so the browser gives none of the free validation, formatting or keyboard help it would otherwise provide.',
      cause: 'The correct semantic input types were never used. `type` is what tells the browser which on-screen keyboard to show, which value format to enforce, whether to mask characters, and which native error message to display.',
      treatment: 'Use the right type per field: `type="email"`, `type="tel"` (with `inputmode="numeric"` and a `pattern`), `type="date"`, `type="number"` with `min`/`max`, and `type="password"`. Add `autocomplete` hints (`email`, `tel`, `bday`, `new-password`) and keep a server-side check as well — client validation is a convenience, never a guarantee.',
      keywords: {
        diagnosis: ['input type', 'type=text', 'wrong type', 'semantic', 'نوع'],
        cause: ['text', 'type', 'attribute', 'native', 'browser'],
        treatment: ['type="email"', 'type=email', 'tel', 'date', 'number', 'password', 'inputmode', 'autocomplete', 'min', 'max'],
      },
    },
  },

  // ── 11 ────────────────────────────────────────────────────────────────────
  {
    id: 'p11',
    number: 11,
    title: 'Broken Navigation & Anchor Links',
    patientType: 'Conference Website',
    severity: 'Serious',
    admitted: 'Admitted after attendees could not find the schedule.',
    vitals: { heartRate: 115, bp: '138/86', o2: 93 },
    symptoms: [
      'Clicking "Schedule" in the navbar jumps to the top of the page instead of the schedule section.',
      'Clicking "Speakers" reloads the page and lands on a 404 error.',
      '"Venue" jumps instantly with no smooth scroll, and the sticky header hides the section title.',
      'The active page is never highlighted in the navbar.',
    ],
    evidence: [
      {
        kind: 'code',
        lang: 'html',
        label: 'Navigation bar',
        file: 'index.html',
        content: `<nav class="navbar">
  <a href="#">Home</a>
  <a href="#schedule-section">Schedule</a>
  <a href="Speakers.html">Speakers</a>
  <a href="#venue">Venue</a>
</nav>

<section id="schedule">   <!-- the schedule lives here -->
  <h2>Conference Schedule</h2>
</section>

<section id="venue">
  <h2>Venue &amp; Directions</h2>
</section>`,
      },
      {
        kind: 'files',
        label: 'Deployed folder (Linux server)',
        tree: [
          'conference/',
          '  index.html',
          '  speakers.html',
          '  register.html',
          '  css/',
          '    main.css',
        ],
      },
      {
        kind: 'console',
        label: 'DevTools → Console',
        lines: [
          { level: 'error', text: 'GET https://conf.example.com/Speakers.html 404 (Not Found)' },
        ],
      },
    ],
    answer: {
      diagnosis: 'The navigation links point at targets that do not exist: one anchor id is wrong, one file name is wrong, and one link is an empty placeholder.',
      cause: '`href="#schedule-section"` does not match the section\'s real `id="schedule"`, so the browser has nothing to scroll to. `href="Speakers.html"` is capitalised while the deployed file is `speakers.html` — case-sensitive on Linux, hence the 404. `href="#"` is a placeholder that always jumps to the top. The sticky header overlaps because nothing offsets the scroll position.',
      treatment: 'Make each `href` match its target exactly: `#schedule`, `speakers.html`, and `#home` (or `#top`) for Home. Add `html { scroll-behavior: smooth; }` and `scroll-margin-top: 80px` on the sections so the sticky header stops covering the headings. Mark the current link with an `aria-current="page"` / `.active` class.',
      keywords: {
        diagnosis: ['link', 'anchor', 'navigation', 'href', '404', 'id'],
        cause: ['id', 'mismatch', 'case', 'capital', 'schedule-section', 'href="#"', 'placeholder'],
        treatment: ['match', 'rename', 'scroll-behavior', 'scroll-margin', 'lowercase', 'active'],
      },
    },
  },

  // ── 12 ────────────────────────────────────────────────────────────────────
  {
    id: 'p12',
    number: 12,
    title: 'Dark Mode / Theme Toggle Failure',
    patientType: 'Developer Blog',
    severity: 'Serious',
    admitted: 'Admitted with intermittent identity crisis.',
    vitals: { heartRate: 108, bp: '135/88', o2: 94 },
    symptoms: [
      'Clicking the moon icon changes nothing on screen.',
      'Inspecting the page shows a class really is being added and removed.',
      'On one page only, the background does go dark — but the text stays black and is unreadable.',
      'Even when it works, refreshing the page throws you back to light mode.',
    ],
    evidence: [
      {
        kind: 'code',
        lang: 'js',
        label: 'Theme toggle',
        file: 'js/theme.js',
        content: `const toggle = document.getElementById('theme-toggle');

toggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
});`,
      },
      {
        kind: 'code',
        lang: 'css',
        label: 'Theme styles',
        file: 'css/theme.css',
        content: `:root {
  --bg: #ffffff;
  --text: #111111;
}

html[data-theme="dark"] {
  --bg: #111111;
  --text: #f5f5f5;
}

body {
  background: var(--bg);
  color: var(--text);
}

.post-title {
  color: #111111 !important;
}`,
      },
      {
        kind: 'console',
        label: 'DevTools → Elements (after clicking)',
        lines: [
          { level: 'info', text: '<body class="dark">  ← the class IS being added' },
          { level: 'warn', text: '<html>  ← but no data-theme attribute here' },
        ],
      },
    ],
    answer: {
      diagnosis: 'The toggle and the stylesheet disagree about what "dark mode" means, so the JavaScript flips a switch that no CSS rule is listening for.',
      cause: 'The script adds a `dark` **class** to `<body>`, while the CSS defines its dark palette on `html[data-theme="dark"]` — a different element and a different selector, so the custom properties are never overridden. Separately, `.post-title` hard-codes `#111111 !important`, which beats the variable and keeps the title black. Nothing is written to storage, so the choice is lost on reload.',
      treatment: 'Pick one contract and use it on both sides — e.g. `document.documentElement.setAttribute("data-theme", next)` in JS to match the existing CSS. Replace the hard-coded `!important` colour with `color: var(--text)`. Persist the choice with `localStorage.setItem("theme", next)` and re-apply it early on load, defaulting to `matchMedia("(prefers-color-scheme: dark)")`.',
      keywords: {
        diagnosis: ['theme', 'toggle', 'dark mode', 'not applied', 'mismatch', 'no effect'],
        cause: ['class', 'data-theme', 'body', 'html', 'selector', 'important', 'localstorage'],
        treatment: ['documentelement', 'setattribute', 'data-theme', 'var(--', 'localstorage', 'prefers-color-scheme'],
      },
    },
  },
];

/**
 * PHASE 8 — everyone works on this one together. Five independent faults, so a
 * team of 12 can genuinely split up and still all have something to find.
 */
export const FINAL_PATIENT = {
  id: 'final',
  number: 0,
  title: 'Multi-System Failure',
  patientType: 'MEDCART — the hospital\'s own online pharmacy',
  severity: 'Code Blue',
  admitted: 'Every system failing at once. All doctors to the operating room.',
  vitals: { heartRate: 174, bp: '190/120', o2: 71 },
  bugCount: 5,
  symptoms: [
    'Medicine photos do not load — every product shows a broken icon.',
    'The "Add to cart" button is completely dead.',
    'On a phone the page is tiny and scrolls sideways.',
    'The checkout form accepts an empty order.',
    'The "Prescriptions" link in the navbar goes to a 404 page.',
  ],
  evidence: [
    {
      kind: 'files',
      label: 'Project folder',
      tree: [
        'medcart/',
        '  index.html',
        '  prescriptions.html',
        '  css/',
        '    style.css',
        '  assets/',
        '    img/',
        '      panadol.png',
        '      vitamin-c.png',
        '  js/',
        '    cart.js',
      ],
    },
    {
      kind: 'code',
      lang: 'html',
      label: 'index.html',
      file: 'medcart/index.html',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MedCart</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <nav>
    <a href="index.html">Home</a>
    <a href="Prescriptions.html">Prescriptions</a>
  </nav>

  <div class="products">
    <div class="product">
      <img src="img/panadol.png" alt="Panadol">
      <h3>Panadol 500mg</h3>
      <button class="add-to-cart" data-id="1">Add to cart</button>
    </div>
    <div class="product">
      <img src="img/vitamin-c.png" alt="Vitamin C">
      <h3>Vitamin C 1000mg</h3>
      <button class="add-to-cart" data-id="2">Add to cart</button>
    </div>
  </div>

  <form id="checkout" novalidate>
    <input type="text" name="patient" placeholder="Patient name">
    <input type="text" name="phone" placeholder="Phone">
    <button type="submit">Confirm order</button>
  </form>

  <script src="js/cart.js"></script>
</body>
</html>`,
    },
    {
      kind: 'code',
      lang: 'css',
      label: 'css/style.css',
      file: 'medcart/css/style.css',
      content: `.products {
  display: flex;
  width: 1100px;
  padding: 0 40px;
  gap: 24px;
}

.product {
  width: 340px;
}`,
    },
    {
      kind: 'code',
      lang: 'js',
      label: 'js/cart.js',
      file: 'medcart/js/cart.js',
      content: `const cart = [];

function addToCart(id) {
  cart.push(id);
  document.querySelector('#cart-count').textContent = cart.length;
}

const buttons = document.querySelectorAll('.add-to-cart-btn');
buttons.forEach((btn) => {
  btn.addEventListener('click', () => addToCart(btn.dataset.id));
});`,
    },
    {
      kind: 'console',
      label: 'DevTools → Console',
      lines: [
        { level: 'error', text: 'GET https://medcart.example.com/img/panadol.png 404 (Not Found)' },
        { level: 'error', text: 'GET https://medcart.example.com/img/vitamin-c.png 404 (Not Found)' },
        { level: 'error', text: 'GET https://medcart.example.com/Prescriptions.html 404 (Not Found)' },
      ],
    },
  ],
  answer: {
    findings: [
      {
        title: 'Broken image paths',
        cause: 'The markup asks for `img/panadol.png`, but the images actually live at `assets/img/panadol.png`.',
        fix: 'Correct the `src` to `assets/img/…` (or move the folder to match the markup).',
      },
      {
        title: 'Add-to-cart button is dead',
        cause: '`querySelectorAll(\'.add-to-cart-btn\')` matches nothing — the buttons carry the class `add-to-cart`. The NodeList is empty, so `forEach` runs zero times and no listener is attached. No error is thrown, which is why the console looks innocent.',
        fix: 'Select `.add-to-cart`. (`#cart-count` also does not exist in the markup and must be added, or `addToCart` will throw on the first click.)',
      },
      {
        title: 'Not responsive',
        cause: 'The viewport meta tag is missing, and `.products` is a fixed `1100px` wide with `padding` on top of it under the default `content-box`, so it overflows any phone screen.',
        fix: 'Add `<meta name="viewport" content="width=device-width, initial-scale=1">`, set `box-sizing: border-box` globally, swap the fixed width for `max-width: 1100px; width: 100%`, and add `flex-wrap: wrap`.',
      },
      {
        title: 'Checkout accepts empty orders',
        cause: 'The form carries `novalidate` and neither input has `required`, so nothing stops a blank submission.',
        fix: 'Remove `novalidate`, add `required`, and use `type="tel"` with a `pattern` for the phone field.',
      },
      {
        title: 'Prescriptions link 404s',
        cause: '`href="Prescriptions.html"` is capitalised; the deployed file is `prescriptions.html`, and the Linux server is case-sensitive.',
        fix: 'Change the link to `prescriptions.html` and keep every filename lowercase across the project.',
      },
    ],
  },
};

const byId = new Map([...PATIENTS, FINAL_PATIENT].map((p) => [p.id, p]));

export const getCase = (id) => byId.get(id) ?? null;

/** What everyone may see about a patient before it is revealed. */
export const publicPatientInfo = (p) => ({
  id: p.id,
  number: p.number,
  severity: p.severity,
});

/** The full file — only ever sent to the assigned doctor, the host, or after Reveal. */
export const privatePatientFile = (p) => ({
  id: p.id,
  number: p.number,
  patientType: p.patientType,
  severity: p.severity,
  admitted: p.admitted,
  vitals: p.vitals,
  symptoms: p.symptoms,
  evidence: p.evidence,
});

/** Model answer. Withheld until the host triggers Reveal. */
export const revealAnswer = (p) => ({
  id: p.id,
  title: p.title,
  ...(p.answer.findings
    ? { findings: p.answer.findings }
    : {
      diagnosis: p.answer.diagnosis,
      cause: p.answer.cause,
      treatment: p.answer.treatment,
    }),
});
