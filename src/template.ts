import type { Slide } from "./markdown.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '\"': "&quot;",
  })[character]!);
}

export function renderDocument(title: string, slides: Slide[], presentationId: string): string {
  const sections = slides.map((slide, index) =>
    `<section class="slide${index === 0 ? " is-active" : ""}" data-slide="${index}" aria-hidden="${index !== 0}">\n<div class="slide-content">${slide.html}</div>\n</section>`,
  ).join("\n");

  const config = JSON.stringify({ presentationId, slideCount: slides.length }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(title)}</title>
  <link rel="preload" href="/assets/fonts/0xProtoNerdFontMono-Regular.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="stylesheet" href="/assets/xterm/xterm.css">
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <main id="deck" class="deck">${sections}<textarea id="markdown-editor" hidden spellcheck="false" aria-label="Markdown editor"></textarea></main>
  <div class="progress"><span id="progress-bar"></span></div>
  <div class="slide-number"><span id="current-slide">1</span> / ${slides.length}</div>

  <nav class="tools" aria-label="Presentation tools">
    <button id="draw-toggle" type="button" title="Collaborative drawing (D)" aria-label="Drawing" aria-pressed="false">✎</button>
    <button id="terminal-toggle" type="button" title="Terminal (T)" aria-label="Terminal" aria-pressed="false">›_</button>
    <button id="iframe-toggle" type="button" title="Web pane" aria-label="Web pane" aria-pressed="false">◎</button>
    <button id="markdown-edit-toggle" type="button" title="Edit Markdown" aria-label="Edit Markdown" aria-pressed="false">&lt;/&gt;</button>
    <button id="slide-maximize" type="button" title="Maximize slide" aria-label="Maximize slide" aria-pressed="false">□</button>
    <button id="pane-position" type="button" title="Move panes to the left" aria-label="Move panes to the left">←</button>
    <button id="fullscreen" type="button" title="Browser fullscreen (F)" aria-label="Present">⛶</button>
  </nav>

  <aside id="draw-window" class="floating-pane draw-window" hidden aria-label="Drawing canvas">
    <div class="pane-resizer pane-resizer-x" role="separator" aria-orientation="vertical" aria-label="Resize canvas width"></div>
    <div class="pane-resizer pane-resizer-y" role="separator" aria-orientation="horizontal" aria-label="Resize canvas height"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="n"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="e"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="s"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="w"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="ne"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="se"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="sw"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="nw"></div>
    <section id="draw-panel" class="panel-view">
      <svg id="drawing-canvas" xmlns="http://www.w3.org/2000/svg" aria-label="Collaborative vector drawing"></svg>
      <div class="pane-drag-strip" aria-hidden="true"></div>
      <div class="pane-controls pane-controls-left color-palette" role="group" aria-label="Drawing color">
        <button class="color-swatch is-selected" type="button" data-color="#ffffff" title="White" aria-label="White" aria-pressed="true"></button>
        <button class="color-swatch" type="button" data-color="#f5d547" title="Yellow" aria-label="Yellow" aria-pressed="false"></button>
        <button class="color-swatch" type="button" data-color="#ff984f" title="Orange" aria-label="Orange" aria-pressed="false"></button>
        <button class="color-swatch" type="button" data-color="#62a8ff" title="Blue" aria-label="Blue" aria-pressed="false"></button>
        <button class="color-swatch" type="button" data-color="#84e39a" title="Light green" aria-label="Light green" aria-pressed="false"></button>
        <button class="color-swatch" type="button" data-color="#ff8585" title="Light red" aria-label="Light red" aria-pressed="false"></button>
        <button id="brush-size" class="drawing-tool" data-level="normal" type="button" title="Brush size: normal" aria-label="Brush size: normal">●</button>
        <button id="clear-canvas" class="drawing-tool" type="button" title="Clear all drawing" aria-label="Clear all drawing">⌫</button>
        <button id="undo-drawing" class="drawing-tool" type="button" title="Undo last stroke" aria-label="Undo last stroke">↶</button>
        <button id="eraser-toggle" class="drawing-tool" type="button" title="Eraser" aria-label="Eraser" aria-pressed="false">▱</button>
      </div>
      <div class="pane-controls pane-controls-right pane-actions">
        <button class="pane-maximize-vertical" data-pane="draw" type="button" title="Maximize canvas vertically" aria-label="Maximize canvas vertically" aria-pressed="false">↕</button>
        <button class="pane-maximize" data-pane="draw" type="button" title="Maximize canvas" aria-label="Maximize canvas">□</button>
        <button class="pane-detach" data-pane="draw" type="button" title="Detach or dock canvas" aria-label="Detach canvas">↗</button>
        <button class="pane-close" data-pane="draw" type="button" aria-label="Close canvas">×</button>
      </div>
    </section>
  </aside>

  <aside id="terminal-window" class="floating-pane terminal-window" hidden aria-label="Terminal">
    <div class="pane-resizer pane-resizer-x" role="separator" aria-orientation="vertical" aria-label="Resize terminal width"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="n"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="e"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="s"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="w"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="ne"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="se"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="sw"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="nw"></div>
    <section id="terminal-panel" class="panel-view">
      <div id="terminal"></div>
      <div class="pane-drag-strip" aria-hidden="true"></div>
      <div class="pane-controls pane-controls-right pane-actions">
        <button id="terminal-font-size" data-level="normal" type="button" title="Terminal font: normal" aria-label="Terminal font: normal">A</button>
        <button class="pane-maximize-vertical" data-pane="terminal" type="button" title="Maximize terminal vertically" aria-label="Maximize terminal vertically" aria-pressed="false">↕</button>
        <button class="pane-maximize" data-pane="terminal" type="button" title="Maximize terminal" aria-label="Maximize terminal">□</button>
        <button class="pane-detach" data-pane="terminal" type="button" title="Detach or dock terminal" aria-label="Detach terminal">↗</button>
        <button class="pane-close" data-pane="terminal" type="button" aria-label="Close terminal">×</button>
      </div>
    </section>
  </aside>

  <aside id="iframe-window" class="floating-pane iframe-window" hidden aria-label="Web pane">
    <div class="pane-resizer pane-resizer-x"></div>
    <div class="pane-resizer pane-resizer-y"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="n"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="e"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="s"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="w"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="ne"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="se"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="sw"></div>
    <div class="pane-resizer pane-resizer-detached" data-resize-edge="nw"></div>
    <section id="iframe-panel" class="panel-view">
      <form id="iframe-address" class="iframe-address">
        <input id="iframe-url" type="url" inputmode="url" placeholder="https://example.com" aria-label="URL">
        <button type="submit" title="Open URL" aria-label="Open URL">→</button>
      </form>
      <div class="pane-drag-strip" aria-hidden="true"></div>
      <div class="pane-controls pane-controls-right pane-actions">
        <button class="pane-maximize-vertical" data-pane="iframe" type="button" title="Maximize web pane vertically" aria-label="Maximize web pane vertically" aria-pressed="false">↕</button>
        <button class="pane-maximize" data-pane="iframe" type="button" title="Maximize web pane" aria-label="Maximize web pane">□</button>
        <button class="pane-detach" data-pane="iframe" type="button" title="Detach web pane" aria-label="Detach web pane">↗</button>
        <button class="pane-close" data-pane="iframe" type="button" aria-label="Close web pane">×</button>
      </div>
      <iframe id="web-iframe" title="Web content" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>
    </section>
  </aside>

  <script>window.__SLDZ__ = ${config};</script>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/assets/xterm/xterm.js"></script>
  <script src="/assets/xterm/addon-fit.js"></script>
  <script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}
