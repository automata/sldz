import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
  const testDirectory = await mkdtemp(path.join(tmpdir(), "sldz-test-"));
  const markdownPath = path.join(testDirectory, "slides.md");
  await writeFile(markdownPath, "# Test\n\n---\n\n# Second\n");
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    presentationId,
    title: "Test deck",
    slideCount: 2,
    html: "<!doctype html><title>test</title>",
    cwd: testDirectory,
    markdownPath,
  });
  const url = `http://127.0.0.1:${server.port}`;
  const indexResponse = await fetch(url);
  const indexHtml = await indexResponse.text();
  assert.equal(indexResponse.status, 200);
  assert.match(indexHtml, /Test deck/);
  assert.match(indexHtml, new RegExp(`/p/${presentationId}#2`));

  const markdownResponse = await fetch(`${url}/api/markdown?presentationId=${presentationId}`);
  assert.match(await markdownResponse.text(), /# Second/);
  const updateResponse = await fetch(`${url}/api/markdown`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presentationId, markdown: "# Edited\n\n---\n\n# Second\n" }),
  });
  assert.equal(updateResponse.status, 200);
  assert.match(await (await fetch(`${url}/p/${presentationId}`)).text(), /Edited/);

  const imageForm = new FormData();
  imageForm.append("presentationId", presentationId);
  imageForm.append("slideIndex", "0");
  imageForm.append("image", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "test.png");
  const imageResponse = await fetch(`${url}/api/images`, { method: "POST", body: imageForm });
  assert.equal(imageResponse.status, 200);
  const imageResult = await imageResponse.json() as { src: string };
  assert.match(await readFile(markdownPath, "utf8"), /!\[test\]\(assets\//);

  const layoutResponse = await fetch(`${url}/api/layout`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presentationId, images: { "0:assets/test.png:0": { x: 0.25, y: 0.5 } } }),
  });
  assert.equal(layoutResponse.status, 200);
  assert.match(await readFile(path.join(testDirectory, "slides.json"), "utf8"), /0\.25/);

  const deleteResponse = await fetch(`${url}/api/images`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presentationId, slideIndex: 0, src: imageResult.src }),
  });
  assert.equal(deleteResponse.status, 200);
  assert.doesNotMatch(await readFile(markdownPath, "utf8"), /!\[test\]\(assets\//);

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

    const slideStart = once<{ id: string; surface: string }>(second, "draw:start");
    first.emit("draw:start", { id: "slide-stroke", color: "#ffffff", width: 4, surface: "slide", slideIndex: 1, normalized: true, point: { x: 0.25, y: 0.5 } });
    assert.equal((await slideStart).surface, "slide");
    const slideEnd = once<string>(second, "draw:end");
    first.emit("draw:end");
    await slideEnd;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const savedLayout = JSON.parse(await readFile(path.join(testDirectory, "slides.json"), "utf8")) as { images: object; drawings: Array<{ surface: string }> };
    assert.ok(Object.keys(savedLayout.images).length > 0);
    assert.ok(savedLayout.drawings.some((stroke) => stroke.surface === "canvas"));
    assert.ok(savedLayout.drawings.some((stroke) => stroke.surface === "slide"));
  } finally {
    first.close();
    second.close();
    await server.close();
    await rm(testDirectory, { recursive: true, force: true });
  }
});
