export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface Stroke {
  id: string;
  color: string;
  width: number;
  mode?: "draw" | "erase";
  points: Point[];
}

export interface DeckSession {
  id: string;
  cwd: string;
  strokes: Stroke[];
}

export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
}
