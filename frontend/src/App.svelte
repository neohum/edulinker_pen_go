<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { InkManager, type ShapeAmbiguousInfo } from "./InkManager";
  import type { ShapeResult } from "./ShapeRecognizer";
  import Toolbar from "./Toolbar.svelte";
  import ActionEffects from "./ActionEffects.svelte";
  import SetupDialog from "./SetupDialog.svelte";
  import CaptureOverlay from "./CaptureOverlay.svelte";
  import UpdateToast from "./UpdateToast.svelte";
  import ShapeChooser from "./ShapeChooser.svelte";
  import { gradeMathText } from "./MathGrader";
  import {
    GetSavedMonitorIndex,
    RecognizeInk,
  } from "../wailsjs/go/main/App.js";

  let mainCanvas: HTMLCanvasElement;
  let objectCanvas: HTMLCanvasElement;
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

  let shapeChooser: ShapeAmbiguousInfo | null = null;

  // Floating +/- widget shown next to the most recently committed shape / text
  // so the user can quickly resize it. Auto-dismissed on next stroke or tool change.
  let resizeWidget: { bbox: { x: number; y: number; w: number; h: number } } | null = null;

  onMount(async () => {
    inkManager = new InkManager(mainCanvas, objectCanvas, draftCanvas);
    inkManager.color = penColor;
    inkManager.brushSize = brushSize;
    inkManager.onShapeAmbiguous = (info) => {
      // Empty candidates means "dismiss any open chooser".
      shapeChooser = info.candidates.length === 0 ? null : info;
    };
    inkManager.onLastCommitChange = (info) => {
      resizeWidget = info ? { bbox: info.bbox } : null;
    };
    // Smart pen: the InkManager invokes this in parallel with shape recognition
    // when smartMode is on, so the chooser ends up with both shape thumbnails
    // and text candidate chips. Returns the candidate strings or [] on failure.
    inkManager.onRequestTextRecognition = async (json: string) => {
      try {
        const raw = await RecognizeInk(json, RECOGNIZER_LANG);
        const parsed = JSON.parse(raw) as { candidates?: string[] };
        return parsed.candidates ?? [];
      } catch (err) {
        console.warn("[smartpen] RecognizeInk failed:", err);
        return [];
      }
    };
    inkManager.activeTool = activeTool;
    // Explicit-mode policy: 'pen' is plain ink (no recognition). Recognition
    // only kicks in when the user has explicitly picked '도형 펜' (shapepen) or
    // '글씨 펜' (textpen). Auto-detect was unreliable so we don't ship it.
    inkManager.smartMode = false;
    inkManager.recognizeShapes = activeTool === "shapepen";
    inkManager.textMode = activeTool === "textpen";

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
    // Starting a new stroke finalizes any pending text-candidate picker.
    if (textCandidates) {
      if (inkManager) inkManager.finalizeTextCommit();
      textCandidates = null;
    }
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
    // Leaving textpen without converting? Keep the strokes as ink, just drop the buffer.
    if (activeTool === "textpen" && e.detail !== "textpen") {
      inkManager.discardPendingText();
    }
    if (textCandidates) {
      inkManager.finalizeTextCommit();
      textCandidates = null;
    }
    // Switching tools always closes any pending shape chooser/group.
    if (shapeChooser) {
      inkManager.cancelPendingShapeChoice();
      shapeChooser = null;
    }
    inkManager.cancelPendingShapeGroup();
    inkManager.finalizeLastCommit();
    activeTool = e.detail;
    inkManager.activeTool = activeTool;
    // Plain pen never tries to recognize anything. The user must explicitly
    // pick '도형 펜' (shapepen) or '글씨 펜' (textpen) for that.
    inkManager.recognizeShapes = activeTool === "shapepen";
    inkManager.textMode = activeTool === "textpen";
    inkManager.smartMode = false;
    if (["pen", "actionpen", "firework", "confetti", "shapepen", "textpen"].includes(activeTool)) {
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
    } else if (activeTool === "selector") {
      inkManager.isEraser = false;
      inkManager.isHighlighter = false;
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
    shapeChooser = null;
    textCandidates = null;
  }

  function handleShapePicked(e: CustomEvent<ShapeResult>) {
    if (inkManager) inkManager.applyShapeChoice(e.detail);
    shapeChooser = null;
  }

  function handleShapeKeep() {
    if (inkManager) inkManager.keepStrokeChoice();
    shapeChooser = null;
  }

  // Smart-pen chooser: user picked one of the text candidates instead of a shape.
  function handleTextPicked(e: CustomEvent<string>) {
    if (inkManager) inkManager.applyTextChoice(e.detail);
    shapeChooser = null;
  }

  // Korean BCP-47 language tag
  const RECOGNIZER_LANG = "ko-KR";
  let isRecognizing = false;
  let recognizeError: string | null = null;
  let recognizeErrorTimer: number | null = null;

  // Recognition result + alternatives shown to the user. `pickedIndex` tracks
  // which candidate is currently rendered on the canvas.
  let textCandidates: {
    list: string[];
    pickedIndex: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null = null;

  function showRecognizeError(msg: string) {
    recognizeError = msg;
    if (recognizeErrorTimer !== null) window.clearTimeout(recognizeErrorTimer);
    recognizeErrorTimer = window.setTimeout(() => {
      recognizeError = null;
      recognizeErrorTimer = null;
    }, 8000);
  }

  async function handleConvertText() {
    if (!inkManager || isRecognizing) return;
    if (!inkManager.hasPendingText()) {
      showRecognizeError("변환할 손글씨가 없습니다. 글씨 펜으로 먼저 써주세요.");
      return;
    }
    if (typeof RecognizeInk !== "function") {
      showRecognizeError(
        "RecognizeInk 함수가 없습니다. wails dev 또는 wails build 후 다시 시도하세요.",
      );
      return;
    }
    isRecognizing = true;
    try {
      const json = inkManager.getPendingTextStrokesJSON();
      const raw = await RecognizeInk(json, RECOGNIZER_LANG);
      const result = JSON.parse(raw) as {
        candidates: string[];
        recognizer?: string;
        x: number;
        y: number;
        w: number;
        h: number;
      };
      if (!result.candidates || result.candidates.length === 0) {
        showRecognizeError(
          "인식된 텍스트가 비어 있습니다. 더 또렷하게 써보세요.",
        );
        return;
      }
      // Apply the top candidate immediately, then show the chip picker so the
      // user can swap to an alternative in one click if it was wrong.
      textCandidates = {
        list: result.candidates,
        pickedIndex: 0,
        x: result.x,
        y: result.y,
        w: result.w,
        h: result.h,
      };
      applyTextCandidate(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Ink recognition failed:", err);
      showRecognizeError(`손글씨 인식 실패: ${msg}`);
    } finally {
      isRecognizing = false;
    }
  }

  function pickCandidate(i: number) {
    if (!inkManager || !textCandidates) return;
    if (i === textCandidates.pickedIndex) return;
    applyTextCandidate(i);
  }

  function applyTextCandidate(i: number) {
    if (!inkManager || !textCandidates) return;
    const c = textCandidates;
    // commitRecognizedText restores the pre-stroke snapshot before drawing,
    // so swapping candidates is clean even when text widths differ.
    inkManager.commitRecognizedText(c.list[i], c.x, c.y, c.w, c.h);
    const grade = gradeMathText(c.list[i]);
    if (grade) {
      inkManager.drawMathGradeResult(grade, c.x, c.y, c.w, c.h);
    } else if (isAngleLabel(c.list[i])) {
      inkManager.drawAngleGuide(c.list[i], c.x, c.y, c.w, c.h);
    } else if (isDimensionLabel(c.list[i])) {
      inkManager.drawDimensionGuide(c.list[i], c.x, c.y, c.w, c.h);
    }
    textCandidates = { ...c, pickedIndex: i };
  }

  function isAngleLabel(text: string): boolean {
    return /^[\s+-]?\d+(?:[.]\d+)?\s*(?:°|도|deg)\s*$/i.test(text);
  }

  function isDimensionLabel(text: string): boolean {
    return /^[\s+-]?\d[\d,\s]*(?:[.]\d+)?\s*(?:mm|cm|m|km|in|ft|px)?\s*$/i.test(text);
  }

  function dismissCandidates() {
    if (inkManager) inkManager.finalizeTextCommit();
    textCandidates = null;
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
  class="w-full h-full relative overflow-hidden {isExpanded
    ? 'transition-colors duration-300 pointer-events-auto'
    : 'pointer-events-none'}"
  style="background-color: {isExpanded ? canvasBgColor : 'transparent'};"
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
    bind:this={objectCanvas}
    class="absolute inset-0 touch-none pointer-events-none"
    style="z-index: 5;"
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
    {isRecognizing}
    on:toolChange={handleToolChange}
    on:colorChange={handleColorChange}
    on:brushSizeChange={handleBrushSizeChange}
    on:clearAll={handleClearAll}
    on:bgChange={handleBgChange}
    on:toggleClickThrough={toggleClickThrough}
    on:openSettings={() => (showSetup = true)}
    on:capture={handleCapture}
    on:convertText={handleConvertText}
  />

  {#if showSetup}
    <SetupDialog on:close={() => (showSetup = false)} />
  {/if}

  <UpdateToast />

  {#if shapeChooser}
    <ShapeChooser
      candidates={shapeChooser.candidates}
      bbox={shapeChooser.bbox}
      textCandidates={shapeChooser.textCandidates ?? []}
      on:pick={handleShapePicked}
      on:pickText={handleTextPicked}
      on:keep={handleShapeKeep}
    />
  {/if}

  {#if resizeWidget}
    {@const rb = resizeWidget.bbox}
    {@const rx = Math.min(window.innerWidth - 150, rb.x + rb.w + 8)}
    {@const ry = Math.max(8, rb.y)}
    <div
      class="fixed z-[85] flex items-center gap-1 bg-white border border-[#4A90E2]/40 rounded-lg shadow-lg px-1 py-1 pointer-events-auto"
      style="left: {rx}px; top: {ry}px;"
    >
      <button
        class="w-7 h-7 rounded-md border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold text-lg leading-none"
        title="작게 (×0.85)"
        on:click={() => inkManager?.resizeLastElement(0.85)}
      >−</button>
      <button
        class="w-7 h-7 rounded-md border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold text-lg leading-none"
        title="크게 (×1.15)"
        on:click={() => inkManager?.resizeLastElement(1.15)}
      >＋</button>
      <button
        class="w-6 h-7 rounded-md text-gray-500 hover:bg-gray-100 text-base leading-none"
        title="닫기"
        on:click={() => { inkManager?.finalizeLastCommit(); }}
      >×</button>
    </div>
  {/if}

  {#if textCandidates && textCandidates.list.length > 1}
    <div
      class="fixed z-[90] bg-white border border-[#3498DB]/40 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.18)] px-3 py-2 flex items-center gap-1.5 pointer-events-auto max-w-[90vw] flex-wrap"
      style="left: {Math.max(12, Math.min(window.innerWidth - 400, textCandidates.x))}px; top: {Math.min(window.innerHeight - 70, textCandidates.y + textCandidates.h + 12)}px;"
    >
      <span class="text-xs text-gray-500 mr-1">다른 후보:</span>
      {#each textCandidates.list as cand, i}
        <button
          class="px-2.5 py-1 rounded-md text-sm transition-all border {i === textCandidates.pickedIndex
            ? 'bg-[#3498DB]/20 border-[#3498DB]/70 text-[#1F6FB2] font-semibold'
            : 'bg-gray-50 border-gray-200 hover:bg-[#3498DB]/10 hover:border-[#3498DB]/50'} whitespace-pre"
          on:click={() => pickCandidate(i)}
          title={i === textCandidates.pickedIndex ? "현재 적용됨" : "이 후보로 교체"}
        >
          {cand}
        </button>
      {/each}
      <button
        class="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 flex items-center justify-center text-sm leading-none ml-1"
        on:click={dismissCandidates}
        title="닫기"
      >
        ×
      </button>
    </div>
  {/if}

  {#if recognizeError}
    <div
      class="fixed top-4 right-4 z-[100] max-w-md bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg pointer-events-auto text-sm leading-relaxed"
    >
      <div class="font-semibold mb-1">손글씨 변환 오류</div>
      <div class="break-words">{recognizeError}</div>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    background: transparent !important;
  }
</style>
