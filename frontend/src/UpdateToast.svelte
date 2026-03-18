<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { EventsOn, EventsOff } from "../wailsjs/runtime/runtime";
    import { InstallUpdate } from "../wailsjs/go/main/App";

    let status: "hidden" | "available" | "downloading" | "ready" | "error" =
        "hidden";
    let version = "";
    let notes = "";
    let errorMessage = "";

    let unlistener: () => void;

    onMount(() => {
        unlistener = EventsOn("update-status", (data: any) => {
            console.log("Update status received:", data);

            if (!data || !data.status) return;

            status = data.status;

            if (status === "available") {
                version = data.version || "";
                notes = data.notes || "";
            } else if (status === "error") {
                errorMessage =
                    data.error || "Unknown error occurred during update.";
                // Auto-hide error after 5 seconds
                setTimeout(() => {
                    if (status === "error") status = "hidden";
                }, 5000);
            }
        });
    });

    onDestroy(() => {
        if (unlistener) {
            unlistener();
        }
    });

    function handleInstall() {
        InstallUpdate();
    }

    function handleClose() {
        status = "hidden";
    }
</script>

{#if status !== "hidden"}
    <div
        class="fixed bottom-4 right-4 w-80 bg-slate-800 text-white rounded-lg shadow-xl shadow-black/50 overflow-hidden z-[9999] transition-all animate-slide-up border border-slate-700"
    >
        <div
            class="px-4 py-3 border-b border-slate-700 flex justify-between items-center bg-slate-800/80 backdrop-blur"
        >
            <h3 class="font-bold text-slate-100 flex items-center gap-2">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-blue-400"
                >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                EduLinker Pen Update
            </h3>
            {#if status !== "downloading"}
                <button
                    on:click={handleClose}
                    class="text-slate-400 hover:text-white transition-colors"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            {/if}
        </div>

        <div class="p-4 bg-slate-800 text-sm border-b border-slate-700">
            {#if status === "available"}
                <p class="mb-2">
                    A new version (<span class="font-semibold text-blue-300"
                        >{version}</span
                    >) is downloading in the background...
                </p>
                <div
                    class="mt-3 text-xs bg-slate-900/50 p-2 rounded text-slate-300 max-h-24 overflow-y-auto w-full break-words scrollbar-thin"
                >
                    {notes || "No release notes available."}
                </div>
            {:else if status === "downloading"}
                <p class="mb-2 flex items-center gap-2">
                    <svg
                        class="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-400"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            class="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            stroke-width="4"
                        ></circle>
                        <path
                            class="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                    </svg>
                    Downloading update quietly...
                </p>
                <div
                    class="w-full bg-slate-700 rounded-full h-1.5 mt-2 overflow-hidden"
                >
                    <div
                        class="bg-blue-400 h-1.5 rounded-full w-full animate-pulse"
                    ></div>
                </div>
            {:else if status === "ready"}
                <p
                    class="font-medium text-emerald-400 mb-1 flex items-center gap-2"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    Update Ready to Install!
                </p>
                <p class="text-slate-300 mt-2">
                    The update will automatically install in the background when
                    you restart.
                </p>
            {:else if status === "error"}
                <p class="text-red-400 font-medium flex items-center gap-2">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    Update Failed
                </p>
                <p class="text-slate-300 mt-2 text-xs break-words">
                    {errorMessage}
                </p>
            {/if}
        </div>

        {#if status === "ready"}
            <div class="p-3 bg-slate-900/40 flex justify-end gap-2">
                <button
                    on:click={handleClose}
                    class="px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors"
                >
                    Later
                </button>
                <button
                    on:click={handleInstall}
                    class="px-4 py-1.5 text-xs font-semibold bg-blue-500 hover:bg-blue-600 text-white rounded shadow transition-colors flex items-center gap-1.5"
                >
                    Restart Now
                </button>
            </div>
        {/if}
    </div>
{/if}

<style>
    @keyframes slide-up {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .animate-slide-up {
        animation: slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
</style>
