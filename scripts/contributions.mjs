// Draws the past year of GitHub contributions as a grid of soft violet tiles.
// A small glowing comet orbits the grid and eats the active days; eaten tiles
// grow back a few seconds later. Dark and light variants.
//
// Usage: GITHUB_TOKEN=... node scripts/contributions.mjs <user> <outDir>
// Writes <outDir>/contributions-dark.svg and <outDir>/contributions-light.svg.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [user, outDir = 'dist'] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!user || !token) {
  console.error('usage: GITHUB_TOKEN=... node scripts/contributions.mjs <user> [outDir]');
  process.exit(1);
}

const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
  totalContributions weeks{contributionDays{contributionLevel}}}}}}`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'contributions-svg' },
  body: JSON.stringify({ query, variables: { login: user } }),
});
const json = await res.json();
if (!res.ok || json.errors) {
  console.error('GitHub API error:', res.status, JSON.stringify(json.errors ?? json));
  process.exit(1);
}
const cal = json.data.user.contributionsCollection.contributionCalendar;

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const weeks = cal.weeks.map((w) => w.contributionDays.map((d) => LEVEL[d.contributionLevel] ?? 0));
const total = new Intl.NumberFormat('en-US').format(cal.totalContributions);

const THEMES = {
  dark: {
    tiles: ['#17161f', '#33285a', '#5a40a8', '#8d66e0', '#d2b8ff'],
    core: '#f6f1ff', halo: '#a78bfa', haloOpacity: 0.55, lamp: '#a78bfa', lampOpacity: 0.16, tail: '#c4b0ff',
    caption: '#6e7681', number: '#9198a1',
  },
  light: {
    tiles: ['#efedf5', '#d8c9f8', '#b08ef0', '#8456dc', '#5a2bbf'],
    core: '#5a2bbf', halo: '#8456dc', haloOpacity: 0.45, lamp: '#8250df', lampOpacity: 0.12, tail: '#8456dc',
    caption: '#818b98', number: '#59636e',
  },
};

// Fills the content width of a GitHub profile README on desktop, edge to edge.
const width = 768;
const GAP = width / (weeks.length - 1 + 0.7);
const SIZE = GAP * 0.7;
const RADIUS = SIZE * 0.28;
const PAD = SIZE / 2;
const height = Math.round(6 * GAP + SIZE + 30);
const cx = (x) => PAD + x * GAP;
const cy = (y) => PAD + y * GAP;
const f = (n) => n.toFixed(1);

// ---- the comet's route ----------------------------------------------------
// A closed orbit: rightwards through the top four rows, back leftwards through
// the bottom three, then home to the start cell, so the loop never jumps.
// It may move diagonally; each eaten tile is reached by nearest-first search.
const STEP = 0.085; // seconds per cell
const TAIL = 12; // trailing dots
const TAIL_GAP = 0.036; // seconds between trailing dots

const start = { x: 0, y: 3 };
let pos = { ...start };
let clock = 0;
const turns = [{ t: 0, ...pos }];
const eatenAt = new Map();

function goTo(to) {
  const dx = to.x - pos.x;
  const dy = to.y - pos.y;
  const diag = Math.min(Math.abs(dx), Math.abs(dy));
  if (diag) {
    clock += diag * STEP * 1.15;
    pos = { x: pos.x + Math.sign(dx) * diag, y: pos.y + Math.sign(dy) * diag };
    turns.push({ t: clock, ...pos });
  }
  if (pos.x !== to.x) { clock += Math.abs(to.x - pos.x) * STEP; pos = { x: to.x, y: pos.y }; turns.push({ t: clock, ...pos }); }
  if (pos.y !== to.y) { clock += Math.abs(to.y - pos.y) * STEP; pos = { ...to }; turns.push({ t: clock, ...pos }); }
}

function sweep(cells, dir) {
  const left = new Set(cells);
  while (left.size) {
    let best;
    let bestDist = Infinity;
    for (const key of left) {
      const [x, y] = key.split(',').map(Number);
      const backwards = (x - pos.x) * dir < 0 ? 0.6 : 0;
      const dist = Math.max(Math.abs(x - pos.x), Math.abs(y - pos.y)) + backwards;
      if (dist < bestDist) { bestDist = dist; best = { x, y }; }
    }
    goTo(best);
    eatenAt.set(`${pos.x},${pos.y}`, clock);
    left.delete(`${pos.x},${pos.y}`);
  }
}

const active = [];
weeks.forEach((days, x) => days.forEach((level, y) => { if (level) active.push(`${x},${y}`); }));
sweep(active.filter((k) => +k.split(',')[1] <= 3), 1);
sweep(active.filter((k) => +k.split(',')[1] >= 4), -1);
goTo(start);
const LOOP = Math.max(clock, 4);
const dur = `${LOOP.toFixed(2)}s`;
const pct = (s) => ((s / LOOP) * 100).toFixed(3);

const path = turns.map((p) => `${pct(p.t)}%{transform:translate(${f(cx(p.x))}px,${f(cy(p.y))}px)}`).join('');

function render(theme) {
  const t = THEMES[theme];
  const tiles = [];
  weeks.forEach((days, x) => {
    days.forEach((level, y) => {
      const px = f(cx(x) - SIZE / 2);
      const py = f(cy(y) - SIZE / 2);
      const box = `x="${px}" y="${py}" width="${f(SIZE)}" height="${f(SIZE)}" rx="${f(RADIUS)}"`;
      tiles.push(`<rect ${box} fill="${t.tiles[0]}"/>`);
      if (!level) return;
      // A negative delay lines each tile's cycle up with the moment it is eaten.
      const delay = -(LOOP - eatenAt.get(`${x},${y}`));
      tiles.push(`<rect ${box} fill="${t.tiles[level]}" class="day" style="animation-delay:${delay.toFixed(2)}s"/>`);
    });
  });

  const tail = [];
  for (let i = TAIL; i >= 1; i--) {
    const k = i / TAIL;
    tail.push(`<g class="go" style="animation-delay:${(i * TAIL_GAP).toFixed(3)}s"><circle r="${(4.2 - 3.2 * k).toFixed(2)}" fill="${t.tail}" opacity="${(0.55 * (1 - k) + 0.05).toFixed(2)}"/></g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${total} contributions in the past year">
<title>${total} contributions in the past year</title>
<defs>
<filter id="halo" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.6"/></filter>
<filter id="lamp" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="9"/></filter>
<clipPath id="grid"><rect width="${width}" height="${height - 22}"/></clipPath>
</defs>
<style>
.day{transform-box:fill-box;transform-origin:center;animation:eat ${dur} linear infinite}
@keyframes eat{0%,26%{opacity:0;transform:scale(.3)}40%,100%{opacity:1;transform:scale(1)}}
.go{animation:orbit ${dur} linear infinite both}
@keyframes orbit{${path}}
@media (prefers-reduced-motion:reduce){.day{animation:none}.comet{display:none}}
.cap{font:11px ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.04em;fill:${t.caption}}
.num{fill:${t.number}}
</style>
${tiles.join('\n')}
<g class="comet" clip-path="url(#grid)">
${tail.join('\n')}
<g class="go"><circle r="30" fill="${t.lamp}" opacity="${t.lampOpacity}" filter="url(#lamp)"/><circle r="9" fill="${t.halo}" opacity="${t.haloOpacity}" filter="url(#halo)"/><circle r="4.6" fill="${t.core}"/></g>
</g>
<text class="cap" x="${width}" y="${height - 6}" text-anchor="end"><tspan class="num">${total}</tspan> contributions · past year</text>
</svg>
`;
}

await mkdir(outDir, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const file = join(outDir, `contributions-${theme}.svg`);
  await writeFile(file, render(theme));
  console.log(`wrote ${file}`);
}
console.log(`${total} contributions, ${weeks.length} weeks, ${active.length} active days, ${LOOP.toFixed(1)}s loop`);
