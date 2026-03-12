# Walkthrough: Edulinker-Pen

## 1. Overview
The **Edulinker-Pen** project is a transparent screen annotation tool built with WPF and .NET 8.0, inspired by Epic Pen. The project has been successfully initialized, coded, and compiled.

## 2. Implemented Features

### 🟥 Transparent Click-Through Overlay
Using [Win32Interop.cs](file:///d:/works/edulinker-pen/Win32Interop.cs), the application intercepts and modifies the Window style using `WS_EX_TRANSPARENT`.
- When **Cursor Mode** is selected, the canvas is completely invisible to the mouse, allowing you to use your PC normally ( clicking folders, browsing the web).
- The Toolbar remains clickable at all times.

### 🖌️ Drawing and Highlighting
The application features a sleek dark-mode toolbar equipped with:
- **Pen**: Standard drawing with size 4.
- **Highlighter**: A thicker, semi-transparent marker.
- **Eraser**: Using WPF's native `StrokeEraser` to delete entire lines on click.
- **Clear All**: Instantly clears the canvas.
- **Color Palette**: Five quick-select colors (Red, Green, Blue, Yellow, White).

### 🖐️ Multi-Touch Support (Advanced)
A custom [MultiTouchInkManager.cs](file:///d:/works/edulinker-pen/MultiTouchInkManager.cs) class was created to bypass WPF's single-stroke limitation. It tracks `TouchDevice.Id` to allow simultaneous drawing with multiple fingers.

## 3. How to Run

Open your terminal at `d:\works\edulinker-pen` and run the following command to start the application:

```bash
dotnet run
```

The application will launch maximized and transparent. 
- Click the **"Pen"** button to start drawing on your screen.
- Click **"Cursor (Click-Through)"** when you want to interact with the applications behind your drawings.

## 4. Verification Notes
- The compilation was successful.
- The UI toolbar renders correctly anchored to the top-right.
- The [Win32Interop](file:///d:/works/edulinker-pen/Win32Interop.cs#8-44) API successfully hooks into `user32.dll`.
- *Note regarding 3D Support*: As discussed, this app draws on a 2D 1080p/4K plane in front of your applications. It does not inject 3D models into games or CAD software.
