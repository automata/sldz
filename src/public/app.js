import { getStroke } from "/assets/perfect-freehand.js";

(() => {
  const config = window.__SLDZ__;
  const slides = [...document.querySelectorAll(".slide")];
  const deck = document.getElementById("deck");
  const currentLabel = document.getElementById("current-slide");
  const previousSlideButton = document.getElementById("previous-slide");
  const nextSlideButton = document.getElementById("next-slide");
  const progressBar = document.getElementById("progress-bar");
  const drawWindow = document.getElementById("draw-window");
  const drawPanel = document.getElementById("draw-panel");
  const terminalWindow = document.getElementById("terminal-window");
  const iframeWindow = document.getElementById("iframe-window");
  const terminalPanel = document.getElementById("terminal-panel");
  const drawToggle = document.getElementById("draw-toggle");
  const slideDrawingToggle = document.getElementById("slide-drawing-toggle");
  const terminalToggle = document.getElementById("terminal-toggle");
  const iframeToggle = document.getElementById("iframe-toggle");
  const markdownEditToggle = document.getElementById("markdown-edit-toggle");
  const markdownEditor = document.getElementById("markdown-editor");
  const panes = { draw: drawWindow, terminal: terminalWindow, iframe: iframeWindow };
  const paneToggles = { draw: drawToggle, terminal: terminalToggle, iframe: iframeToggle };
  const slideMaximize = document.getElementById("slide-maximize");
  const panePositionButton = document.getElementById("pane-position");
  let slideIndex = Math.max(0, Math.min(slides.length - 1, Number(location.hash.slice(1)) - 1 || 0));
  const panePositions = ["right", "left", "top", "bottom"];
  const panePositionIcons = { right: "→", left: "←", top: "↑", bottom: "↓" };
  let panePositionIndex = 0;
  let paneZIndex = 30;
  let maximizedMode = null;
  let drawingOverSlide = false;
  let repaintDrawing = () => {};
  let positionDrawingOverlay = () => {};
  document.body.classList.add("panes-right");

  function resizeSlideStages() {
    const scale = Math.max(0.01, Math.min(deck.clientWidth / 1600, deck.clientHeight / 900));
    const width = deck.clientWidth / scale;
    const height = deck.clientHeight / scale;
    document.querySelectorAll(".slide-stage").forEach((stage) => {
      stage.style.setProperty("--slide-scale", String(scale));
      stage.style.setProperty("--slide-stage-width", `${width}px`);
      stage.style.setProperty("--slide-stage-height", `${height}px`);
    });
  }
  new ResizeObserver(resizeSlideStages).observe(deck);
  resizeSlideStages();

  function showSlide(next, updateHash = true) {
    slideIndex = Math.max(0, Math.min(slides.length - 1, next));
    slides.forEach((slide, index) => {
      const active = index === slideIndex;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
    });
    currentLabel.textContent = String(slideIndex + 1);
    previousSlideButton.disabled = slideIndex === 0;
    nextSlideButton.disabled = slideIndex === slides.length - 1;
    progressBar.style.width = `${((slideIndex + 1) / slides.length) * 100}%`;
    if (updateHash) history.replaceState(null, "", `#${slideIndex + 1}`);
    positionDrawingOverlay();
    repaintDrawing();
  }

  function makeMarkdownCollapsible(content) {
    content.querySelectorAll("li").forEach((item) => {
      const nested = [...item.children].find((child) => child.matches("ul, ol"));
      if (!nested) return;
      item.classList.add("markdown-collapsible-item");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-expanded", "true");
      item.title = "Collapse nested items";
      const toggle = () => {
        nested.hidden = !nested.hidden;
        item.setAttribute("aria-expanded", String(!nested.hidden));
        item.title = nested.hidden ? "Expand nested items" : "Collapse nested items";
      };
      item.addEventListener("click", (event) => {
        if (nested.contains(event.target) || event.target.closest("a, button, input, label")) return;
        toggle();
      });
      item.addEventListener("keydown", (event) => {
        if (event.target === item && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          toggle();
        }
      });
    });
  }

  const imageLayout = { images: {} };
  let selectedFigure = null;
  function imageLayoutKey(figure, index) {
    const image = figure.querySelector("img");
    const figures = [...slides[index].querySelectorAll("figure.markdown-image")];
    const sameSource = figures.filter((candidate) => candidate.querySelector("img")?.getAttribute("src") === image.getAttribute("src"));
    return `${index}:${image.getAttribute("src")}:${sameSource.indexOf(figure)}`;
  }

  function applyImagePosition(figure, position) {
    if (!position) return;
    figure.classList.add("is-positioned");
    figure.style.left = `calc(50% - 800px + ${position.x * 1600}px)`;
    figure.style.top = `calc(50% - 450px + ${position.y * 900}px)`;
    if (position.width) figure.style.width = `${position.width * 1600}px`;
  }

  function selectFigure(figure) {
    selectedFigure?.classList.remove("is-selected");
    selectedFigure = figure;
    figure?.classList.add("is-selected");
    figure?.focus({ preventScroll: true });
  }

  function ensureFigurePositioned(figure, index) {
    const slideRect = slides[index].querySelector(".slide-stage").getBoundingClientRect();
    const figureRect = figure.getBoundingClientRect();
    return { slideRect, figureRect };
  }

  function saveImageLayout() {
    fetch("/api/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presentationId: config.presentationId, images: imageLayout.images }),
    }).catch(() => undefined);
  }

  async function deleteSelectedFigure() {
    if (!selectedFigure) return;
    const figure = selectedFigure;
    const key = figure.dataset.layoutKey;
    const src = figure.querySelector("img")?.getAttribute("src");
    const slide = Number(figure.dataset.slideIndex);
    if (!src) return;
    const response = await fetch("/api/images", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presentationId: config.presentationId, slideIndex: slide, src }),
    });
    if (!response.ok) return;
    delete imageLayout.images[key];
    selectedFigure = null;
    figure.remove();
    saveImageLayout();
  }

  function registerDraggableFigure(figure, index, assignedKey = imageLayoutKey(figure, index)) {
    const key = assignedKey;
    const stage = slides[index].querySelector(".slide-stage");
    const stageRect = stage.getBoundingClientRect();
    const initialRect = figure.getBoundingClientRect();
    figure.dataset.layoutKey = key;
    figure.dataset.slideIndex = String(index);
    figure.setAttribute("tabindex", "0");
    figure.querySelector("img")?.setAttribute("draggable", "false");
    stage.append(figure);
    const stageScale = stageRect.width / stage.clientWidth;
    const stageOffsetX = (stage.clientWidth - 1600) / 2;
    const stageOffsetY = (stage.clientHeight - 900) / 2;
    const initialPosition = imageLayout.images[key] ?? {
      x: ((initialRect.left - stageRect.left) / stageScale - stageOffsetX) / 1600,
      y: ((initialRect.top - stageRect.top) / stageScale - stageOffsetY) / 900,
      width: Math.max(0.05, Math.min(1, initialRect.width ? initialRect.width / stageScale / 1600 : 0.4)),
    };
    imageLayout.images[key] = initialPosition;
    applyImagePosition(figure, initialPosition);
    const resizeHandles = ["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((direction) => {
      const handle = document.createElement("span");
      handle.className = "markdown-image-resizer";
      handle.dataset.direction = direction;
      handle.setAttribute("aria-hidden", "true");
      figure.append(handle);
      return handle;
    });
    let drag = null;
    let resize = null;

    figure.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || drawingOverSlide || event.target.closest(".markdown-image-resizer")) return;
      event.preventDefault();
      event.stopPropagation();
      selectFigure(figure);
      const { figureRect } = ensureFigurePositioned(figure, index);
      drag = { id: event.pointerId, offsetX: event.clientX - figureRect.left, offsetY: event.clientY - figureRect.top };
      figure.setPointerCapture(event.pointerId);
      figure.classList.add("is-dragging");
    });
    figure.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      const stage = slides[index].querySelector(".slide-stage");
      const slideRect = stage.getBoundingClientRect();
      const figureRect = figure.getBoundingClientRect();
      const scale = slideRect.width / stage.clientWidth;
      const offsetX = (stage.clientWidth - 1600) / 2;
      const offsetY = (stage.clientHeight - 900) / 2;
      const left = Math.max(0, Math.min(slideRect.width - figureRect.width, event.clientX - slideRect.left - drag.offsetX)) / scale;
      const top = Math.max(0, Math.min(slideRect.height - figureRect.height, event.clientY - slideRect.top - drag.offsetY)) / scale;
      const x = (left - offsetX) / 1600;
      const y = (top - offsetY) / 900;
      const width = figureRect.width / scale / 1600;
      applyImagePosition(figure, { x, y, width });
      imageLayout.images[key] = { x, y, width };
    });
    const finishDrag = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (figure.hasPointerCapture(event.pointerId)) figure.releasePointerCapture(event.pointerId);
      figure.classList.remove("is-dragging");
      drag = null;
      saveImageLayout();
    };
    figure.addEventListener("pointerup", finishDrag);
    figure.addEventListener("pointercancel", finishDrag);

    resizeHandles.forEach((resizeHandle) => {
      resizeHandle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || drawingOverSlide) return;
        event.preventDefault();
        event.stopPropagation();
        selectFigure(figure);
        const { slideRect, figureRect } = ensureFigurePositioned(figure, index);
        resize = {
          id: event.pointerId,
          direction: resizeHandle.dataset.direction,
          startX: event.clientX,
          startY: event.clientY,
          width: figureRect.width,
          height: figureRect.height,
          slideWidth: slideRect.width,
          position: { ...imageLayout.images[key] },
        };
        resizeHandle.setPointerCapture(event.pointerId);
        figure.classList.add("is-resizing");
      });
      resizeHandle.addEventListener("pointermove", (event) => {
        if (!resize || resize.id !== event.pointerId) return;
        event.preventDefault();
        const direction = resize.direction;
        const factors = [];
        if (direction.includes("e")) factors.push((resize.width + event.clientX - resize.startX) / resize.width);
        if (direction.includes("w")) factors.push((resize.width - event.clientX + resize.startX) / resize.width);
        if (direction.includes("s")) factors.push((resize.height + event.clientY - resize.startY) / resize.height);
        if (direction.includes("n")) factors.push((resize.height - event.clientY + resize.startY) / resize.height);
        const factor = factors.reduce((selected, candidate) => Math.abs(candidate - 1) > Math.abs(selected - 1) ? candidate : selected, factors[0]);
        const stage = slides[index].querySelector(".slide-stage");
        const offsetX = (stage.clientWidth - 1600) / 2;
        const offsetY = (stage.clientHeight - 900) / 2;
        const minX = -offsetX / 1600;
        const maxX = (stage.clientWidth - offsetX) / 1600;
        const minY = -offsetY / 900;
        const maxY = (stage.clientHeight - offsetY) / 900;
        const start = resize.position;
        const startWidth = start.width;
        const startHeight = resize.height / (resize.slideWidth / stage.clientWidth) / 900;
        const startRight = start.x + startWidth;
        const startBottom = start.y + startHeight;
        let maxWidth = direction.includes("w") ? startRight - minX : maxX - start.x;
        const maxHeight = direction.includes("n") ? startBottom - minY : maxY - start.y;
        maxWidth = Math.min(maxWidth, maxHeight / startHeight * startWidth);
        const width = Math.max(0.05, Math.min(maxWidth, startWidth * Math.max(0.01, factor)));
        const height = startHeight * width / startWidth;
        const x = direction.includes("w") ? startRight - width : start.x;
        const y = direction.includes("n") ? startBottom - height : start.y;
        applyImagePosition(figure, { x, y, width });
        imageLayout.images[key] = { x, y, width };
      });
      const finishResize = (event) => {
        if (!resize || resize.id !== event.pointerId) return;
        if (resizeHandle.hasPointerCapture(event.pointerId)) resizeHandle.releasePointerCapture(event.pointerId);
        figure.classList.remove("is-resizing");
        resize = null;
        saveImageLayout();
      };
      resizeHandle.addEventListener("pointerup", finishResize);
      resizeHandle.addEventListener("pointercancel", finishResize);
    });
  }

  async function initializeImageLayouts() {
    try {
      const response = await fetch(`/api/layout?presentationId=${encodeURIComponent(config.presentationId)}`);
      if (response.ok) Object.assign(imageLayout.images, (await response.json()).images ?? {});
    } catch { /* use default flow positions */ }
    slides.forEach((slide, index) => {
      const figures = [...slide.querySelectorAll("figure.markdown-image")];
      const registrations = figures.map((figure) => [figure, imageLayoutKey(figure, index)]);
      registrations.forEach(([figure, key]) => registerDraggableFigure(figure, index, key));
    });
    saveImageLayout();
  }

  slides.forEach((slide) => makeMarkdownCollapsible(slide.querySelector(".slide-content")));
  initializeImageLayouts();
  showSlide(slideIndex, false);
  addEventListener("hashchange", () => showSlide(Number(location.hash.slice(1)) - 1 || 0, false));
  previousSlideButton.addEventListener("click", () => showSlide(slideIndex - 1));
  nextSlideButton.addEventListener("click", () => showSlide(slideIndex + 1));

  // Finger swipes navigate on tablets while vertical scrolling remains available.
  let swipeStart = null;
  deck.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("figure.markdown-image") && !drawingOverSlide) selectFigure(null);
    if (event.pointerType === "touch") swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  deck.addEventListener("pointerup", (event) => {
    if (!swipeStart || event.pointerId !== swipeStart.id) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.35) showSlide(slideIndex + (dx < 0 ? 1 : -1));
  });
  deck.addEventListener("pointercancel", () => { swipeStart = null; });

  function bringToFront(pane) {
    pane.style.zIndex = String(++paneZIndex);
  }

  function updateMosaic() {
    const docked = Object.entries(panes).filter(([, pane]) => !pane.hidden && !pane.classList.contains("is-detached"));
    const iframeDocked = docked.some(([mode]) => mode === "iframe");
    for (const [mode, pane] of Object.entries(panes)) {
      const isDocked = docked.some(([, candidate]) => candidate === pane);
      document.body.classList.toggle(`${mode}-docked`, isDocked);
      pane.classList.toggle("is-docked", isDocked);
      pane.style.removeProperty("--dock-start");
      pane.style.removeProperty("--dock-size");
    }
    // Existing two-pane layout keeps its adjustable divider. Layouts that
    // include the web pane use equal mosaic tiles.
    if (iframeDocked) docked.forEach(([, pane], index) => {
      pane.style.setProperty("--dock-start", `${index * 100 / docked.length}%`);
      pane.style.setProperty("--dock-size", `${100 / docked.length}%`);
    });
    document.body.classList.toggle("has-docked-pane", docked.length > 0);
    document.body.classList.toggle("drawing-mode", drawingOverSlide || !drawWindow.hidden);
    document.querySelectorAll(".pane-detach").forEach((button) => {
      const pane = panes[button.dataset.pane];
      const detached = pane.classList.contains("is-detached");
      button.textContent = detached ? "⊞" : "↗";
      button.setAttribute("aria-label", detached ? `Dock ${button.dataset.pane}` : `Detach ${button.dataset.pane}`);
      button.title = detached ? "Dock pane" : "Detach pane";
    });
    requestAnimationFrame(() => {
      if (!drawWindow.hidden) resizeCanvas();
      if (!terminalWindow.hidden) fitTerminal();
    });
  }

  function setMaximized(mode) {
    const next = maximizedMode === mode ? null : mode;
    if (next && next !== "slide" && panes[next].hidden) setPane(next, true);
    maximizedMode = next;
    document.body.classList.toggle("maximized-slide", next === "slide");
    document.body.classList.toggle("maximized-draw", next === "draw");
    document.body.classList.toggle("maximized-terminal", next === "terminal");
    document.body.classList.toggle("maximized-iframe", next === "iframe");
    slideMaximize.setAttribute("aria-pressed", String(next === "slide"));
    slideMaximize.firstChild.textContent = next === "slide" ? "❐" : "□";
    slideMaximize.title = next === "slide" ? "Restore slide" : "Maximize slide";
    slideMaximize.setAttribute("aria-label", slideMaximize.title);
    document.querySelectorAll(".pane-maximize").forEach((button) => {
      const active = next === button.dataset.pane;
      button.textContent = active ? "❐" : "□";
      button.title = active ? "Restore pane" : `Maximize ${button.dataset.pane}`;
      button.setAttribute("aria-label", button.title);
    });
    requestAnimationFrame(() => {
      if (!drawWindow.hidden) resizeCanvas();
      if (!terminalWindow.hidden) fitTerminal();
    });
  }

  function updateVerticalMaximizeButton(mode, active) {
    const button = document.querySelector(`.pane-maximize-vertical[data-pane="${mode}"]`);
    button.setAttribute("aria-pressed", String(active));
    button.title = active ? "Restore pane height" : `Maximize ${mode} vertically`;
    button.setAttribute("aria-label", button.title);
  }

  function toggleVerticalMaximize(mode) {
    const pane = panes[mode];
    if (maximizedMode === mode) setMaximized(mode);
    const active = pane.classList.toggle("is-vertical-maximized");
    updateVerticalMaximizeButton(mode, active);
    bringToFront(pane);
    requestAnimationFrame(() => {
      if (mode === "draw") resizeCanvas();
      if (mode === "terminal") fitTerminal();
    });
  }

  function setPane(mode, force) {
    const pane = panes[mode];
    const toggle = paneToggles[mode];
    const open = force ?? pane.hidden;
    if (open && pane.hidden) {
      pane.classList.remove("is-detached", "is-vertical-maximized");
      updateVerticalMaximizeButton(mode, false);
      for (const property of ["left", "top", "right", "width", "height"]) pane.style.removeProperty(property);
    }
    if (!open && maximizedMode === mode) setMaximized(mode);
    pane.hidden = !open;
    toggle.setAttribute("aria-pressed", String(open));
    updateMosaic();
    if (!open) return;
    bringToFront(pane);
    if (mode === "terminal") openTerminal();
  }

  function toggleDetach(mode) {
    const pane = panes[mode];
    if (maximizedMode === mode) setMaximized(mode);
    const detach = !pane.classList.contains("is-detached");
    if (detach) {
      const rect = pane.getBoundingClientRect();
      pane.classList.add("is-detached");
      pane.style.left = `${Math.max(8, rect.left)}px`;
      pane.style.top = `${Math.max(8, rect.top)}px`;
      pane.style.right = "auto";
      pane.style.width = `${Math.min(rect.width, innerWidth - 16)}px`;
      pane.style.height = `${Math.min(rect.height, innerHeight - 16)}px`;
    } else {
      pane.classList.remove("is-detached");
      for (const property of ["left", "top", "right", "width", "height"]) pane.style.removeProperty(property);
    }
    bringToFront(pane);
    updateMosaic();
  }

  function makeMovable(pane) {
    const handle = pane.querySelector(".pane-drag-strip");
    let drag = null;
    pane.addEventListener("pointerdown", () => bringToFront(pane));
    handle.addEventListener("pointerdown", (event) => {
      const likelyPalm = event.pointerType === "touch" && (activeStroke?.pointerType === "pen" || performance.now() - lastPenTime < 800);
      if (event.button !== 0 || likelyPalm) {
        if (likelyPalm) event.preventDefault();
        return;
      }
      event.preventDefault();
      // Dragging the thin top strip detaches a docked tile automatically.
      if (!pane.classList.contains("is-detached")) toggleDetach(Object.entries(panes).find(([, candidate]) => candidate === pane)[0]);
      const rect = pane.getBoundingClientRect();
      pane.style.left = `${rect.left}px`;
      pane.style.top = `${rect.top}px`;
      pane.style.right = "auto";
      drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId);
      bringToFront(pane);
    }, { passive: false });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      const left = Math.max(8, Math.min(innerWidth - pane.offsetWidth - 8, event.clientX - drag.x));
      const top = Math.max(8, Math.min(innerHeight - 60, event.clientY - drag.y));
      pane.style.left = `${left}px`;
      pane.style.top = `${top}px`;
    }, { passive: false });
    const endDrag = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      drag = null;
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  function makeResizable(handle) {
    const pane = handle.closest(".floating-pane");
    let resize = null;
    handle.addEventListener("pointerdown", (event) => {
      const likelyPalm = event.pointerType === "touch" && (activeStroke?.pointerType === "pen" || performance.now() - lastPenTime < 800);
      if (event.button !== 0 || likelyPalm) {
        if (likelyPalm) event.preventDefault();
        return;
      }
      const detachedEdge = handle.dataset.resizeEdge;
      if (Boolean(detachedEdge) !== pane.classList.contains("is-detached")) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = pane.getBoundingClientRect();
      resize = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, left: rect.left, top: rect.top };
      handle.setPointerCapture(event.pointerId);
      bringToFront(pane);
    }, { passive: false });
    handle.addEventListener("pointermove", (event) => {
      if (!resize || resize.id !== event.pointerId) return;
      event.preventDefault();
      if (handle.classList.contains("pane-resizer-x")) {
        const position = panePositions[panePositionIndex];
        if (position === "right" || position === "left") {
          const minimum = innerWidth <= 600 ? 260 : 320;
          const maximum = Math.max(minimum, innerWidth - (innerWidth <= 600 ? 24 : 280));
          const rawWidth = position === "right" ? innerWidth - event.clientX : event.clientX;
          const width = Math.max(minimum, Math.min(maximum, rawWidth));
          document.documentElement.style.setProperty("--mosaic-width", `${width}px`);
        } else {
          const minimum = innerHeight <= 600 ? 180 : 220;
          const maximum = Math.max(minimum, innerHeight - 220);
          const rawHeight = position === "top" ? event.clientY : innerHeight - event.clientY;
          const height = Math.max(minimum, Math.min(maximum, rawHeight));
          document.documentElement.style.setProperty("--mosaic-height", `${height}px`);
        }
      } else if (handle.classList.contains("pane-resizer-y")) {
        const position = panePositions[panePositionIndex];
        if (position === "right" || position === "left") {
          const minimum = innerHeight <= 600 ? 160 : 220;
          const split = Math.max(minimum, Math.min(innerHeight - minimum, event.clientY));
          document.documentElement.style.setProperty("--mosaic-split", `${split}px`);
        } else {
          const minimum = innerWidth <= 600 ? 160 : 280;
          const split = Math.max(minimum, Math.min(innerWidth - minimum, event.clientX));
          document.documentElement.style.setProperty("--mosaic-column-split", `${split}px`);
        }
      } else {
        const edge = handle.dataset.resizeEdge;
        const dx = event.clientX - resize.x;
        const dy = event.clientY - resize.y;
        let width = resize.width;
        let height = resize.height;
        let left = resize.left;
        let top = resize.top;
        if (edge.includes("e")) width = Math.max(320, Math.min(innerWidth - resize.left - 8, resize.width + dx));
        if (edge.includes("s")) height = Math.max(240, Math.min(innerHeight - resize.top - 8, resize.height + dy));
        if (edge.includes("w")) {
          width = Math.max(320, Math.min(resize.left + resize.width - 8, resize.width - dx));
          left = resize.left + resize.width - width;
        }
        if (edge.includes("n")) {
          height = Math.max(240, Math.min(resize.top + resize.height - 8, resize.height - dy));
          top = resize.top + resize.height - height;
        }
        pane.style.right = "auto";
        pane.style.left = `${left}px`;
        pane.style.top = `${top}px`;
        pane.style.width = `${width}px`;
        pane.style.height = `${height}px`;
      }
    }, { passive: false });
    const endResize = (event) => {
      if (!resize || resize.id !== event.pointerId) return;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      resize = null;
    };
    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);
  }

  makeMovable(drawWindow);
  makeMovable(terminalWindow);
  makeMovable(iframeWindow);
  document.querySelectorAll(".pane-resizer").forEach(makeResizable);
  drawToggle.addEventListener("click", () => setPane("draw"));
  terminalToggle.addEventListener("click", () => setPane("terminal"));
  iframeToggle.addEventListener("click", () => setPane("iframe"));
  document.querySelectorAll(".pane-close").forEach((button) => button.addEventListener("click", () => setPane(button.dataset.pane, false)));
  document.querySelectorAll(".pane-detach").forEach((button) => button.addEventListener("click", () => toggleDetach(button.dataset.pane)));
  document.querySelectorAll(".pane-maximize").forEach((button) => button.addEventListener("click", () => setMaximized(button.dataset.pane)));
  document.querySelectorAll(".pane-maximize-vertical").forEach((button) => button.addEventListener("click", () => toggleVerticalMaximize(button.dataset.pane)));
  slideMaximize.addEventListener("click", () => setMaximized("slide"));
  panePositionButton.addEventListener("click", () => {
    document.body.classList.remove(`panes-${panePositions[panePositionIndex]}`);
    panePositionIndex = (panePositionIndex + 1) % panePositions.length;
    const position = panePositions[panePositionIndex];
    document.body.classList.add(`panes-${position}`);
    const nextPosition = panePositions[(panePositionIndex + 1) % panePositions.length];
    panePositionButton.textContent = panePositionIcons[nextPosition];
    panePositionButton.title = `Move panes to the ${nextPosition}`;
    panePositionButton.setAttribute("aria-label", panePositionButton.title);
    updateMosaic();
  });
  document.getElementById("fullscreen").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });

  document.getElementById("iframe-address").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("iframe-url");
    let url = input.value.trim();
    if (!url) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    input.value = url;
    document.getElementById("web-iframe").src = url;
  });

  let markdownEditing = false;
  async function toggleMarkdownEditing(force) {
    const editing = force ?? !markdownEditing;
    if (editing === markdownEditing) return;
    if (editing) {
      const response = await fetch(`/api/markdown?presentationId=${encodeURIComponent(config.presentationId)}`);
      if (!response.ok) throw new Error("Unable to load Markdown");
      markdownEditor.value = await response.text();
      markdownEditor.hidden = false;
      markdownEditing = true;
      document.body.classList.add("markdown-editing");
      markdownEditToggle.setAttribute("aria-pressed", "true");
      markdownEditToggle.title = "Save Markdown";
      markdownEditor.focus();
      return;
    }
    markdownEditToggle.disabled = true;
    const response = await fetch("/api/markdown", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presentationId: config.presentationId, markdown: markdownEditor.value }),
    });
    if (!response.ok) throw new Error("Unable to save Markdown");
    location.reload();
  }
  markdownEditToggle.addEventListener("click", () => toggleMarkdownEditing().catch((error) => alert(error.message)));

  deck.addEventListener("dragover", (event) => {
    if (![...event.dataTransfer.items].some((item) => item.kind === "file" && item.type.startsWith("image/"))) return;
    event.preventDefault();
    deck.classList.add("is-image-drop-target");
  });
  deck.addEventListener("dragleave", (event) => {
    if (!deck.contains(event.relatedTarget)) deck.classList.remove("is-image-drop-target");
  });
  deck.addEventListener("drop", async (event) => {
    const images = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    event.preventDefault();
    deck.classList.remove("is-image-drop-target");
    const content = slides[slideIndex].querySelector(".slide-content");
    for (const image of images) {
      const form = new FormData();
      form.append("presentationId", config.presentationId);
      form.append("slideIndex", String(slideIndex));
      form.append("image", image);
      const response = await fetch("/api/images", { method: "POST", body: form });
      if (!response.ok) continue;
      const result = await response.json();
      const figure = document.createElement("figure");
      figure.className = "markdown-image";
      const element = document.createElement("img");
      element.src = result.src;
      element.alt = result.alt;
      figure.append(element);
      content.append(figure);
      registerDraggableFigure(figure, slideIndex);
    }
  });

  document.addEventListener("keydown", (event) => {
    const textEditing = event.target.closest?.("input, textarea, .xterm");
    if ((event.key === "Delete" || event.key === "Backspace") && selectedFigure && !textEditing) {
      event.preventDefault();
      deleteSelectedFigure();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && markdownEditing) {
      event.preventDefault();
      toggleMarkdownEditing(false).catch((error) => alert(error.message));
      return;
    }
    const editing = event.target.closest?.("input, textarea, button, [role='button'], .markdown-collapsible-item, .xterm");
    if (editing) return;
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
      event.preventDefault(); showSlide(slideIndex + 1);
    } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault(); showSlide(slideIndex - 1);
    } else if (event.key === "Home") showSlide(0);
    else if (event.key === "End") showSlide(slides.length - 1);
    else if (event.key.toLowerCase() === "d") setPane("draw");
    else if (event.key.toLowerCase() === "t") setPane("terminal");
    else if (event.key.toLowerCase() === "f") document.getElementById("fullscreen").click();
    else if (event.key === "Escape") {
      if (maximizedMode) setMaximized(maximizedMode);
      else {
        setPane("draw", false);
        setPane("terminal", false);
        setPane("iframe", false);
      }
    }
  });

  // Collaboration
  const socket = io({ auth: { presentationId: config.presentationId } });
  // Drawing
  const canvas = document.getElementById("drawing-canvas");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const slideDrawingControls = document.getElementById("slide-drawing-controls");
  positionDrawingOverlay = () => {
    if (drawingOverSlide) slides[slideIndex].querySelector(".slide-stage").append(canvas);
  };
  function setSlideDrawingOverlay(active) {
    drawingOverSlide = active;
    slideDrawingToggle.setAttribute("aria-pressed", String(active));
    slideDrawingToggle.title = active ? "Close slide drawing" : "Draw over slide";
    canvas.classList.toggle("is-slide-overlay", active);
    slideDrawingControls.hidden = !active;
    document.body.classList.toggle("drawing-mode", active || !drawWindow.hidden);
    if (active) positionDrawingOverlay();
    else drawPanel.prepend(canvas);
    repaintDrawing();
  }
  slideDrawingToggle.addEventListener("click", () => setSlideDrawingOverlay(!drawingOverSlide));
  document.getElementById("overlay-drawing-close").addEventListener("click", () => setSlideDrawingOverlay(false));
  const strokeElements = new Map();
  const isIPad = /iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const sizeLevels = ["normal", "medium", "large"];
  const brushWidths = [4, 8, 14];
  const brushSizeButtons = [...document.querySelectorAll("#brush-size, .overlay-brush-size")];
  const eraserButtons = [...document.querySelectorAll("#eraser-toggle, .overlay-eraser-toggle")];
  let brushSizeIndex = 0;
  let eraserEnabled = false;
  let penColor = "#ffffff";
  function setEraser(enabled) {
    eraserEnabled = enabled;
    for (const button of eraserButtons) {
      button.setAttribute("aria-pressed", String(enabled));
      button.title = enabled ? "Eraser active" : "Eraser";
      button.setAttribute("aria-label", button.title);
    }
  }
  eraserButtons.forEach((button) => button.addEventListener("click", () => setEraser(true)));
  document.querySelectorAll("#undo-drawing, .overlay-undo-drawing").forEach((button) => button.addEventListener("click", () => socket.emit("draw:undo")));
  const colorSwatches = [...document.querySelectorAll(".color-swatch, .overlay-color-swatch")];
  colorSwatches.forEach((swatch) => swatch.addEventListener("click", () => {
    penColor = swatch.dataset.color;
    setEraser(false);
    colorSwatches.forEach((item) => {
      const selected = item.dataset.color === penColor;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
  }));
  brushSizeButtons.forEach((button) => button.addEventListener("click", () => {
    brushSizeIndex = (brushSizeIndex + 1) % brushWidths.length;
    const level = sizeLevels[brushSizeIndex];
    brushSizeButtons.forEach((item) => {
      item.dataset.level = level;
      item.title = `Brush size: ${level}`;
      item.setAttribute("aria-label", item.title);
    });
  }));
  document.querySelectorAll("#clear-canvas, .overlay-clear-canvas").forEach((button) => button.addEventListener("click", () => socket.emit("draw:clear")));
  const strokes = new Map();
  const erasedDuringGesture = new Set();
  let activeStroke = null;
  let eraserPointerId = null;
  let lastPenTime = -Infinity;

  function isPalmEvent(event) {
    if (event.pointerType !== "touch") return false;
    return isIPad || activeStroke?.pointerType === "pen" || performance.now() - lastPenTime < 800;
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    // Store points in canvas CSS pixels, anchored at the top-left. Resizing the
    // pane then reveals or hides canvas space without stretching the drawing.
    return {
      x: Math.max(0, Math.min(canvas.clientWidth, (event.clientX - rect.left) / rect.width * canvas.clientWidth)),
      y: Math.max(0, Math.min(canvas.clientHeight, (event.clientY - rect.top) / rect.height * canvas.clientHeight)),
      pressure: event.pointerType === "pen" && Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : undefined,
    };
  }

  function pointForSurface(point) {
    if (!drawingOverSlide) return point;
    const offsetX = (canvas.clientWidth - 1600) / 2;
    const offsetY = (canvas.clientHeight - 900) / 2;
    return { x: (point.x - offsetX) / 1600, y: (point.y - offsetY) / 900, pressure: point.pressure };
  }

  function displayedPoint(point, stroke) {
    if (!stroke.normalized) return point;
    const offsetX = (canvas.clientWidth - 1600) / 2;
    const offsetY = (canvas.clientHeight - 900) / 2;
    return { x: offsetX + point.x * 1600, y: offsetY + point.y * 900, pressure: point.pressure };
  }

  function distanceToSegmentSquared(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
    const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    const x = start.x + amount * dx;
    const y = start.y + amount * dy;
    return (point.x - x) ** 2 + (point.y - y) ** 2;
  }

  function strokeIsVisible(stroke) {
    const surface = stroke.surface ?? "canvas";
    return drawingOverSlide
      ? surface === "slide" && stroke.slideIndex === slideIndex
      : surface === "canvas";
  }

  function eraseAtPoint(point) {
    const eraserRadius = Math.max(8, brushWidths[brushSizeIndex] * 1.5);
    const removed = [];
    for (const [id, stroke] of strokes) {
      if (!strokeIsVisible(stroke) || stroke.mode === "erase" || erasedDuringGesture.has(id)) continue;
      const hitRadiusSquared = (eraserRadius + stroke.width / 2) ** 2;
      const displayedPoints = stroke.points.map((candidate) => displayedPoint(candidate, stroke));
      const hit = displayedPoints.length === 1
        ? distanceToSegmentSquared(point, displayedPoints[0], displayedPoints[0]) <= hitRadiusSquared
        : displayedPoints.some((current, index) => index > 0 && distanceToSegmentSquared(point, displayedPoints[index - 1], current) <= hitRadiusSquared);
      if (!hit) continue;
      erasedDuringGesture.add(id);
      removed.push(id);
      strokes.delete(id);
      strokeElements.get(id)?.remove();
      strokeElements.delete(id);
    }
    if (removed.length) socket.emit("draw:erase", removed);
  }

  function outlineToPath(outline) {
    if (!outline.length) return "";
    const commands = outline.reduce((result, [x0, y0], index, points) => {
      const [x1, y1] = points[(index + 1) % points.length];
      result.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2));
      return result;
    }, ["M", outline[0][0].toFixed(2), outline[0][1].toFixed(2), "Q"]);
    return `${commands.join(" ")} Z`;
  }

  function paintStroke(stroke) {
    if (!stroke.points.length || !strokeIsVisible(stroke)) return;
    const hasPressure = stroke.points.some((point) => point.pressure !== undefined);
    const outline = getStroke(
      stroke.points.map((point) => displayedPoint(point, stroke)).map((point) => [point.x, point.y, point.pressure ?? 0.5]),
      {
        size: stroke.width,
        thinning: 0.6,
        smoothing: 0.65,
        streamline: 0.55,
        simulatePressure: !hasPressure,
        start: { cap: true, taper: 0 },
        end: { cap: true, taper: 0 },
        last: true,
      },
    );
    let path = strokeElements.get(stroke.id);
    if (!path) {
      path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("data-stroke-id", stroke.id);
      strokeElements.set(stroke.id, path);
      canvas.append(path);
    }
    path.setAttribute("d", outlineToPath(outline));
    path.setAttribute("fill", stroke.mode === "erase" ? "#000000" : stroke.color);
  }

  let repaintFrame = 0;
  function repaint() {
    repaintFrame = 0;
    canvas.replaceChildren();
    strokeElements.clear();
    strokes.forEach(paintStroke);
  }
  function scheduleRepaint() {
    if (!repaintFrame) repaintFrame = requestAnimationFrame(repaint);
  }
  repaintDrawing = repaint;
  // Vertical stage expansion changes the centered design-area offset. Rebuild
  // paths whenever the SVG viewport changes so normalized slide strokes track
  // that offset just like positioned images do.
  new ResizeObserver(() => scheduleRepaint()).observe(canvas);

  function resizeCanvas() { scheduleRepaint(); }
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (event.pointerType === "pen") lastPenTime = performance.now();
    if (event.button !== 0 || isPalmEvent(event) || activeStroke || eraserPointerId !== null) return;
    canvas.setPointerCapture(event.pointerId);
    const canvasPosition = canvasPoint(event);
    if (eraserEnabled) {
      const point = canvasPosition;
      eraserPointerId = event.pointerId;
      erasedDuringGesture.clear();
      eraseAtPoint(point);
      return;
    }
    const point = pointForSurface(canvasPosition);
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    activeStroke = { id, pointerId: event.pointerId, pointerType: event.pointerType, color: penColor, width: brushWidths[brushSizeIndex], mode: "draw", surface: drawingOverSlide ? "slide" : "canvas", slideIndex: drawingOverSlide ? slideIndex : undefined, normalized: drawingOverSlide, points: [point] };
    strokes.set(id, activeStroke);
    paintStroke(activeStroke);
    socket.emit("draw:start", { id, color: activeStroke.color, width: activeStroke.width, mode: activeStroke.mode, surface: activeStroke.surface, slideIndex: activeStroke.slideIndex, normalized: activeStroke.normalized, point });
  }, { passive: false });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "pen") lastPenTime = performance.now();
    if (event.pointerId === eraserPointerId) {
      event.preventDefault();
      const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      (coalesced.length ? coalesced : [event]).map(canvasPoint).forEach(eraseAtPoint);
      return;
    }
    if (!activeStroke || event.pointerId !== activeStroke.pointerId) {
      if (isPalmEvent(event)) event.preventDefault();
      return;
    }
    event.preventDefault();
    const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    // Some Safari/iPadOS versions expose getCoalescedEvents() but return an
    // empty array. Always fall back to the current event so a move is never lost.
    const points = (coalesced.length ? coalesced : [event]).map(canvasPoint).map(pointForSurface);
    activeStroke.points.push(...points);
    scheduleRepaint();
    // Send the long-standing single-point event for broad Socket.IO/browser
    // compatibility. Event ordering preserves every segment remotely.
    points.forEach((point) => socket.emit("draw:move", point));
  }, { passive: false });
  function finishStroke(event) {
    if (event.pointerType === "pen") lastPenTime = performance.now();
    if (event.pointerId === eraserPointerId) {
      event.preventDefault();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      eraserPointerId = null;
      erasedDuringGesture.clear();
      return;
    }
    if (!activeStroke || event.pointerId !== activeStroke.pointerId) {
      if (isPalmEvent(event)) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    activeStroke = null;
    socket.emit("draw:end");
  }
  canvas.addEventListener("pointerup", finishStroke, { passive: false });
  canvas.addEventListener("pointercancel", finishStroke, { passive: false });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    socket.emit("draw:undo");
  });
  canvas.addEventListener("selectstart", (event) => event.preventDefault());
  canvas.addEventListener("dragstart", (event) => event.preventDefault());
  // iPadOS still emits legacy touch events alongside Pointer Events in some modes.
  for (const eventName of ["touchstart", "touchmove", "touchend"]) {
    canvas.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
  }
  socket.on("drawing:init", (items) => {
    strokes.clear();
    items.forEach((stroke) => strokes.set(stroke.id, stroke));
    repaint();
  });
  socket.on("draw:start", (stroke) => { strokes.set(stroke.id, stroke); paintStroke(stroke); });
  socket.on("draw:ack", ({ localId, id }) => {
    const stroke = strokes.get(localId);
    if (!stroke) return;
    strokes.delete(localId);
    stroke.id = id;
    strokes.set(id, stroke);
    const path = strokeElements.get(localId);
    if (path) {
      strokeElements.delete(localId);
      path.setAttribute("data-stroke-id", id);
      strokeElements.set(id, path);
    }
  });
  socket.on("draw:move", ({ id, point }) => {
    const stroke = strokes.get(id);
    if (stroke) { stroke.points.push(point); scheduleRepaint(); }
  });
  socket.on("draw:remove", (id) => { strokes.delete(id); repaint(); });
  socket.on("draw:clear", () => { strokes.clear(); repaint(); });

  // Terminal
  const terminalFontSizes = [13, 17, 22];
  const terminalFontButton = document.getElementById("terminal-font-size");
  let terminalFontSizeIndex = 0;
  let terminal;
  let fitAddon;
  let terminalOpened = false;
  terminalFontButton.addEventListener("click", () => {
    terminalFontSizeIndex = (terminalFontSizeIndex + 1) % terminalFontSizes.length;
    const level = sizeLevels[terminalFontSizeIndex];
    terminalFontButton.dataset.level = level;
    terminalFontButton.title = `Terminal font: ${level}`;
    terminalFontButton.setAttribute("aria-label", terminalFontButton.title);
    if (terminal) {
      terminal.options.fontSize = terminalFontSizes[terminalFontSizeIndex];
      requestAnimationFrame(fitTerminal);
    }
  });
  function fitTerminal() {
    if (!fitAddon || terminalWindow.hidden) return;
    try {
      fitAddon.fit();
      socket.emit("terminal:resize", { cols: terminal.cols, rows: terminal.rows });
    } catch { /* panel may still be measuring */ }
  }
  function openTerminal() {
    if (!terminal) {
      terminal = new Terminal({
        cursorBlink: true,
        convertEol: false,
        scrollOnUserInput: true,
        fontFamily: '"0xProto Nerd Font Mono", "NerdSymbols", "Apple Color Emoji", "Segoe UI Emoji", monospace',
        fontSize: terminalFontSizes[terminalFontSizeIndex],
        theme: { background: "#000000", foreground: "#d0d0d0", cursor: "#ffffff", selectionBackground: "#444444" },
      });
      fitAddon = new FitAddon.FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(document.getElementById("terminal"));
      terminal.onData((data) => socket.emit("terminal:input", data));
      new ResizeObserver(fitTerminal).observe(document.getElementById("terminal-panel"));
    }
    // Keep this synchronous: iPadOS only opens its keyboard when focus occurs
    // directly inside the user's tap event.
    terminal.focus();
    requestAnimationFrame(() => { fitTerminal(); terminal.focus(); });
    if (!terminalOpened) {
      socket.emit("terminal:open");
      terminalOpened = true;
    }
  }
  terminalPanel.addEventListener("pointerdown", (event) => {
    if (event.target.closest("#terminal")) terminal?.focus();
  });
  socket.on("terminal:data", (data) => terminal?.write(data));
  socket.on("terminal:exit", () => { terminalOpened = false; });
  socket.on("disconnect", () => { terminalOpened = false; });
  socket.on("connect", () => {
    if (!terminalWindow.hidden && terminal && !terminalOpened) openTerminal();
  });
})();
