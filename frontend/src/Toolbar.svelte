<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { slide } from "svelte/transition";
    import { SetClickArea, ClearClickArea } from "../wailsjs/go/main/App.js";

    const dispatch = createEventDispatcher();

    export let activeTool = "pen";
    export let penColor = "#000000";
    export let highlighterColor = "#FFFF00";
    export let brushSize = 4;
    export let isExpanded = true;

    // Computed propery for current tool color
    $: currentColor =
        activeTool === "highlighter" ? highlighterColor : penColor;

    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let windowStart = { x: 0, y: 0 };

    // Popups visibility states
    let showPenMenu = false;
    let showBrushMenu = false;
    let showBgMenu = false;
    let showColorMenu = false;
    let showSettingsMenu = false;

    let colors = [
        { name: "Black", hex: "#000000" },
        { name: "Red", hex: "#FF0000" },
        { name: "Blue", hex: "#1E90FF" },
        { name: "Green", hex: "#00CC00" },
        { name: "Yellow", hex: "#FFFF00" },
        { name: "Orange", hex: "#FF8C00" },
        { name: "Purple", hex: "#8B00FF" },
        { name: "White", hex: "#FFFFFF" },
    ];

    let customColorInput: HTMLInputElement;
    let editingColorIndex = -1; // -1 = not editing, 0+ = replacing that swatch

    function onCustomColorPicked(e: Event) {
        const hex = (e.target as HTMLInputElement).value;
        if (editingColorIndex >= 0) {
            // Replace an existing swatch color
            colors[editingColorIndex].hex = hex;
            colors = colors; // trigger reactivity
            editingColorIndex = -1;
        }
        selectColor(hex);
    }

    function openCustomColor(replaceIndex = -1) {
        editingColorIndex = replaceIndex;
        customColorInput?.click();
    }

    let toolbarElement: HTMLElement;
    let currentPos = { x: 20, y: 20 };
    let hasDragged = false;
    let dragDistance = 0;
    let isDragOriginHandle = false;

    let dragStartPos = { x: 0, y: 0 }; // 추가: 최초 클릭 위치 저장용

    // Reactive statement to check if we are near the bottom of the screen
    $: isNearBottom = currentPos.y > window.innerHeight - 150;

    function handleDragStart(e: MouseEvent | TouchEvent) {
        const target = e.target as HTMLElement;
        const isHandle = !!target.closest(".drag-handle");
        const isButton = !!target.closest("button");

        // If the click is on ANY button but not the drag handle, ignore the drag entirely.
        if (isButton && !isHandle) return;

        isDragging = true;
        hasDragged = false;
        dragDistance = 0;
        isDragOriginHandle = isHandle;

        // Restore full window area during drag to allow rendering the dragged toolbar anywhere
        if (!isExpanded) {
            ClearClickArea();
        }

        // Handle touch and mouse coordinates uniformly
        let clientX = 0,
            clientY = 0;
        if (window.TouchEvent && e instanceof TouchEvent) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as MouseEvent).clientX;
            clientY = (e as MouseEvent).clientY;
        }

        dragStart = { x: clientX, y: clientY };
        dragStartPos = { x: clientX, y: clientY }; // 최초 위치 기록

        // We intentionally DO NOT use pointer capture.
        // Webview2 sometimes swallows native 'click' events if pointer capture is engaged.
        // We rely on <svelte:window> events for smooth dragging.
    }

    function handleDragMove(e: MouseEvent | TouchEvent) {
        if (!isDragging) return;

        let clientX = 0,
            clientY = 0;
        if (window.TouchEvent && e instanceof TouchEvent) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as MouseEvent).clientX;
            clientY = (e as MouseEvent).clientY;
        }

        // 현재 이동량 (UI 위치 업데이트용)
        const dx = clientX - dragStart.x;
        const dy = clientY - dragStart.y;

        // 시작점으로부터의 전체 이동 거리 계산 (클릭과 드래그 구분용)
        const totalDx = clientX - dragStartPos.x;
        const totalDy = clientY - dragStartPos.y;

        // 모바일이나 펜 입력시 미세한 흔들림 무시 (임계값을 10으로 증가)
        if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > 10) {
            hasDragged = true;
        }

        currentPos.x += dx;
        currentPos.y += dy;
        dragStart = { x: clientX, y: clientY };
    }

    function handleDragEnd(e: MouseEvent | TouchEvent) {
        if (!isDragging) return;
        isDragging = false;

        // Click detection: if it was from the handle and didn't move much
        if (isDragOriginHandle && !hasDragged) {
            toggleExpand();
        } else if (!isExpanded) {
            // Apply the new position to the window region after dragging
            SetClickArea(currentPos.x - 10, currentPos.y - 10, 70, 70);
        }
    }

    function toggleExpand() {
        isExpanded = !isExpanded;
        dispatch("toggleClickThrough", isExpanded);

        if (!isExpanded) {
            closeAllMenus();
            // Wait a tiny bit for the animation to start/finish, or just clip immediately
            SetClickArea(currentPos.x - 10, currentPos.y - 10, 70, 70);
        } else {
            ClearClickArea();
        }
    }

    function selectTool(tool: string) {
        activeTool = tool;
        dispatch("toolChange", tool);
        closeAllMenus();
    }

    onMount(() => {
        // Init state
        if (!isExpanded) {
            SetClickArea(currentPos.x - 10, currentPos.y - 10, 70, 70);
        } else {
            ClearClickArea();
        }
    });

    function selectColor(hex: string) {
        if (activeTool === "highlighter") {
            highlighterColor = hex;
        } else {
            penColor = hex;
        }
        dispatch("colorChange", hex);
        closeAllMenus();
    }

    function selectBrushSize(size: number) {
        brushSize = size;
        dispatch("brushSizeChange", size);
        closeAllMenus();
    }

    function closeAllMenus() {
        showPenMenu = false;
        showBrushMenu = false;
        showBgMenu = false;
        showColorMenu = false;
        showSettingsMenu = false;
    }
</script>

<!-- Window-level events for smooth dragging without capture -->
<svelte:window
    on:mousemove={handleDragMove}
    on:mouseup={handleDragEnd}
    on:touchmove={handleDragMove}
    on:touchend={handleDragEnd}
    on:touchcancel={handleDragEnd}
/>

<div
    bind:this={toolbarElement}
    class="fixed z-50 flex items-center pointer-events-auto {isNearBottom
        ? 'flex-row'
        : 'flex-col'} {isExpanded
        ? 'rounded-2xl p-3 border border-[#4A90E2]/30 shadow-[0_4px_20px_rgba(74,144,226,0.15)] bg-[#E8F0F4FA] backdrop-blur-md'
        : ''}"
    style="left: {currentPos.x}px; top: {currentPos.y}px;"
>
    <!-- Toggle Collapse/Expand Button (Pen Icon) -->
    <div class="relative w-12 h-12">
        <button
            class="w-full h-full flex items-center justify-center transition-all pointer-events-auto {isExpanded
                ? isNearBottom
                    ? 'mr-3 rounded-xl hover:bg-[#4A90E2]/20'
                    : 'mb-2 rounded-xl hover:bg-[#4A90E2]/20'
                : 'rounded-full bg-[#E8F0F4FA] border border-[#4A90E2]/40 shadow-[0_4px_15px_rgba(0,0,0,0.15)] backdrop-blur-md z-10 hover:shadow-[0_6px_20px_rgba(0,0,0,0.2)] hover:scale-105'}"
            title="Click to {isExpanded ? 'collapse' : 'expand'}"
        >
            <img
                src="/src/assets/images/pen.png"
                alt="EduLinker Pen"
                class="w-8 h-8 pointer-events-none"
            />
        </button>
        <!-- Invisible overlay explicitly for catching clicks reliably -->
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            class="absolute inset-0 cursor-pointer z-20 drag-handle"
            on:mousedown={handleDragStart}
            on:touchstart={handleDragStart}
        ></div>
    </div>

    {#if isExpanded}
        <div
            class="flex gap-1.5 {isNearBottom
                ? 'flex-row origin-left'
                : 'flex-col origin-top'}"
            transition:slide={{ duration: 300, axis: isNearBottom ? "x" : "y" }}
        >
            <!-- Pen Button -->
            <div class="relative">
                <button
                    class="w-11 h-11 shrink-0 rounded-lg border flex items-center justify-center transition-all {activeTool ===
                        'pen' || activeTool === 'actionpen'
                        ? 'bg-[#4A90E2]/20 border-[#4A90E2]/60 border-[1.5px]'
                        : 'bg-[#4A90E2]/10 border-[#4A90E2]/25 hover:bg-[#4A90E2]/20'}"
                    on:click={() => {
                        if (
                            activeTool === "pen" ||
                            activeTool === "actionpen"
                        ) {
                            showPenMenu = !showPenMenu;
                        } else {
                            selectTool("pen");
                            showPenMenu = true;
                        }
                    }}
                    title="Pen Tools"
                >
                    <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#333333"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        {#if activeTool === "actionpen"}
                            <polygon
                                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                            ></polygon>
                        {:else}
                            <path
                                d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
                            />
                        {/if}
                    </svg>
                </button>
                {#if showPenMenu}
                    <div
                        class="absolute {isNearBottom
                            ? 'bottom-14 left-0'
                            : 'left-14 top-0'} bg-[#E8F0F4] p-2 rounded-xl border border-[#4A90E2]/30 flex gap-2 shadow-lg pointer-events-auto z-50"
                    >
                        <button
                            class="flex items-center gap-2 px-3 py-2 rounded-lg border transition-all {activeTool ===
                            'pen'
                                ? 'bg-[#4A90E2]/20 border-[#4A90E2]/60'
                                : 'bg-[#4A90E2]/10 border-[#4A90E2]/25 hover:bg-[#4A90E2]/20'}"
                            on:click={() => {
                                selectTool("pen");
                                showPenMenu = false;
                            }}
                            title="Normal Pen"
                        >
                            <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#333333"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path
                                    d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
                                />
                            </svg>
                            <span class="text-sm font-medium whitespace-nowrap"
                                >Normal Pen</span
                            >
                        </button>
                        <button
                            class="flex items-center gap-2 px-3 py-2 rounded-lg border transition-all {activeTool ===
                            'actionpen'
                                ? 'bg-[#F39C12]/20 border-[#F39C12]/60'
                                : 'bg-[#F39C12]/10 border-[#F39C12]/25 hover:bg-[#F39C12]/20'}"
                            on:click={() => {
                                selectTool("actionpen");
                                showPenMenu = false;
                            }}
                            title="Action Pen (3D)"
                        >
                            <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#333333"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <polygon
                                    points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                                ></polygon>
                            </svg>
                            <span class="text-sm font-medium whitespace-nowrap"
                                >Action Pen</span
                            >
                        </button>
                    </div>
                {/if}
            </div>

            <!-- Highlighter Button -->
            <button
                class="w-11 h-11 shrink-0 rounded-lg border flex items-center justify-center transition-all {activeTool ===
                'highlighter'
                    ? 'bg-[#4A90E2]/20 border-[#4A90E2]/60 border-[1.5px]'
                    : 'bg-[#4A90E2]/10 border-[#4A90E2]/25 hover:bg-[#4A90E2]/20'}"
                on:click={() => selectTool("highlighter")}
            >
                <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#333333"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="m9 11-6 6v3h9l3-3" /><path
                        d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"
                    />
                </svg>
            </button>

            <!-- Eraser Button -->
            <button
                class="w-11 h-11 shrink-0 rounded-lg border flex items-center justify-center transition-all {activeTool ===
                'eraser'
                    ? 'bg-[#4A90E2]/20 border-[#4A90E2]/60 border-[1.5px]'
                    : 'bg-[#4A90E2]/10 border-[#4A90E2]/25 hover:bg-[#4A90E2]/20'}"
                on:click={() => selectTool("eraser")}
            >
                <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#333333"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path
                        d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"
                    /><path d="m5.082 11.09 8.828 8.828" />
                </svg>
            </button>

            <!-- Clear All -->
            <button
                class="w-11 h-11 shrink-0 rounded-lg border flex items-center justify-center transition-all bg-[#F39C12]/15 border-[#F39C12]/30 hover:bg-[#F39C12]/25"
                on:click={() => dispatch("clearAll")}
            >
                <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#333333"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M3 6h18" /><path
                        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
                    /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path
                        d="M10 11v6"
                    /><path d="M14 11v6" />
                </svg>
            </button>

            <!-- Brush Size -->
            <div class="relative">
                <button
                    class="w-11 h-11 shrink-0 rounded-lg border flex items-center justify-center transition-all bg-[#4A90E2]/10 border-[#4A90E2]/25 hover:bg-[#4A90E2]/20"
                    on:click={() => {
                        closeAllMenus();
                        showBrushMenu = !showBrushMenu;
                    }}
                >
                    <div
                        class="bg-[#333333] rounded-full"
                        style="width: {brushSize * 2}px; height: {brushSize *
                            2}px;"
                    ></div>
                </button>
                {#if showBrushMenu}
                    <div
                        class="absolute left-14 top-0 bg-[#E8F0F4] p-2 rounded-xl border border-[#4A90E2]/30 flex gap-1 shadow-lg pointer-events-auto z-50"
                    >
                        {#each [2, 4, 8, 12] as size}
                            <button
                                class="w-10 h-10 rounded-lg border bg-[#4A90E2]/10 border-[#4A90E2]/25 flex items-center justify-center hover:bg-[#4A90E2]/20"
                                on:click={() => selectBrushSize(size)}
                            >
                                <div
                                    class="bg-[#333333] rounded-full"
                                    style="width: {size * 2}px; height: {size *
                                        2}px;"
                                ></div>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>

            <div
                class="{isNearBottom
                    ? 'w-px h-8 self-center mx-1'
                    : 'h-px w-full my-1'} bg-[#4A90E2]/30 shrink-0"
            ></div>

            <!-- Background -->
            <div class="relative">
                <button
                    class="w-11 h-11 shrink-0 rounded-lg border flex items-center justify-center transition-all bg-[#4A90E2]/10 border-[#4A90E2]/25 hover:bg-[#4A90E2]/20"
                    on:click={() => {
                        closeAllMenus();
                        showBgMenu = !showBgMenu;
                    }}
                    title="Change Background"
                >
                    <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#333333"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <rect
                            x="3"
                            y="3"
                            width="18"
                            height="18"
                            rx="2"
                            ry="2"
                        />
                    </svg>
                </button>
                {#if showBgMenu}
                    <div
                        class="absolute left-14 top-0 bg-[#E8F0F4] p-2 rounded-xl border border-[#4A90E2]/30 flex gap-1 shadow-lg pointer-events-auto z-50"
                    >
                        <button
                            title="Transparent"
                            class="w-10 h-10 rounded-lg border border-[#4A90E2]/40 flex items-center justify-center hover:bg-[#4A90E2]/10"
                            on:click={() => {
                                dispatch("bgChange", "transparent");
                                closeAllMenus();
                            }}
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#333333"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path d="M18 6L6 18 M6 6l12 12" />
                            </svg>
                        </button>
                        <button
                            title="White"
                            class="w-10 h-10 rounded-lg border border-[#4A90E2]/40 bg-white hover:border-[#4A90E2]"
                            on:click={() => {
                                dispatch("bgChange", "white");
                                closeAllMenus();
                            }}
                        ></button>
                        <button
                            title="Black"
                            class="w-10 h-10 rounded-lg border border-[#4A90E2]/40 bg-black hover:border-[#4A90E2]"
                            on:click={() => {
                                dispatch("bgChange", "black");
                                closeAllMenus();
                            }}
                        ></button>
                    </div>
                {/if}
            </div>

            <div
                class="{isNearBottom
                    ? 'w-px h-8 self-center mx-1'
                    : 'h-px w-full my-1'} bg-[#4A90E2]/30 shrink-0"
            ></div>

            <!-- Color Picker -->
            <div class="relative flex justify-center">
                <button
                    class="w-8 h-8 shrink-0 rounded-full border-2 transition-all border-[#4A90E2]/40 hover:border-[#4A90E2]/70"
                    style="background-color: {currentColor};"
                    on:click={() => {
                        closeAllMenus();
                        showColorMenu = !showColorMenu;
                    }}
                ></button>
                {#if showColorMenu}
                    <div
                        class="absolute left-12 top-0 bg-[#E8F0F4] p-3 rounded-xl border border-[#4A90E2]/30 shadow-lg pointer-events-auto z-50"
                        style="min-width: 120px;"
                    >
                        <!-- 2 columns × 4 rows grid -->
                        <div class="grid grid-cols-2 gap-2">
                            {#each colors as c, i}
                                <button
                                    class="w-12 h-8 rounded border-2 transition-all hover:border-[#4A90E2]/90 {currentColor ===
                                    c.hex
                                        ? 'border-[#4A90E2] ring-1 ring-[#4A90E2]/50'
                                        : 'border-[#4A90E2]/30'}"
                                    style="background-color: {c.hex};"
                                    on:click={() => selectColor(c.hex)}
                                    on:contextmenu|preventDefault={() =>
                                        openCustomColor(i)}
                                    title="{c.name} (우클릭: 색 변경)"
                                ></button>
                            {/each}
                        </div>

                        <!-- Divider -->
                        <div class="h-px bg-[#4A90E2]/20 my-2"></div>

                        <!-- Custom color button -->
                        <button
                            class="w-full h-8 rounded border-2 border-dashed border-[#4A90E2]/40 text-xs text-[#4A90E2] hover:border-[#4A90E2]/70 hover:bg-[#4A90E2]/10 transition-all flex items-center justify-center gap-1"
                            on:click={() => openCustomColor(-1)}
                        >
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                ><line x1="12" y1="5" x2="12" y2="19" /><line
                                    x1="5"
                                    y1="12"
                                    x2="19"
                                    y2="12"
                                /></svg
                            >
                            커스텀
                        </button>
                    </div>
                {/if}

                <!-- Hidden native color picker -->
                <input
                    bind:this={customColorInput}
                    type="color"
                    value={currentColor}
                    on:input={onCustomColorPicked}
                    class="sr-only"
                />
            </div>

            <div
                class="{isNearBottom
                    ? 'w-px h-8 self-center mx-1'
                    : 'h-px w-full my-1'} bg-[#4A90E2]/30 shrink-0"
            ></div>

            <!-- Screen Capture Button -->
            <div class="relative">
                <button
                    class="w-11 h-11 shrink-0 rounded-lg border flex items-center justify-center transition-all bg-[#4A90E2]/10 border-[#4A90E2]/25 hover:bg-[#4A90E2]/20"
                    on:click={() => {
                        closeAllMenus();
                        dispatch("capture");
                    }}
                    title="화면 캡쳐"
                >
                    <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#333333"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path
                            d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
                        />
                        <circle cx="12" cy="13" r="4" />
                    </svg>
                </button>
            </div>

            <div
                class="{isNearBottom
                    ? 'w-px h-8 self-center mx-1'
                    : 'h-px w-full my-1'} bg-[#4A90E2]/30 shrink-0"
            ></div>

            <!-- Settings Button -->
            <div class="relative">
                <button
                    class="w-11 h-11 shrink-0 rounded-lg border flex items-center justify-center transition-all bg-[#4A90E2]/10 border-[#4A90E2]/25 hover:bg-[#4A90E2]/20"
                    on:click={() => {
                        closeAllMenus();
                        dispatch("openSettings");
                    }}
                    title="Settings"
                >
                    <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#333333"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <circle cx="12" cy="12" r="3" />
                        <path
                            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
                        />
                    </svg>
                </button>
            </div>
        </div>
    {/if}
</div>
