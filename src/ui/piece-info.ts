import type { Kind } from "../game/types";
export const INFO: Record<
  Kind,
  { name: string; short: string; description: string; path: string }
> = {
  bastion: {
    name: "バスティオン",
    short: "守る",
    description: "動かない壁。通路をふさぎ、リーパーの足場になる。",
    path: "M10 39V18h6v6h5V14h6v10h5v-6h6v21Z M7 43h34",
  },
  carver: {
    name: "カーヴァー",
    short: "曲がる",
    description: "縦横に1マス、その後直角に1〜2マス。途中の駒は越えられない。",
    path: "M11 42h28M16 38C9 24 21 11 36 6C28 19 21 27 31 38Z",
  },
  leaper: {
    name: "リーパー",
    short: "跳ぶ",
    description:
      "隣の駒を飛び越え、すぐ向こうに着地。敵味方どちらも足場になる。",
    path: "M9 42h30M13 37C8 29 15 13 28 15l7-8 1 15-10 6 8 10H13Z M25 20h1",
  },
  link: {
    name: "リンク",
    short: "入れ替え",
    description:
      "縦横に隣接する味方と位置交換。残り期間は変わらない。攻撃不可。",
    path: "M8 42h32M25 16c-9-10-21 3-12 12l7 7c7 6 15-1 12-8 M23 31c9 10 21-3 12-12l-7-7c-7-6-15 1-12 8",
  },
};
export function icon(kind: Kind) {
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="${INFO[kind].path}" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
export const coreIcon =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m24 7 12 17-12 17L12 24Z" fill="currentColor"/><circle cx="24" cy="24" r="5" fill="#b3a077"/></svg>';
export const squareName = (q: number) =>
  `${"abcdefg"[q % 7]}${Math.floor(q / 7) + 1}`;
