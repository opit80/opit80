// Draws the past year of GitHub contributions as a grid of soft violet tiles
// with a diagonal light sweep, in a dark and a light variant.
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
  dark: { tiles: ['#17161f', '#33285a', '#5a40a8', '#8d66e0', '#d2b8ff'], rest: 0.5, caption: '#6e7681', number: '#9198a1' },
  light: { tiles: ['#efedf5', '#d8c9f8', '#b08ef0', '#8456dc', '#5a2bbf'], rest: 0.6, caption: '#818b98', number: '#59636e' },
};

const GAP = 13.4;
const SIZE = 9.4;
const RADIUS = 2.6;
const PAD = 8;
const width = Math.round(PAD * 2 + (weeks.length - 1) * GAP);
const height = 124;

function render(theme) {
  const t = THEMES[theme];
  const tiles = [];
  weeks.forEach((days, x) => {
    days.forEach((level, y) => {
      const px = (PAD + x * GAP - SIZE / 2).toFixed(1);
      const py = (PAD + y * GAP - SIZE / 2).toFixed(1);
      // The sweep travels from the top-left corner to the bottom-right one.
      const sweep = level ? ` class="on" style="animation-delay:${((x + y * 2.2) * 0.04).toFixed(2)}s"` : '';
      tiles.push(`<rect x="${px}" y="${py}" width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${t.tiles[level]}"${sweep}/>`);
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${total} contributions in the past year">
<title>${total} contributions in the past year</title>
<style>
.on{opacity:${t.rest};animation:sweep 6s ease-in-out infinite}
@keyframes sweep{0%,100%{opacity:${t.rest}}7%{opacity:1}16%{opacity:${t.rest}}}
@media (prefers-reduced-motion:reduce){.on{animation:none;opacity:1}}
.cap{font:11px ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.04em;fill:${t.caption}}
.num{fill:${t.number}}
</style>
${tiles.join('\n')}
<text class="cap" x="${width - PAD}" y="${height - 6}" text-anchor="end"><tspan class="num">${total}</tspan> contributions · past year</text>
</svg>
`;
}

await mkdir(outDir, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const file = join(outDir, `contributions-${theme}.svg`);
  await writeFile(file, render(theme));
  console.log(`wrote ${file}`);
}
console.log(`${total} contributions, ${weeks.length} weeks`);
