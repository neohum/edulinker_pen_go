<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { ShapeCandidate, ShapeResult } from "./ShapeRecognizer";

    export let candidates: ShapeCandidate[] = [];
    export let bbox: { x: number; y: number; w: number; h: number } = {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
    };
    // Smart-pen text candidates from the handwriting recognizer. Arrive async
    // after the chooser opens; rendered as chips below the shape thumbnails.
    export let textCandidates: string[] = [];

    const dispatch = createEventDispatcher<{
        pick: ShapeResult;
        pickText: string;
        keep: void;
    }>();

    // Position the chooser below the stroke if there's room, otherwise above.
    const CHOOSER_HEIGHT = 84;
    const MARGIN = 12;
    $: belowSpace = window.innerHeight - (bbox.y + bbox.h) - MARGIN;
    $: posY =
        belowSpace > CHOOSER_HEIGHT
            ? bbox.y + bbox.h + MARGIN
            : Math.max(MARGIN, bbox.y - CHOOSER_HEIGHT - MARGIN);
    $: posX = Math.max(
        MARGIN,
        Math.min(
            window.innerWidth - 320 - MARGIN,
            bbox.x + bbox.w / 2 - 160,
        ),
    );

    function shapeLabel(s: ShapeResult): string {
        switch (s.type) {
            case "circle":
                return "원";
            case "ellipse":
                return "타원";
            case "rectangle":
                return "사각형";
            case "rotatedRectangle":
                return "기울인 사각형";
            case "parallelogram":
                return "평행사변형";
            case "triangle":
                return "삼각형";
            case "heart":
                return "하트";
            case "line":
                return "직선";
            case "arrow":
                return "화살표";
            default:
                return "?";
        }
    }
</script>

<div
    class="fixed z-[80] bg-white border border-[#4A90E2]/40 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.18)] p-2 flex flex-col gap-1.5 pointer-events-auto"
    style="left: {posX}px; top: {posY}px;"
>
  <div class="flex items-center gap-1.5">
    <span class="text-xs text-gray-500 px-2">어떤 모양?</span>
    {#each candidates as c}
        <button
            class="w-12 h-14 rounded-lg border border-[#4A90E2]/30 bg-[#F0F7FF] hover:bg-[#4A90E2]/15 hover:border-[#4A90E2]/70 flex flex-col items-center justify-center transition-all"
            on:click={() => dispatch("pick", c.shape)}
            title="{shapeLabel(c.shape)} ({Math.round(c.score * 100)}%)"
        >
            <svg
                width="28"
                height="28"
                viewBox="0 0 32 32"
                fill="none"
                stroke="#333"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                {#if c.shape.type === "circle"}
                    <circle cx="16" cy="16" r="11" />
                {:else if c.shape.type === "ellipse"}
                    <ellipse cx="16" cy="16" rx="13" ry="8" />
                {:else if c.shape.type === "rectangle"}
                    <rect x="4" y="7" width="24" height="18" rx="1" />
                {:else if c.shape.type === "rotatedRectangle"}
                    <polygon points="6,10 26,4 26,22 6,28" />
                {:else if c.shape.type === "parallelogram"}
                    <polygon points="3,24 12,8 29,8 20,24" />
                {:else if c.shape.type === "triangle"}
                    <polygon points="16,4 28,26 4,26" />
                {:else if c.shape.type === "heart"}
                    <path
                        d="M16 27 C 4 18, 6 8, 12 8 C 14 8, 16 10, 16 12 C 16 10, 18 8, 20 8 C 26 8, 28 18, 16 27 Z"
                    />
                {:else if c.shape.type === "line"}
                    <line x1="5" y1="22" x2="27" y2="10" />
                {:else if c.shape.type === "arrow"}
                    <line x1="5" y1="16" x2="25" y2="16" />
                    <polyline points="20,10 27,16 20,22" />
                {/if}
            </svg>
            <span class="text-[9px] text-gray-600 mt-0.5 leading-tight"
                >{shapeLabel(c.shape)}</span
            >
        </button>
    {/each}

    <div class="w-px h-10 bg-gray-200 mx-0.5"></div>

    <button
        class="w-14 h-14 rounded-lg border border-gray-300 bg-gray-50 hover:bg-gray-100 flex flex-col items-center justify-center transition-all"
        on:click={() => dispatch("keep")}
        title="원본 유지"
    >
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#666"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path
                d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
            />
        </svg>
        <span class="text-[9px] text-gray-600 mt-0.5">원본</span>
    </button>

    <button
        class="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 flex items-center justify-center text-sm leading-none ml-1"
        on:click={() => dispatch("keep")}
        title="닫기"
    >
        ×
    </button>
  </div>

  {#if textCandidates && textCandidates.length > 0}
    <div class="flex items-center gap-1.5 flex-wrap border-t border-gray-200 pt-1.5 mt-0.5">
      <span class="text-xs text-gray-500 px-2">또는 글씨:</span>
      {#each textCandidates.slice(0, 6) as t}
        <button
          class="px-2.5 py-1 rounded-md text-sm border bg-[#F0F7FF] border-[#3498DB]/30 hover:bg-[#3498DB]/15 hover:border-[#3498DB]/70 text-[#1F6FB2] transition-all"
          on:click={() => dispatch("pickText", t)}
          title="이 텍스트로 변환"
        >
          {t}
        </button>
      {/each}
    </div>
  {/if}
</div>
