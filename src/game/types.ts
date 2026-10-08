export type Side = "white" | "black";
export type Kind = "bastion" | "carver" | "leaper" | "link";
export type Square = number;
export type Piece = {
  id: string;
  side: Side;
  kind: Kind;
  square: Square;
  remaining: number;
  summonedPly: number;
};
export type Outcome =
  | { kind: "win"; winner: Side }
  | { kind: "draw"; reason: "passes" | "limit" }
  | null;
export type GameState = {
  pieces: readonly Piece[];
  cores: Record<Side, Square>;
  grain: Record<Side, number>;
  turn: Side;
  ply: number;
  consecutivePasses: number;
  outcome: Outcome;
};
export type Action =
  | { type: "summon"; kind: Kind; duration: number; to: Square }
  | { type: "move"; pieceId: string; to: Square }
  | { type: "swap"; pieceId: string; allyId: string }
  | { type: "pass" };
export type GameEvent = {
  type: "summon" | "move" | "swap" | "capture" | "income" | "expire" | "finish";
  side: Side;
  pieceIds: readonly string[];
  squares: readonly Square[];
  amount: number;
};
export type Transition =
  | { ok: true; state: GameState; events: readonly GameEvent[] }
  | { ok: false; state: GameState; error: string };
export type Preview = {
  cost: number;
  reward: number;
  grainAfter: number;
  expires: readonly string[];
  targets: readonly Square[];
  paths: readonly (readonly Square[])[];
};
export type Selection = {
  pieceId: string | null;
  candidate: Action | null;
  summon?: { kind: Kind; duration: number } | null;
  inspectOnly?: boolean;
};
