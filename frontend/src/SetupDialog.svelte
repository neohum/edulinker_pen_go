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
    let selectedIndex: number = -1;
    let loading = true;
    let activeTab: "monitor" | "about" = "monitor";

    onMount(async () => {
        try {
            monitors = await GetMonitors();
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
            await SetMonitor(selectedIndex);
            dispatch("close");
        } catch (e) {
            console.error("Failed to set monitor:", e);
        }
    }

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
    on:click|self={() => dispatch("close")}
>
    <div
        class="bg-white rounded-2xl shadow-2xl max-w-xl w-full mx-4 animate-fadeIn overflow-hidden"
    >
        <!-- Tab Header -->
        <div class="flex border-b border-gray-200">
            <button
                class="flex-1 py-3 px-4 text-sm font-semibold transition-all
                       {activeTab === 'monitor'
                    ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}"
                on:click={() => (activeTab = "monitor")}
            >
                <span class="inline-flex items-center gap-1.5">
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                        <line x1="8" y1="21" x2="16" y2="21"></line>
                        <line x1="12" y1="17" x2="12" y2="21"></line>
                    </svg>
                    모니터 설정
                </span>
            </button>
            <button
                class="flex-1 py-3 px-4 text-sm font-semibold transition-all
                       {activeTab === 'about'
                    ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}"
                on:click={() => (activeTab = "about")}
            >
                <span class="inline-flex items-center gap-1.5">
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                        ></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    제작팀 소개
                </span>
            </button>
        </div>

        <!-- Tab Content -->
        <div class="p-8">
            {#if activeTab === "monitor"}
                <!-- Monitor Settings Tab -->
                {#if loading}
                    <div class="flex items-center justify-center py-8">
                        <div
                            class="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"
                        ></div>
                    </div>
                {:else}
                    <p class="text-gray-500 text-sm text-center mb-4">
                        사용할 모니터를 선택하세요
                    </p>

                    <div
                        class="relative w-full mb-4 bg-gray-100 rounded-xl overflow-hidden"
                        style="height: 120px;"
                    >
                        {#each monitors as monitor}
                            <button
                                class="absolute rounded-lg border-2 transition-all flex flex-col items-center justify-center text-xs font-medium
                                       {selectedIndex === monitor.index
                                    ? 'border-blue-500 bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                                    : 'border-gray-300 bg-white text-gray-600 hover:border-blue-300'}"
                                style="left: {((monitor.x - minX) / totalW) *
                                    100}%;
                                       top: {((monitor.y - minY) / totalH) *
                                    100}%;
                                       width: {(monitor.width / totalW) * 100}%;
                                       height: {(monitor.height / totalH) *
                                    100}%;"
                                on:click={() => selectMonitor(monitor.index)}
                            >
                                <span class="font-bold"
                                    >{monitor.index + 1}</span
                                >
                                <span class="text-[9px] opacity-70"
                                    >{monitor.width}×{monitor.height}</span
                                >
                                {#if monitor.isPrimary}
                                    <span
                                        class="text-[9px] text-blue-500 font-semibold"
                                        >주 모니터</span
                                    >
                                {/if}
                            </button>
                        {/each}
                    </div>

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
                            <rect x="2" y="3" width="20" height="14" rx="2"
                            ></rect>
                            <line x1="8" y1="21" x2="16" y2="21"></line>
                            <line x1="12" y1="17" x2="12" y2="21"></line>
                        </svg>
                        모든 모니터 사용
                    </button>

                    <button
                        class="w-full py-3 rounded-xl bg-blue-500 text-white font-semibold text-base hover:bg-blue-600 active:bg-blue-700 transition-colors shadow-md"
                        on:click={applySelection}
                    >
                        적용
                    </button>
                {/if}
            {:else if activeTab === "about"}
                <!-- About Team Tab -->
                <div class="text-center">
                    <!-- App Logo/Icon -->
                    <div
                        class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 mb-4 shadow-lg"
                    >
                        <svg
                            width="32"
                            height="32"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"
                            ></path>
                            <path d="M2 2l7.586 7.586"></path>
                            <circle cx="11" cy="11" r="2"></circle>
                        </svg>
                    </div>

                    <h2 class="text-xl font-bold text-gray-800 mb-1">
                        EduLinker Pen
                    </h2>
                    <p class="text-sm text-gray-400 mb-5">v0.1.2</p>

                    <div class="bg-gray-50 rounded-xl p-5 text-left mb-5">
                        <p class="text-sm text-gray-600 leading-relaxed mb-4">
                            <strong class="text-gray-800">EduLinker Pen</strong
                            >은 교육 현장에서 화면 위에 자유롭게 필기하고 설명할
                            수 있도록 만들어진 투명 오버레이 드로잉 도구입니다.
                        </p>

                        <div class="space-y-3">
                            <div class="flex items-start gap-3">
                                <div
                                    class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5"
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="#3B82F6"
                                        stroke-width="2"
                                        ><path
                                            d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
                                        /><circle cx="12" cy="7" r="4" /></svg
                                    >
                                </div>
                                <div>
                                    <p
                                        class="text-sm font-semibold text-gray-700"
                                    >
                                        기획 · 개발
                                    </p>
                                    <p class="text-xs text-gray-500">
                                        EduLinker Team
                                    </p>
                                </div>
                            </div>

                            <div class="flex items-start gap-3">
                                <div
                                    class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5"
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="#22C55E"
                                        stroke-width="2"
                                        ><path
                                            d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
                                        /><path
                                            d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
                                        /></svg
                                    >
                                </div>
                                <div>
                                    <p
                                        class="text-sm font-semibold text-gray-700"
                                    >
                                        기술 스택
                                    </p>
                                    <p class="text-xs text-gray-500">
                                        Go · Wails · Svelte · Win32 API
                                    </p>
                                </div>
                            </div>

                            <div class="flex items-start gap-3">
                                <div
                                    class="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mt-0.5"
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="#8B5CF6"
                                        stroke-width="2"
                                        ><path
                                            d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                                        /><path
                                            d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                                        /></svg
                                    >
                                </div>
                                <div>
                                    <p
                                        class="text-sm font-semibold text-gray-700"
                                    >
                                        GitHub
                                    </p>
                                    <a
                                        href="#"
                                        class="text-xs text-blue-500 hover:underline"
                                        >github.com/neohum/edulinker_pen_go</a
                                    >
                                </div>
                            </div>
                        </div>
                    </div>

                    <p class="text-xs text-gray-400">
                        © 2026 EduLinker. All rights reserved.
                    </p>
                </div>
            {/if}
        </div>

        <!-- Close button -->
        <div class="px-8 pb-6 pt-0">
            <button
                class="w-full py-2.5 rounded-xl border border-gray-300 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors"
                on:click={() => dispatch("close")}
            >
                닫기
            </button>
        </div>
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
