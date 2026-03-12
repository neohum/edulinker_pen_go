<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { CaptureScreen } from "../wailsjs/go/main/App.js";

    const dispatch = createEventDispatcher();

    let phase: "loading" | "selecting" | "done" = "loading";
    let fullScreenshot = "";

    // Selection state
    let startX = 0;
    let startY = 0;
    let endX = 0;
    let endY = 0;
    let dragging = false;

    // Computed selection rect
    $: rx = Math.min(startX, endX);
    $: ry = Math.min(startY, endY);
    $: rw = Math.abs(endX - startX);
    $: rh = Math.abs(endY - startY);

    onMount(async () => {
        try {
            const dataURL = await CaptureScreen();
            if (dataURL) {
                fullScreenshot = dataURL;
                phase = "selecting";
            } else {
                dispatch("cancel");
            }
        } catch (e) {
            console.error("[CaptureOverlay] Capture failed:", e);
            dispatch("cancel");
        }
    });

    function onPointerDown(e: PointerEvent) {
        if (phase !== "selecting") return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        endX = e.clientX;
        endY = e.clientY;
        (e.target as HTMLElement)?.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
        if (!dragging) return;
        endX = e.clientX;
        endY = e.clientY;
    }

    function onPointerUp(e: PointerEvent) {
        if (!dragging) return;
        dragging = false;
        endX = e.clientX;
        endY = e.clientY;

        if (rw < 10 || rh < 10) return; // too small

        cropAndFinish();
    }

    function cropAndFinish() {
        const img = new Image();
        img.onload = () => {
            // Calculate scale: screenshot may be larger than viewport (HiDPI)
            const scaleX = img.naturalWidth / window.innerWidth;
            const scaleY = img.naturalHeight / window.innerHeight;

            const canvas = document.createElement("canvas");
            const cw = Math.round(rw * scaleX);
            const ch = Math.round(rh * scaleY);
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(
                img,
                Math.round(rx * scaleX),
                Math.round(ry * scaleY),
                cw,
                ch,
                0,
                0,
                cw,
                ch,
            );

            const croppedDataURL = canvas.toDataURL("image/png");
            phase = "done";
            dispatch("captured", {
                dataURL: croppedDataURL,
                width: rw,
                height: rh,
            });
        };
        img.src = fullScreenshot;
    }

    function cancel() {
        dispatch("cancel");
    }
</script>

<svelte:window
    on:keydown={(e) => {
        if (e.key === "Escape") cancel();
    }}
/>

{#if phase === "loading"}
    <!-- Loading spinner while capturing -->
    <div
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 pointer-events-auto"
    >
        <div
            class="animate-spin w-10 h-10 border-4 border-white border-t-transparent rounded-full"
        ></div>
    </div>
{:else if phase === "selecting"}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="fixed inset-0 z-[9999] pointer-events-auto select-none"
        style="cursor: crosshair;"
        on:pointerdown={onPointerDown}
        on:pointermove={onPointerMove}
        on:pointerup={onPointerUp}
    >
        <!-- Full screenshot background -->
        <img
            src={fullScreenshot}
            alt=""
            class="absolute inset-0 w-full h-full pointer-events-none"
            style="object-fit: fill;"
            draggable="false"
        />

        <!-- Dark overlay using 4 divs around the selection (no box-shadow trick) -->
        {#if rw > 0 && rh > 0}
            <!-- Top dark strip -->
            <div
                class="absolute left-0 right-0 top-0 bg-black/50 pointer-events-none"
                style="height: {ry}px;"
            ></div>
            <!-- Bottom dark strip -->
            <div
                class="absolute left-0 right-0 bottom-0 bg-black/50 pointer-events-none"
                style="top: {ry + rh}px;"
            ></div>
            <!-- Left dark strip -->
            <div
                class="absolute left-0 bg-black/50 pointer-events-none"
                style="top: {ry}px; width: {rx}px; height: {rh}px;"
            ></div>
            <!-- Right dark strip -->
            <div
                class="absolute right-0 bg-black/50 pointer-events-none"
                style="top: {ry}px; left: {rx + rw}px; height: {rh}px;"
            ></div>

            <!-- Selection border -->
            <div
                class="absolute border-2 border-white/90 pointer-events-none"
                style="left: {rx}px; top: {ry}px; width: {rw}px; height: {rh}px;"
            ></div>

            <!-- Size label -->
            <div
                class="absolute bg-blue-600 text-white text-xs px-2 py-0.5 rounded pointer-events-none shadow"
                style="left: {rx}px; top: {ry + rh + 6}px;"
            >
                {rw} × {rh}
            </div>
        {:else}
            <!-- Full dark overlay when no selection yet -->
            <div class="absolute inset-0 bg-black/50 pointer-events-none"></div>
        {/if}

        <!-- Instructions -->
        <div
            class="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-lg text-sm pointer-events-none shadow-lg"
        >
            캡쳐할 영역을 드래그하세요 · ESC로 취소
        </div>
    </div>
{/if}
