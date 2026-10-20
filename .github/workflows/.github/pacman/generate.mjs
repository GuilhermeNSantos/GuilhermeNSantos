// Gera um Pac-Man animado (SVG) que come o seu gráfico de contribuições do GitHub.
// Sem dependências: roda com Node 18+ (o ubuntu-latest já tem Node 20).

import { mkdirSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER || process.env.GITHUB_REPOSITORY_OWNER;
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_DIR || "dist";
const MOCK = process.env.MOCK === "1"; // MOCK=1 gera com dados falsos (teste local)

// ---------- ajustes fáceis de mexer ----------
const PITCH = 16; // tamanho de cada quadradinho do gráfico
const PAD = 22; // margem interna
const R = 6.5; // raio inicial do Pac-Man
const STEP = 0.075; // segundos por casa (menor = mais rápido)
const MOVE_FRAC = 0.9; // parte do loop em que ele anda (o resto é pausa)
const MAX_GROW = 0.4; // quanto ele cresce no total (0.4 = +40%)

const THEMES = {
  "pacman.svg": {
    bg1: "#ffffff",
    bg2: "#f1f5fb",
    border: "#2f6bff",
    empty: "#d0d7de",
    levels: ["#9be9a8", "#40c463", "#30a14e", "#216e39"],
    eye: "#1b1b1b",
  },
  "pacman-dark.svg": {
    bg1: "#0d1117",
    bg2: "#10161f",
    border: "#2f6bff",
    empty: "#262c36",
    levels: ["#0e4429", "#006d32", "#26a641", "#39d353"],
    eye: "#1b1b1b",
  },
};

const DOT_R = [1.3, 2.4, 3.1, 3.8, 4.5]; // raio da bolinha por nível (0 a 4)

// ---------- dados ----------
async function fetchWeeks() {
  if (MOCK) {
    return Array.from({ length: 53 }, (_, x) =>
      Array.from({ length: 7 }, (_, y) => ({
        weekday: y,
        contributionCount: Math.random() < 0.45 ? Math.floor(Math.random() * 12) : 0,
      }))
    );
  }
  if (!USER || !TOKEN) throw new Error("Faltou GH_USER ou GITHUB_TOKEN");
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount weekday}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "pacman-contribution-graph",
    },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  if (json.errors || !json.data?.user) {
    throw new Error("Erro na API do GitHub: " + JSON.stringify(json.errors || json));
  }
  return json.data.user.contributionsCollection.contributionCalendar.weeks.map(
    (w) => w.contributionDays
  );
}

// ---------- SVG ----------
function build(weeks, t) {
  const cols = weeks.length;
  const grid = Array.from({ length: cols }, () => Array(7).fill(null));
  weeks.forEach((days, x) =>
    days.forEach((d) => {
      grid[x][d.weekday] = d.contributionCount;
    })
  );
  const max = Math.max(1, ...grid.flat().filter((v) => v !== null));
  const N = cols * 7;
  const W = PAD * 2 + cols * PITCH;
  const H = PAD * 2 + 7 * PITCH;
  const DUR = (N * STEP) / MOVE_FRAC;

  const cx = (x) => PAD + x * PITCH + PITCH / 2;
  const cy = (y) => PAD + y * PITCH + PITCH / 2;
  // ordem em zigue-zague: coluna 0 desce, coluna 1 sobe, ...
  const idx = (x, y) => x * 7 + (x % 2 === 0 ? y : 6 - y);
  const pct = (i) => ((i / (N - 1)) * MOVE_FRAC * 100).toFixed(3) + "%";

  let dots = "";
  let dotCss = "";
  const eaten = []; // índices das casas com contribuição (as que fazem ele crescer)

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < 7; y++) {
      const v = grid[x][y];
      if (v === null) continue;
      const i = idx(x, y);
      const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
      if (level > 0) eaten.push(i);
      const fill = level === 0 ? t.empty : t.levels[level - 1];
      const p = (i / (N - 1)) * MOVE_FRAC * 100;
      dotCss += `@keyframes k${i}{${p.toFixed(3)}%{opacity:1}${(p + 0.01).toFixed(3)}%{opacity:0}98.5%{opacity:0}99.5%{opacity:1}}`;
      dots += `<circle class="d" style="animation-name:k${i}" cx="${cx(x)}" cy="${cy(y)}" r="${DOT_R[level]}" fill="${fill}"/>`;
    }
  }
  eaten.sort((a, b) => a - b);

  // movimento (só nos cantos, o resto é interpolação linear)
  const move = new Map();
  const rot = new Map();
  for (let c = 0; c < cols; c++) {
    const yStart = c % 2 === 0 ? 0 : 6;
    const yEnd = c % 2 === 0 ? 6 : 0;
    move.set(pct(c * 7), `translate(${cx(c)}px,${cy(yStart)}px)`);
    move.set(pct(c * 7 + 6), `translate(${cx(c)}px,${cy(yEnd)}px)`);
    rot.set(pct(c * 7), c % 2 === 0 ? 90 : -90);
    if (c < cols - 1) rot.set(pct(c * 7 + 6), 0);
  }
  const moveKf = [...move].map(([k, v]) => `${k}{transform:${v}}`).join("");
  const rotKf = [...rot].map(([k, v]) => `${k}{transform:rotate(${v}deg)}`).join("");

  // crescimento: um tiquinho a cada bolinha de contribuição comida
  const grow = new Map([["0.000%", 1]]);
  eaten.forEach((i, k) => grow.set(pct(i), 1 + (MAX_GROW * (k + 1)) / eaten.length));
  const growKf = [...grow].map(([k, v]) => `${k}{transform:scale(${v.toFixed(4)})}`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Pac-Man comendo o gráfico de contribuições">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${t.bg2}"/></linearGradient>
  <radialGradient id="pg" gradientUnits="userSpaceOnUse" cx="-2" cy="-2.5" r="${R * 1.35}">
    <stop offset="0" stop-color="#fff59a"/><stop offset="0.55" stop-color="#ffd400"/><stop offset="1" stop-color="#ffab00"/>
  </radialGradient>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
    <feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="#ffd400" flood-opacity="0.65"/>
  </filter>
</defs>
<style>
  .d{animation-duration:${DUR.toFixed(2)}s;animation-timing-function:linear;animation-iteration-count:infinite}
  .pac{animation:move ${DUR.toFixed(2)}s linear infinite,fade ${DUR.toFixed(2)}s linear infinite}
  .dir{animation:turn ${DUR.toFixed(2)}s step-end infinite}
  .size{animation:grow ${DUR.toFixed(2)}s linear infinite}
  .jt{animation:chompT .22s ease-in-out infinite alternate}
  .jb{animation:chompB .22s ease-in-out infinite alternate}
  .jt,.jb{transform-origin:0 0}
  @keyframes move{${moveKf}}
  @keyframes turn{${rotKf}}
  @keyframes grow{${growKf}}
  @keyframes fade{0%,96%{opacity:1}99%,100%{opacity:0}}
  @keyframes chompT{from{transform:rotate(-2deg)}to{transform:rotate(-40deg)}}
  @keyframes chompB{from{transform:rotate(2deg)}to{transform:rotate(40deg)}}
  ${dotCss}
  @media (prefers-reduced-motion:reduce){.pac,.dir,.size,.jt,.jb,.d{animation:none}}
</style>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="url(#bg)" stroke="${t.border}" stroke-width="2"/>
<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="12" fill="none" stroke="${t.border}" stroke-opacity="0.35" stroke-width="1"/>
${dots}
<g class="pac" style="transform:translate(${cx(0)}px,${cy(0)}px)"><g class="dir" style="transform:rotate(90deg)"><g class="size" filter="url(#glow)">
  <g class="jt"><path d="M0 0L${R} 0A${R} ${R} 0 0 0 ${-R} 0Z" fill="url(#pg)"/></g>
  <g class="jb"><path d="M0 0L${R} 0A${R} ${R} 0 0 1 ${-R} 0Z" fill="url(#pg)"/></g>
  <circle cx="${(R * 0.12).toFixed(2)}" cy="${(-R * 0.52).toFixed(2)}" r="${(R * 0.15).toFixed(2)}" fill="${t.eye}"/>
</g></g></g>
</svg>`;
}

const weeks = await fetchWeeks();
mkdirSync(OUT, { recursive: true });
for (const [file, theme] of Object.entries(THEMES)) {
  writeFileSync(`${OUT}/${file}`, build(weeks, theme));
  console.log("gerado:", `${OUT}/${file}`);
}
