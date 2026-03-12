<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { GetMonitors, SetMonitor } from "../wailsjs/go/main/App.js";

    const dispatch = createEventDispatcher();

    interface MonitorInfo {
        index: number;
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        isPrimary: boolean;
    }

    let monitors: MonitorInfo[] = [];
    let selectedIndex: number = -1; // -1 = all monitors
    let loading = true;

    onMount(async () => {
        try {
            monitors = await GetMonitors();
            // Default select primary
            const primary = monitors.find((m) => m.isPrimary);
            if (primary) selectedIndex = primary.index;
        } catch (e) {
            console.error("Failed to get monitors:", e);
        }
        loading = false;
    });

    function selectMonitor(index: number) {
        selectedIndex = index;
    }

    async function applySelection() {
        try {
            console.log("[SetupDialog] Applying monitor:", selectedIndex);
            await SetMonitor(selectedIndex);
            console.log("[SetupDialog] Monitor set successfully");
            dispatch("close");
        } catch (e) {
            console.error("[SetupDialog] Failed to set monitor:", e);
        }
    }

    // Calculate relative positions for visual layout
    $: minX = Math.min(...monitors.map((m) => m.x), 0);
    $: minY = Math.min(...monitors.map((m) => m.y), 0);
    $: maxRight = Math.max(...monitors.map((m) => m.x + m.width), 1);
    $: maxBottom = Math.max(...monitors.map((m) => m.y + m.height), 1);
    $: totalW = maxRight - minX;
    $: totalH = maxBottom - minY;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="fixed inset-0 z-[9999] flex items-start justify-center pt-16 bg-black/50 pointer-events-auto"
    on:click|self={() => {}}
>
    <div
        class="bg-white rounded-2xl shadow-2xl p-8 max-w-xl w-full mx-4 animate-fadeIn"
    >
        <!-- Header -->
        <div class="text-center mb-6">
            <div class="inline-flex items-center gap-2 mb-2">
                <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#4A90E2"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"
                    ></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                <h2 class="text-xl font-bold text-gray-800">화면 선택</h2>
            </div>
            <p class="text-sm text-gray-500">펜을 사용할 모니터를 선택하세요</p>
        </div>

        {#if loading}
            <div class="flex justify-center py-8">
                <div
                    class="animate-spin w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full"
                ></div>
            </div>
        {:else}
            <!-- Monitor visual layout -->
            <div
                class="relative mb-4 mx-auto"
                style="width: 100%; aspect-ratio: {totalW}/{totalH}; max-height: 200px;"
            >
                {#each monitors as monitor}
                    {@const left = ((monitor.x - minX) / totalW) * 100}
                    {@const top = ((monitor.y - minY) / totalH) * 100}
                    {@const width = (monitor.width / totalW) * 100}
                    {@const height = (monitor.height / totalH) * 100}
                    <button
                        class="absolute rounded-lg border-2 transition-all flex flex-col items-center justify-center text-xs font-medium
                               {selectedIndex === monitor.index
                            ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-lg ring-2 ring-blue-300'
                            : 'border-gray-300 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50/50'}"
                        style="left: {left}%; top: {top}%; width: {width}%; height: {height}%;"
                        on:click={() => selectMonitor(monitor.index)}
                    >
                        <span class="text-base font-bold"
                            >{monitor.index + 1}</span
                        >
                        <span class="text-[10px] opacity-75"
                            >{monitor.width}×{monitor.height}</span
                        >
                        {#if monitor.isPrimary}
                            <span class="text-[9px] text-blue-500 font-semibold"
                                >주 모니터</span
                            >
                        {/if}
                    </button>
                {/each}
            </div>

            <!-- All monitors option -->
            <button
                class="w-full mb-4 py-3 rounded-xl border-2 transition-all flex items-center justify-center gap-2 text-sm font-medium
                       {selectedIndex === -1
                    ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-300'
                    : 'border-gray-300 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50/50'}"
                on:click={() => selectMonitor(-1)}
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"
                    ></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                모든 모니터 사용
            </button>

            <!-- Apply button -->
            <button
                class="w-full py-3 rounded-xl bg-blue-500 text-white font-semibold text-base hover:bg-blue-600 active:bg-blue-700 transition-colors shadow-md"
                on:click={applySelection}
            >
                적용
            </button>
        {/if}
    </div>
</div>

<style>
    .animate-fadeIn {
        animation: fadeIn 0.2s ease-out;
    }
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
        }
        to {
            opacity: 1;
            transform: scale(1) translateY(0);
        }
    }
</style>
