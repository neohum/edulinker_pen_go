# Implementation Plan: Edulinker-Pen (WPF)

This document outlines the architecture and implementation steps for building the "Edulinker-Pen" screen annotation tool using WPF/C# and .NET.

## 1. Goal Description
To build a transparent, full-screen Windows desktop application that allows the user to draw on the screen over other applications. The user interacts through a toolbar to select drawing tools (pen, highlighter, eraser). The background must be fully transparent and pass mouse clicks through to the underlying applications unless the user is actively drawing.

## User Review Required
> [!IMPORTANT]
> - The application will be created as a standard WPF .NET Core (e.g., .NET 8.0) application.
> - We will use Win32 API calls to manage the "click-through" state of the transparent window.
> - Multi-touch simultaneous drawing will require custom event handling on top of the standard `InkCanvas`.

## 2. Proposed Changes & Architecture

### Application Structure
We will create a single executable WPF application with the following core components:

#### [NEW] `EdulinkerPen.csproj`
The main project file targeting .NET 8.0-windows, with `UseWPF` set to true.

#### [NEW] `MainWindow.xaml` / `MainWindow.xaml.cs`
The main transparent overlay window.
- **XAML Configuration**: `AllowsTransparency="True"`, `WindowStyle="None"`, `Background="Transparent"`, `Topmost="True"`, `WindowState="Maximized"`.
- **Layout**:
  1.  A transparent grid spanning the entire screen.
  2.  An `InkCanvas` for drawing, covering the entire screen.
  3.  A floating toolbar overlay containing the tool buttons (Pen, Highlighter, Eraser, Clear, Color Picker).

#### [NEW] `Win32Interop.cs`
A helper class to handle Win32 API calls (`user32.dll`). This is critical for toggling the click-through state.
- Will define `WS_EX_LAYERED` and `WS_EX_TRANSPARENT`.
- Will provide methods: `EnableClickThrough()` and `DisableClickThrough()`.
 *Note: Even when click-through is enabled for the background grid, the Toolbar panel must remain opaque and clickable.*

#### [NEW] `MultiTouchInkManager.cs`
A specialized manager class to handle simultaneous multi-touch drawing.
- Instead of using `InkCanvas`'s default touch handling, we will subscribe to the `MainWindow`'s `TouchDown`, `TouchMove`, and `TouchUp` events.
- Will maintain a `Dictionary<int, Stroke>` to map `TouchDevice.Id` to active strokes.
- During `TouchMove`, we update the `StylusPoints` of the corresponding stroke so users can draw with multiple fingers at once.

### Workflow / Logic
1.  **Startup**: The app launches full-screen and transparent. Click-through is enabled for the canvas area. The toolbar is visible and clickable.
2.  **Tool Selection**: The user clicks a tool on the toolbar (e.g., Pen).
3.  **Drawing State**: 
    - The `EdulinkerPen` enters "Drawing Mode".
    - `DisableClickThrough()` is called so the window now intercepts mouse/touch events.
    - User draws on the `InkCanvas` (single touch via mouse or multi-touch via `MultiTouchInkManager`).
4.  **Cursor State**: When "Cursor Mode" (or default mode) is selected, `EnableClickThrough()` is called, allowing the user to interact with the applications behind the drawing overlay.

## 3. Verification Plan

### Automated Tests
- This is primarily a UI and Win32 interop project, so unit tests will be limited. We will focus on compiling successfully.

### Manual Verification
1.  Run the application.
2.  Verify the background is completely transparent and covers the whole screen.
3.  Verify the toolbar is visible.
4.  Activate "Cursor / Pointer" mode and verify clicks pass through the transparent area to underlying windows (e.g., clicking a desktop icon or a browser link).
5.  Activate "Pen" mode and trace a line with the mouse over underlying windows. Verify the ink appears but the underlying window does not receive the click.
6.  Test drawing with multiple fingers simultaneously (if a touch screen is available).
7.  Verify switching colors, using the eraser, and the "Clear All" button work correctly.
