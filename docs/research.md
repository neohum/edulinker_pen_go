# Research: Windows Screen Annotation Tool (Edulinker-Pen)

## 1. Goal Overview
The objective is to build a Windows desktop application that allows users to draw directly on their screen over other windows, similar to "Epic Pen". 

### Key Technical Characteristics Required:
- **Transparent Overlay**: A full-screen or region-based window that is completely transparent.
- **Click-Through (Hit Testing)**: The transparent parts of the screen *must* pass mouse events (clicks, scrolls) down to the underlying applications. The drawn elements and toolbars *must* intercept mouse events.
- **Drawing Engine**: Smooth ink rendering, support for different colors, brush sizes, and erasing. Potentially supporting stylus pressure.

## 2. Technical Approaches Evaluated

### Approach A: WPF (Windows Presentation Foundation) / C#
Epic Pen itself is built using WPF. WPF is the standard for modern, native Windows desktop applications.

**How it works:**
- Window is made transparent using `AllowsTransparency="True"`, `WindowStyle="None"`, and `Background="Transparent"`.
- Click-through behavior is managed either by WPF's native hit testing (transparent pixels are often naturally click-through if configured correctly) or by using Win32 API Hooks (`WS_EX_LAYERED` | `WS_EX_TRANSPARENT`) to toggle click-through dynamically when the user is drawing vs interacting with the background.
- **The Killer Feature - `InkCanvas`**: WPF includes a built-in `System.Windows.Controls.InkCanvas`. This control handles high-performance vector-based drawing, stroke collection, stylus pressure, and advanced erasing (stroke erasure or point erasure) completely out of the box.
- **Multi-Touch Support**: Natively, `InkCanvas` captures input as a single stroke at a time. To support simultaneous multi-touch drawing (multiple fingers drawing different lines at once), we will need to disable the default touch handling (`IsEnabled=false` on InkCanvas) and manually intercept `TouchDown`, `TouchMove`, and `TouchUp` events. We will map each `TouchDevice.Id` to a new `Stroke` internally and dynamically add them to the `InkCanvas.Strokes` collection.

**Pros:**
- Native performance and low memory footprint compared to web tech.
- `InkCanvas` saves weeks of development time (no need to build a custom drawing engine).
- Direct access to Win32 APIs for advanced window management.

**Cons:**
- Windows-only (aligns with your requirements, but limits future Mac/Linux ports).

### Approach B: Electron (HTML/JS/CSS)
Many modern desktop apps use Electron to wrap web technologies.

**How it works:**
- The renderer window is set to `transparent: true` and `frame: false`.
- Electron provides a specific API `win.setIgnoreMouseEvents(true, { forward: true })` which elegantly allows clicks to pass through transparent areas while catching them on opaque areas (like toolbars or lines on a canvas).
- Drawing is implemented via HTML5 `<canvas>` and JavaScript.

**Pros:**
- Cross-platform.
- Very easy to build sleek, modern UI toolbars using CSS/React/Vue.
- `setIgnoreMouseEvents` is very easy to use for the transparent click-through problem.

**Cons:**
- **Custom Drawing Engine**: We would have to build the drawing engine from scratch on HTML5 Canvas (handling bezier curves, stroke smoothing, and object-based erasing).
- High memory usage and larger binary size.

## 3. Recommendation
**WPF (C#)** is unequivocally the best choice for this specific application. 
While Electron makes the transparent window setup slightly easier, WPF's native `InkCanvas` provides a massive advantage for a drawing application. It handles all the complex mathematics of smooth line drawing, stylus support, and stroke-based erasing natively. Building a clone of Epic Pen in WPF is a well-understood pattern.

## 4. Next Steps (Phase 2)
If you approve of the **WPF / C#** recommendation, the next step is Phase 2: Planning. I will draft `implementation_plan.md` detailing the project structure, the Win32 API interop for the mouse hooks, and the `InkCanvas` setup.
