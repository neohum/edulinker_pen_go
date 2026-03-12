package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"syscall"
	"unsafe"
)

var (
	gdi32                   = syscall.NewLazyDLL("gdi32.dll")
	procCreateRectRgn       = gdi32.NewProc("CreateRectRgn")
	procCreateCompatibleDC  = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBmp = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject        = gdi32.NewProc("SelectObject")
	procBitBlt              = gdi32.NewProc("BitBlt")
	procDeleteObject        = gdi32.NewProc("DeleteObject")
	procDeleteDC            = gdi32.NewProc("DeleteDC")
	procGetDIBits           = gdi32.NewProc("GetDIBits")

	user32                  = syscall.NewLazyDLL("user32.dll")
	procGetWindowLong       = user32.NewProc("GetWindowLongW")
	procSetWindowLong       = user32.NewProc("SetWindowLongW")
	procFindWindow          = user32.NewProc("FindWindowW")
	procSetWindowRgn        = user32.NewProc("SetWindowRgn")
	procGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procEnumDisplayMonitors = user32.NewProc("EnumDisplayMonitors")
	procGetMonitorInfo      = user32.NewProc("GetMonitorInfoW")
	procGetDC               = user32.NewProc("GetDC")
	procReleaseDC           = user32.NewProc("ReleaseDC")
)

const (
	GWL_EXSTYLE       = ^uint32(19) // -20
	WS_EX_LAYERED     = 0x00080000
	WS_EX_TRANSPARENT = 0x00000020
	WS_EX_NOACTIVATE  = 0x08000000

	// System metrics for virtual screen (all monitors combined)
	SM_XVIRTUALSCREEN  = 76
	SM_YVIRTUALSCREEN  = 77
	SM_CXVIRTUALSCREEN = 78
	SM_CYVIRTUALSCREEN = 79

	// SetWindowPos flags
	HWND_TOPMOST   = ^uintptr(0) // -1 = HWND_TOPMOST
	SWP_NOACTIVATE = 0x0010
	SWP_SHOWWINDOW = 0x0040

	// Monitor info flags
	MONITORINFOF_PRIMARY = 0x00000001
)

// RECT represents a Win32 RECT structure.
type RECT struct {
	Left, Top, Right, Bottom int32
}

// MONITORINFOEX represents Win32 MONITORINFOEXW structure.
type MONITORINFOEX struct {
	Size    uint32
	Monitor RECT
	Work    RECT
	Flags   uint32
	Device  [32]uint16 // CCHDEVICENAME = 32
}

// MonitorInfo is the Go-friendly monitor info returned to the frontend.
type MonitorInfo struct {
	Index     int    `json:"index"`
	Name      string `json:"name"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	IsPrimary bool   `json:"isPrimary"`
}

// getHwnd finds the window handle by its title.
func getHwnd(windowTitle string) syscall.Handle {
	titlePtr, _ := syscall.UTF16PtrFromString(windowTitle)
	hwnd, _, _ := procFindWindow.Call(0, uintptr(unsafe.Pointer(titlePtr)))
	return syscall.Handle(hwnd)
}

// DisableClickThrough makes the window click-through.
func DisableClickThrough(hwnd syscall.Handle) {
	if hwnd == 0 {
		return
	}
	gwlExStyle := uintptr(GWL_EXSTYLE)
	style, _, _ := procGetWindowLong.Call(uintptr(hwnd), gwlExStyle)
	style = style &^ WS_EX_TRANSPARENT
	procSetWindowLong.Call(uintptr(hwnd), gwlExStyle, style)
}

// EnableClickThrough makes the window click-through.
func EnableClickThrough(hwnd syscall.Handle) {
	if hwnd == 0 {
		return
	}
	gwlExStyle := uintptr(GWL_EXSTYLE)
	style, _, _ := procGetWindowLong.Call(uintptr(hwnd), gwlExStyle)
	style = style | WS_EX_TRANSPARENT
	procSetWindowLong.Call(uintptr(hwnd), gwlExStyle, style)
}

// MakeNonActivating makes the window not steal focus interactively.
func MakeNonActivating(hwnd syscall.Handle) {
	if hwnd == 0 {
		return
	}
	gwlExStyle := uintptr(GWL_EXSTYLE)
	style, _, _ := procGetWindowLong.Call(uintptr(hwnd), gwlExStyle)
	style = style | WS_EX_NOACTIVATE
	procSetWindowLong.Call(uintptr(hwnd), gwlExStyle, style)
}

// SetWindowRegion makes only a specific rectangle of the window interactable and visible.
func SetWindowRegion(hwnd syscall.Handle, x, y, width, height int) {
	if hwnd == 0 {
		return
	}
	hrgn, _, _ := procCreateRectRgn.Call(uintptr(x), uintptr(y), uintptr(x+width), uintptr(y+height))
	procSetWindowRgn.Call(uintptr(hwnd), hrgn, 1)
}

// ClearWindowRegion removes the window region, restoring full window interactability.
func ClearWindowRegion(hwnd syscall.Handle) {
	if hwnd == 0 {
		return
	}
	// Passing 0 clears the region
	procSetWindowRgn.Call(uintptr(hwnd), 0, 1)
}

// SpanAllMonitors positions and resizes the window to cover the entire virtual screen (all monitors).
func SpanAllMonitors(hwnd syscall.Handle) {
	if hwnd == 0 {
		return
	}
	x, _, _ := procGetSystemMetrics.Call(SM_XVIRTUALSCREEN)
	y, _, _ := procGetSystemMetrics.Call(SM_YVIRTUALSCREEN)
	w, _, _ := procGetSystemMetrics.Call(SM_CXVIRTUALSCREEN)
	h, _, _ := procGetSystemMetrics.Call(SM_CYVIRTUALSCREEN)

	procSetWindowPos.Call(
		uintptr(hwnd),
		HWND_TOPMOST,
		x, y, w, h,
		SWP_NOACTIVATE|SWP_SHOWWINDOW,
	)
}

// SetWindowToRect positions the window at the given rectangle (used for single-monitor mode).
func SetWindowToRect(hwnd syscall.Handle, x, y, w, h int) {
	if hwnd == 0 {
		return
	}
	procSetWindowPos.Call(
		uintptr(hwnd),
		HWND_TOPMOST,
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		SWP_NOACTIVATE|SWP_SHOWWINDOW,
	)
}

// EnumerateMonitors returns info about all connected monitors using EnumDisplayMonitors.
func EnumerateMonitors() []MonitorInfo {
	var monitors []MonitorInfo
	idx := 0

	// The callback receives: hMonitor, hdcMonitor, lprcMonitor, dwData
	cb := syscall.NewCallback(func(hMonitor uintptr, hdcMonitor uintptr, lpRect uintptr, dwData uintptr) uintptr {
		var info MONITORINFOEX
		info.Size = uint32(unsafe.Sizeof(info))

		ret, _, _ := procGetMonitorInfo.Call(hMonitor, uintptr(unsafe.Pointer(&info)))
		if ret != 0 {
			deviceName := syscall.UTF16ToString(info.Device[:])
			mi := MonitorInfo{
				Index:     idx,
				Name:      fmt.Sprintf("모니터 %d (%s)", idx+1, deviceName),
				X:         int(info.Monitor.Left),
				Y:         int(info.Monitor.Top),
				Width:     int(info.Monitor.Right - info.Monitor.Left),
				Height:    int(info.Monitor.Bottom - info.Monitor.Top),
				IsPrimary: info.Flags&MONITORINFOF_PRIMARY != 0,
			}
			monitors = append(monitors, mi)
			idx++
		}
		return 1 // Continue enumeration
	})

	procEnumDisplayMonitors.Call(0, 0, cb, 0)
	return monitors
}

const (
	SRCCOPY        = 0x00CC0020
	BI_RGB         = 0
	DIB_RGB_COLORS = 0
)

// BITMAPINFOHEADER for GetDIBits
type BITMAPINFOHEADER struct {
	BiSize          uint32
	BiWidth         int32
	BiHeight        int32
	BiPlanes        uint16
	BiBitCount      uint16
	BiCompression   uint32
	BiSizeImage     uint32
	BiXPelsPerMeter int32
	BiYPelsPerMeter int32
	BiClrUsed       uint32
	BiClrImportant  uint32
}

// CaptureScreenBase64 captures the virtual screen and returns it as a base64 PNG data URL.
func CaptureScreenBase64() (string, error) {
	// Get virtual screen bounds (all monitors)
	x, _, _ := procGetSystemMetrics.Call(SM_XVIRTUALSCREEN)
	y, _, _ := procGetSystemMetrics.Call(SM_YVIRTUALSCREEN)
	w, _, _ := procGetSystemMetrics.Call(SM_CXVIRTUALSCREEN)
	h, _, _ := procGetSystemMetrics.Call(SM_CYVIRTUALSCREEN)

	width := int(w)
	height := int(h)

	if width <= 0 || height <= 0 {
		return "", fmt.Errorf("invalid screen dimensions: %dx%d", width, height)
	}

	// Get desktop DC
	hdcScreen, _, _ := procGetDC.Call(0)
	if hdcScreen == 0 {
		return "", fmt.Errorf("GetDC failed")
	}
	defer procReleaseDC.Call(0, hdcScreen)

	// Create compatible DC and bitmap
	hdcMem, _, _ := procCreateCompatibleDC.Call(hdcScreen)
	if hdcMem == 0 {
		return "", fmt.Errorf("CreateCompatibleDC failed")
	}
	defer procDeleteDC.Call(hdcMem)

	hBitmap, _, _ := procCreateCompatibleBmp.Call(hdcScreen, w, h)
	if hBitmap == 0 {
		return "", fmt.Errorf("CreateCompatibleBitmap failed")
	}
	defer procDeleteObject.Call(hBitmap)

	// Select bitmap into memory DC
	procSelectObject.Call(hdcMem, hBitmap)

	// BitBlt from screen to memory DC
	ret, _, _ := procBitBlt.Call(hdcMem, 0, 0, w, h, hdcScreen, x, y, SRCCOPY)
	if ret == 0 {
		return "", fmt.Errorf("BitBlt failed")
	}

	// Get pixel data via GetDIBits
	bmi := BITMAPINFOHEADER{
		BiSize:        uint32(unsafe.Sizeof(BITMAPINFOHEADER{})),
		BiWidth:       int32(width),
		BiHeight:      -int32(height), // Negative = top-down
		BiPlanes:      1,
		BiBitCount:    32,
		BiCompression: BI_RGB,
	}

	pixels := make([]byte, width*height*4)
	ret, _, _ = procGetDIBits.Call(
		hdcMem, hBitmap, 0, uintptr(height),
		uintptr(unsafe.Pointer(&pixels[0])),
		uintptr(unsafe.Pointer(&bmi)),
		DIB_RGB_COLORS,
	)
	if ret == 0 {
		return "", fmt.Errorf("GetDIBits failed")
	}

	// Convert BGRA to RGBA
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for i := 0; i < len(pixels); i += 4 {
		img.Pix[i+0] = pixels[i+2] // R (from B)
		img.Pix[i+1] = pixels[i+1] // G
		img.Pix[i+2] = pixels[i+0] // B (from R)
		img.Pix[i+3] = 255         // A (force opaque)
	}

	// Encode to PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", fmt.Errorf("PNG encode failed: %w", err)
	}

	// Return as base64 data URL
	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())
	return "data:image/png;base64," + b64, nil
}
