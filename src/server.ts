import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { createTerminal } from "./terminal.js";
import type { DeckSession, Point, Stroke, TerminalProcess } from "./types.js";

const require = createRequire(import.meta.url);
const MAX_STROKES = 2_000;
const MAX_POINTS = 100_000;

interface ServerOptions {
  host: string;
  port: number;
  presentationId: string;
  title: string;
  slideCount: number;
  html: string;
  cwd: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '\"': "&quot;",
  })[character]!);
}

function renderIndex(title: string, presentationId: string, slideCount: number): string {
  const deckUrl = `/p/${presentationId}`;
  const slides = Array.from({ length: slideCount }, (_, index) =>
    `<li><a href="${deckUrl}#${index + 1}"><span>Slide ${index + 1}</span><code>${deckUrl}#${index + 1}</code></a></li>`,
  ).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)} · sldz</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #161616; color: #f0f0f0; }
    * { box-sizing: border-box; }
    body { max-width: 760px; margin: 0 auto; padding: clamp(32px, 8vw, 90px) 24px; }
    h1 { margin: 0 0 8px; font-size: clamp(32px, 6vw, 58px); letter-spacing: -.04em; }
    p { margin: 0 0 38px; color: #959daf; }
    ul { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
    a { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 17px 19px; border: 1px solid #3a3a3a; border-radius: 0; background: #202020; color: #f0f0f0; text-decoration: none; }
    a:hover { border-color: #888; }
    code { overflow: hidden; color: #959daf; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .deck { margin-bottom: 24px; border-color: #f7c948; }
    .deck span { color: #ddd; font-weight: 700; }
    @media (max-width: 560px) { a { align-items: flex-start; flex-direction: column; gap: 5px; } code { max-width: 100%; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${slideCount} slide${slideCount === 1 ? "" : "s"} available</p>
  <a class="deck" href="${deckUrl}"><span>Open presentation</span><code>${deckUrl}</code></a>
  <ul>${slides}</ul>
</body>
</html>`;
}

function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Point;
  return Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && point.x >= 0
    && point.x <= 100_000
    && point.y >= 0
    && point.y <= 100_000
    && (point.pressure === undefined || (Number.isFinite(point.pressure) && point.pressure >= 0 && point.pressure <= 1));
}

function countPoints(strokes: Stroke[]): number {
  return strokes.reduce((total, stroke) => total + stroke.points.length, 0);
}

export async function startServer(options: ServerOptions): Promise<{ close(): Promise<void>; port: number }> {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { maxHttpBufferSize: 1e6 });
  const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
  const xtermEntry = require.resolve("@xterm/xterm");
  const xtermRoot = path.resolve(path.dirname(xtermEntry), "..");
  const perfectFreehandEntry = path.resolve(path.dirname(require.resolve("perfect-freehand")), "..", "esm", "index.mjs");

  app.use("/assets", express.static(publicDirectory));
  app.get("/assets/xterm/xterm.js", (_request, response) => response.sendFile(xtermEntry));
  app.get("/assets/xterm/xterm.css", (_request, response) => response.sendFile(path.join(xtermRoot, "css", "xterm.css")));
  app.get("/assets/xterm/addon-fit.js", (_request, response) => response.sendFile(require.resolve("@xterm/addon-fit")));
  app.get("/assets/perfect-freehand.js", (_request, response) => response.type("text/javascript").sendFile(perfectFreehandEntry));
  app.get(`/p/${options.presentationId}`, (_request, response) => response.type("html").send(options.html));
  const indexHtml = renderIndex(options.title, options.presentationId, options.slideCount);
  app.get(["/", "/index.html"], (_request, response) => response.type("html").send(indexHtml));
  app.use((_request, response) => response.status(404).send("Presentation not found"));

  const session: DeckSession = {
    id: options.presentationId,
    cwd: options.cwd,
    strokes: [],
  };
  // Drawing is collaborative, but every browser gets an isolated shell.
  const terminals = new Map<string, TerminalProcess>();
  const terminalsStarting = new Map<string, Promise<TerminalProcess>>();

  io.use((socket, next) => {
    if (socket.handshake.auth?.presentationId !== session.id) {
      next(new Error("Unknown presentation"));
      return;
    }
    next();
  });

  io.on("connection", (socket) => {
    socket.join(session.id);
    socket.emit("drawing:init", session.strokes);
    const drawingHistory: Array<
      | { type: "add"; id: string }
      | { type: "erase"; strokes: Array<{ stroke: Stroke; index: number }> }
    > = [];
    socket.data.drawingHistory = drawingHistory;
    const rememberDrawingAction = (action: (typeof drawingHistory)[number]) => {
      drawingHistory.push(action);
      if (drawingHistory.length > 500) drawingHistory.shift();
    };

    socket.on("draw:start", (candidate: unknown) => {
      if (!candidate || typeof candidate !== "object") return;
      const data = candidate as Partial<Stroke> & { point?: Point };
      if (typeof data.id !== "string" || data.id.length > 100 || !validPoint(data.point)) return;
      const stroke: Stroke = {
        id: `${socket.id}:${data.id}`,
        color: typeof data.color === "string" && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : "#f7c948",
        width: Math.min(40, Math.max(1, Number(data.width) || 4)),
        mode: data.mode === "erase" ? "erase" : "draw",
        points: [data.point],
      };
      session.strokes.push(stroke);
      rememberDrawingAction({ type: "add", id: stroke.id });
      while (session.strokes.length > MAX_STROKES || countPoints(session.strokes) > MAX_POINTS) session.strokes.shift();
      socket.broadcast.to(session.id).emit("draw:start", stroke);
      socket.emit("draw:ack", { localId: data.id, id: stroke.id });
      socket.data.strokeId = stroke.id;
    });

    socket.on("draw:move", (point: unknown) => {
      if (!validPoint(point) || typeof socket.data.strokeId !== "string") return;
      const stroke = session.strokes.find((item) => item.id === socket.data.strokeId);
      if (!stroke || countPoints(session.strokes) >= MAX_POINTS) return;
      stroke.points.push(point);
      socket.broadcast.to(session.id).emit("draw:move", { id: stroke.id, point });
    });

    socket.on("draw:end", () => {
      if (typeof socket.data.strokeId === "string") {
        socket.broadcast.to(session.id).emit("draw:end", socket.data.strokeId);
        delete socket.data.strokeId;
      }
    });

    socket.on("draw:erase", (candidate: unknown) => {
      if (!Array.isArray(candidate)) return;
      const candidates = candidate.filter((id): id is string => typeof id === "string").slice(0, 100);
      const ids = new Set(candidates);
      for (const id of candidates) ids.add(`${socket.id}:${id}`);
      if (!ids.size) return;
      const removed: Array<{ stroke: Stroke; index: number }> = [];
      session.strokes = session.strokes.filter((stroke, index) => {
        if (!ids.has(stroke.id)) return true;
        removed.push({ stroke, index });
        return false;
      });
      if (removed.length) rememberDrawingAction({ type: "erase", strokes: removed });
      for (const { stroke } of removed) io.to(session.id).emit("draw:remove", stroke.id);
    });

    socket.on("draw:undo", () => {
      while (drawingHistory.length) {
        const action = drawingHistory.pop()!;
        if (action.type === "erase") {
          for (const { stroke, index } of action.strokes) session.strokes.splice(Math.min(index, session.strokes.length), 0, stroke);
          io.to(session.id).emit("drawing:init", session.strokes);
          return;
        }
        const index = session.strokes.findIndex((stroke) => stroke.id === action.id);
        if (index < 0) continue;
        const [stroke] = session.strokes.splice(index, 1);
        io.to(session.id).emit("draw:remove", stroke.id);
        return;
      }
    });

    socket.on("draw:clear", () => {
      session.strokes = [];
      for (const client of io.sockets.sockets.values()) {
        if (Array.isArray(client.data.drawingHistory)) client.data.drawingHistory.length = 0;
      }
      io.to(session.id).emit("draw:clear");
    });

    socket.on("terminal:open", async () => {
      if (terminals.has(socket.id) || terminalsStarting.has(socket.id)) return;
      const starting = createTerminal(session.cwd);
      terminalsStarting.set(socket.id, starting);
      let terminal: TerminalProcess;
      try {
        terminal = await starting;
      } catch (error) {
        terminalsStarting.delete(socket.id);
        socket.emit("terminal:data", `\r\n[unable to create PTY: ${error instanceof Error ? error.message : String(error)}]\r\n`);
        socket.emit("terminal:exit");
        return;
      }
      terminalsStarting.delete(socket.id);
      if (!socket.connected) {
        terminal.kill();
        return;
      }
      terminals.set(socket.id, terminal);
      terminal.onData((data) => socket.emit("terminal:data", data));
      terminal.onExit((code) => {
        socket.emit("terminal:data", `\r\n[process exited with code ${code}]\r\n`);
        socket.emit("terminal:exit");
        terminals.delete(socket.id);
      });
    });

    socket.on("terminal:input", (data: unknown) => {
      if (typeof data === "string" && data.length <= 10_000) terminals.get(socket.id)?.write(data);
    });

    socket.on("terminal:resize", (size: unknown) => {
      if (!size || typeof size !== "object") return;
      const { cols, rows } = size as { cols: number; rows: number };
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 1 && rows > 1 && cols < 500 && rows < 500) {
        terminals.get(socket.id)?.resize(cols, rows);
      }
    });

    socket.on("disconnect", () => {
      terminals.get(socket.id)?.kill();
      terminals.delete(socket.id);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => resolve());
  });
  const address = httpServer.address();
  const actualPort = typeof address === "object" && address ? address.port : options.port;

  return {
    port: actualPort,
    close: async () => {
      for (const terminal of terminals.values()) terminal.kill();
      terminals.clear();
      io.close();
      await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    },
  };
}
