<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { InkManager } from "./InkManager";
  import Toolbar from "./Toolbar.svelte";
  import ActionEffects from "./ActionEffects.svelte";
  import SetupDialog from "./SetupDialog.svelte";
  import CaptureOverlay from "./CaptureOverlay.svelte";
  import { GetSavedMonitorIndex } from "../wailsjs/go/main/App.js";

  let mainCanvas: HTMLCanvasElement;
  let draftCanvas: HTMLCanvasElement;
  let inkManager: InkManager | null = null;
  let actionEffects: ActionEffects;

  let activeTool = "pen";
  let penColor = "#000000";
  let highlighterColor = "#FFFF00";
  let brushSize = 4;
  let isExpanded = true;
  let showSetup = false;

  // Capture state
  let showCaptureOverlay = false;
  let capturedImage: string | null = null;
  let capturePos = { x: 50, y: 50 };
  let captureSize = { w: 400, h: 300 };

  // Resize/drag state for captured image
  let isDraggingCapture = false;
  let isResizingCapture = false;
  let captDragStart = { x: 0, y: 0 };
  let captPosStart = { x: 0, y: 0 };
  let captSizeStart = { w: 0, h: 0 };
  let captureAspectRatio = 1;

  onMount(async () => {
    inkManager = new InkManager(mainCanvas, draftCanvas);
    inkManager.color = penColor;
    inkManager.brushSize = brushSize;

    try {
      const savedIndex = await GetSavedMonitorIndex();
      if (savedIndex === -2) {
        showSetup = true;
      }
    } catch (e) {
      console.error("Failed to check saved monitor:", e);
    }
  });

  onDestroy(() => {});

  let lastSpawnPos = { x: 0, y: 0 };

  function handlePointerDown(e: PointerEvent) {
    if (["actionpen", "firework", "confetti"].includes(activeTool)) {
      actionEffects?.spawnObjectAt(e.clientX, e.clientY, activeTool);
      lastSpawnPos = { x: e.clientX, y: e.clientY };
    }
    if (inkManager) {
      (e.target as HTMLElement)?.setPointerCapture(e.pointerId);
      inkManager.handlePointerDown(e);
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (
      ["actionpen", "firework", "confetti"].includes(activeTool) &&
      e.buttons > 0
    ) {
      const dist = Math.hypot(
        e.clientX - lastSpawnPos.x,
        e.clientY - lastSpawnPos.y,
      );
      if (dist > 30) {
        actionEffects?.spawnObjectAt(e.clientX, e.clientY, activeTool);
        lastSpawnPos = { x: e.clientX, y: e.clientY };
      }
    }
    if (inkManager) {
      inkManager.handlePointerMove(e);
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (inkManager) {
      (e.target as HTMLElement)?.releasePointerCapture(e.pointerId);
      inkManager.handlePointerUp(e);
    }
  }

  function handleToolChange(e: CustomEvent<string>) {
    if (!inkManager) return;
    activeTool = e.detail;
    if (["pen", "actionpen", "firework", "confetti"].includes(activeTool)) {
      inkManager.isEraser = false;
      inkManager.isHighlighter = false;
      inkManager.color = penColor;
      inkManager.brushSize = brushSize;
    } else if (activeTool === "eraser") {
      inkManager.isEraser = true;
      inkManager.isHighlighter = false;
    } else if (activeTool === "highlighter") {
      inkManager.isEraser = false;
      inkManager.isHighlighter = true;
      inkManager.color = highlighterColor;
      inkManager.brushSize = brushSize * 5;
    }
  }

  function handleColorChange(e: CustomEvent<string>) {
    if (!inkManager) return;
    if (activeTool === "highlighter") {
      highlighterColor = e.detail;
      inkManager.color = highlighterColor;
    } else {
      penColor = e.detail;
      inkManager.color = penColor;
    }
  }

  function handleBrushSizeChange(e: CustomEvent<number>) {
    if (!inkManager) return;
    brushSize = e.detail;
    if (inkManager.isHighlighter) {
      inkManager.brushSize = brushSize * 5;
    } else {
      inkManager.brushSize = brushSize;
    }
  }

  function handleClearAll() {
    if (inkManager) inkManager.clear();
  }

  function toggleClickThrough(e: CustomEvent<boolean>) {
    isExpanded = e.detail;
  }

  let canvasBgColor = "transparent";
  function handleBgChange(e: CustomEvent<string>) {
    canvasBgColor = e.detail;
  }

  function handleCapture() {
    showCaptureOverlay = true;
  }

  function handleCaptured(
    e: CustomEvent<{ dataURL: string; width: number; height: number }>,
  ) {
    showCaptureOverlay = false;
    capturedImage = e.detail.dataURL;
    captureSize = { w: e.detail.width, h: e.detail.height };
    captureAspectRatio = e.detail.width / e.detail.height;
    capturePos = {
      x: (window.innerWidth - captureSize.w) / 2,
      y: (window.innerHeight - captureSize.h) / 2,
    };
    canvasBgColor = "white";
    if (inkManager) inkManager.clear();
  }

  function clearCapture() {
    capturedImage = null;
    canvasBgColor = "transparent";
  }

  function startDragCapture(e: MouseEvent) {
    e.stopPropagation();
    isDraggingCapture = true;
    captDragStart = { x: e.clientX, y: e.clientY };
    captPosStart = { ...capturePos };
    window.addEventListener("mousemove", onDragCapture);
    window.addEventListener("mouseup", stopDragCapture);
  }

  function onDragCapture(e: MouseEvent) {
    if (!isDraggingCapture) return;
    capturePos = {
      x: captPosStart.x + (e.clientX - captDragStart.x),
      y: captPosStart.y + (e.clientY - captDragStart.y),
    };
  }

  function stopDragCapture() {
    isDraggingCapture = false;
    window.removeEventListener("mousemove", onDragCapture);
    window.removeEventListener("mouseup", stopDragCapture);
  }

  function startResizeCapture(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    isResizingCapture = true;
    captDragStart = { x: e.clientX, y: e.clientY };
    captSizeStart = { ...captureSize };
    window.addEventListener("mousemove", onResizeCapture);
    window.addEventListener("mouseup", stopResizeCapture);
  }

  function onResizeCapture(e: MouseEvent) {
    if (!isResizingCapture) return;
    const dx = e.clientX - captDragStart.x;
    const newW = Math.max(50, captSizeStart.w + dx);
    const newH = newW / captureAspectRatio;
    captureSize = { w: newW, h: newH };
  }

  function stopResizeCapture() {
    isResizingCapture = false;
    window.removeEventListener("mousemove", onResizeCapture);
    window.removeEventListener("mouseup", stopResizeCapture);
  }
</script>

{#if showCaptureOverlay}
  <CaptureOverlay
    on:captured={handleCaptured}
    on:cancel={() => (showCaptureOverlay = false)}
  />
{/if}

<main
  class="w-full h-full relative overflow-hidden transition-colors duration-300 {isExpanded
    ? 'pointer-events-auto'
    : 'pointer-events-none'}"
  style="background-color: {canvasBgColor};"
>
  {#if capturedImage}
    <!-- Image layer: BEHIND the canvas so pen draws over it -->
    <img
      src={capturedImage}
      alt="Captured"
      class="absolute pointer-events-none select-none border border-blue-400/50 shadow-lg rounded"
      style="left: {capturePos.x}px; top: {capturePos.y}px; width: {captureSize.w}px; height: {captureSize.h}px; z-index: 0;"
      draggable="false"
    />

    <!-- Controls layer: ABOVE everything for drag/resize/close -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="absolute pointer-events-none select-none"
      style="left: {capturePos.x}px; top: {capturePos.y}px; width: {captureSize.w}px; height: {captureSize.h}px; z-index: 50;"
    >
      <!-- Move handle (top-left corner) -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="absolute -top-2 -left-2 w-6 h-6 bg-blue-500 rounded-sm cursor-move border border-white shadow pointer-events-auto flex items-center justify-center"
        on:mousedown={startDragCapture}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          stroke-width="3"
          stroke-linecap="round"
        >
          <path
            d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"
          />
        </svg>
      </div>

      <!-- Resize handle (bottom-right) -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-blue-500 rounded-sm cursor-nwse-resize border border-white shadow pointer-events-auto"
        on:mousedown={startResizeCapture}
      ></div>

      <!-- Close button -->
      <button
        class="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow hover:bg-red-600 transition-colors text-xs font-bold pointer-events-auto"
        on:click={clearCapture}>×</button
      >
    </div>
  {/if}

  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <canvas
    bind:this={mainCanvas}
    class="absolute inset-0 touch-none {isExpanded
      ? 'pointer-events-auto'
      : 'pointer-events-none'}"
    style="cursor: crosshair; z-index: 1;"
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
    on:pointercancel={handlePointerUp}
  ></canvas>

  <canvas
    bind:this={draftCanvas}
    class="absolute inset-0 z-10 touch-none pointer-events-none"
  ></canvas>

  <ActionEffects bind:this={actionEffects} />

  <Toolbar
    bind:activeTool
    bind:penColor
    bind:highlighterColor
    bind:brushSize
    bind:isExpanded
    on:toolChange={handleToolChange}
    on:colorChange={handleColorChange}
    on:brushSizeChange={handleBrushSizeChange}
    on:clearAll={handleClearAll}
    on:bgChange={handleBgChange}
    on:toggleClickThrough={toggleClickThrough}
    on:openSettings={() => (showSetup = true)}
    on:capture={handleCapture}
  />

  {#if showSetup}
    <SetupDialog on:close={() => (showSetup = false)} />
  {/if}
</main>

<style>
  :global(body) {
    background: transparent !important;
  }
</style>
