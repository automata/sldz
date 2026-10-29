import assert from "node:assert/strict";
import test from "node:test";
import { io, type Socket } from "socket.io-client";
import { startServer } from "./server.js";

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 2_000);
    socket.once(event, (value: T) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

test("broadcasts complete drawing strokes to other clients", async () => {
  const presentationId = "drawing-test";
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    presentationId,
    title: "Test deck",
    slideCount: 2,
    html: "<!doctype html><title>test</title>",
    cwd: process.cwd(),
  });
  const url = `http://127.0.0.1:${server.port}`;
  const indexResponse = await fetch(url);
  const indexHtml = await indexResponse.text();
  assert.equal(indexResponse.status, 200);
  assert.match(indexHtml, /Test deck/);
  assert.match(indexHtml, new RegExp(`/p/${presentationId}#2`));

  const first = io(url, { auth: { presentationId }, transports: ["websocket"] });
  const second = io(url, { auth: { presentationId }, transports: ["websocket"] });

  try {
    await Promise.all([once(first, "connect"), once(second, "connect")]);
    const startReceived = once<{ id: string; points: Array<{ x: number; y: number }> }>(second, "draw:start");
    first.emit("draw:start", { id: "local", color: "#ffffff", width: 4, point: { x: 120, y: 80 } });
    const stroke = await startReceived;
    assert.deepEqual(stroke.points, [{ x: 120, y: 80 }]);

    const moveReceived = once<{ id: string; point: { x: number; y: number } }>(second, "draw:move");
    first.emit("draw:move", { x: 420, y: 310 });
    const move = await moveReceived;
    assert.equal(move.id, stroke.id);
    assert.deepEqual(move.point, { x: 420, y: 310 });

    const removeReceived = once<string>(second, "draw:remove");
    first.emit("draw:undo");
    assert.equal(await removeReceived, stroke.id);

    const eraseStart = once<{ id: string }>(second, "draw:start");
    first.emit("draw:start", { id: "erasable", color: "#ffffff", width: 4, point: { x: 30, y: 30 } });
    const erasableStroke = await eraseStart;
    const erased = once<string>(second, "draw:remove");
    first.emit("draw:erase", [erasableStroke.id]);
    assert.equal(await erased, erasableStroke.id);

    const restored = once<Array<{ id: string }>>(second, "drawing:init");
    first.emit("draw:undo");
    assert.ok((await restored).some((item) => item.id === erasableStroke.id));
  } finally {
    first.close();
    second.close();
    await server.close();
  }
});
