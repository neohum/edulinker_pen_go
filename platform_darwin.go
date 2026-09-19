//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#import <objc/message.h>

static CGRect gClickRegion;
static BOOL gHasClickRegion = NO;

void SetMacClickRegion(int x, int y, int w, int h) {
    gClickRegion = CGRectMake(x, y, w, h);
    gHasClickRegion = YES;
}

void ClearMacClickRegion() {
    gHasClickRegion = NO;
}

void* GetMainWindow() {
    NSArray *windows = [NSApp windows];
    if ([windows count] > 0) {
        // Find the first visible window or just the first window.
        // Usually, index 0 is the main app window in Wails.
        for (NSWindow *win in windows) {
            if ([win isVisible]) {
                return (void *)win;
            }
        }
        return (void *)[windows objectAtIndex:0];
    }
    return NULL;
}

void SetIgnoresMouseEvents(void *nsWindow, bool ignore) {
    if (nsWindow != NULL) {
        dispatch_async(dispatch_get_main_queue(), ^{
            NSWindow *win = (NSWindow *)nsWindow;
            [win setIgnoresMouseEvents:ignore];
        });
    }
}

void SetMacWindowOverlayEx(void *nsWindow, int screenIndex) {
    if (nsWindow != NULL) {
        dispatch_async(dispatch_get_main_queue(), ^{
            NSWindow *win = (NSWindow *)nsWindow;
            [win setStyleMask:NSWindowStyleMaskBorderless];
            [win setBackgroundColor:[NSColor clearColor]];
            [win setOpaque:NO];
            [win setHasShadow:NO];
            
            // Overlap everything including the dock and menu bar
            [win setLevel:NSScreenSaverWindowLevel];
			
			// Setup NSTimer to dynamically toggle ignoresMouseEvents based on mouse location
            NSTimer *timer = [NSTimer scheduledTimerWithTimeInterval:0.05 repeats:YES block:^(NSTimer * _Nonnull timer) {
                if (!gHasClickRegion) {
                    [win setIgnoresMouseEvents:NO];
                    return;
                }
                
                NSPoint mouseLoc = [NSEvent mouseLocation];
                NSRect windowFrame = [win frame];
                NSPoint winPoint = NSMakePoint(mouseLoc.x - windowFrame.origin.x, mouseLoc.y - windowFrame.origin.y);
                
                CGFloat webY = windowFrame.size.height - winPoint.y;
                CGFloat webX = winPoint.x;
                
                // Add a small 10px padding for comfort
                BOOL insideRegion = NO;
                if (webX >= gClickRegion.origin.x - 10 && webX <= gClickRegion.origin.x + gClickRegion.size.width + 10 &&
                    webY >= gClickRegion.origin.y - 10 && webY <= gClickRegion.origin.y + gClickRegion.size.height + 10) {
                    insideRegion = YES;
                }
                
                BOOL isDragging = ([NSEvent pressedMouseButtons] & 1) != 0;
                
                // If the user is actively dragging (left button held down),
                // we MUST NOT change the window to ignoresMouseEvents:YES,
                // otherwise the drag will be abruptly cancelled by the OS.
                if (isDragging) {
                    if (![win ignoresMouseEvents]) {
                        // Keep intercepting mouse events to allow drag to complete
                        return;
                    }
                }
                
                [win setIgnoresMouseEvents:!insideRegion];
            }];
            [[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];
			
			// Hack: ensure all views up to WKWebView are transparent
            NSView *contentView = [win contentView];
            if (contentView != nil) {
                // Wails 2 creates a structural hierarchy of NSViews.
                // We recursively set their backgrounds to clear.
                void (^__block makeClear)(NSView *view) = ^(NSView *view) {
                    if ([view respondsToSelector:@selector(setBackgroundColor:)]) {
                        [(id)view setBackgroundColor:[NSColor clearColor]];
                    }
                    // For WebKit/WKWebView, making it opaque = NO helps transparency
                    if ([view isKindOfClass:NSClassFromString(@"WKWebView")]) {
                        [(id)view setOpaque:NO];
                        [(id)view setBackgroundColor:[NSColor clearColor]];
                    }
                    for (NSView *sub in [view subviews]) {
                        makeClear(sub);
                    }
                };
                makeClear(contentView);
            }
            
            // Span all monitors correctly
            NSArray<NSScreen*> *screens = [NSScreen screens];
            NSRect frame = NSZeroRect;
            if (screenIndex == -1 || screenIndex >= [screens count]) {
                for (NSScreen *screen in screens) {
                    frame = NSUnionRect(frame, [screen frame]);
                }
            } else {
                frame = [[screens objectAtIndex:screenIndex] frame];
            }
            
            [win setFrame:frame display:YES];
        });
    }
}
*/
import "C"
import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/options"
)

// CheckSingleInstance ensures only one instance of the app runs on MacOS.
func CheckSingleInstance() {
	// macOS single instance is usually handled by LaunchServices/app bundle,
	// so we leave it as a no-op for the simple binary invocation.
}

// getHwnd for Mac returns a pointer to the NSWindow.
func getHwnd(windowTitle string) uintptr {
	return uintptr(C.GetMainWindow())
}

// DisableClickThrough makes the window click-through.
func DisableClickThrough(hwnd uintptr) {
	if hwnd != 0 {
		C.SetIgnoresMouseEvents(unsafe.Pointer(hwnd), false)
	}
}

// EnableClickThrough makes the window click-through.
func EnableClickThrough(hwnd uintptr) {
	if hwnd != 0 {
		C.SetIgnoresMouseEvents(unsafe.Pointer(hwnd), true)
	}
}

// MakeNonActivating makes the window not steal focus interactively.
func MakeNonActivating(hwnd uintptr) {
	// macOS windows can be set to non-activating via Wails Mac.Options, or left as-is.
}

// SetWindowRegion makes only a specific rectangle of the window interactable and visible.
func SetWindowRegion(hwnd uintptr, x, y, width, height int) {
	if hwnd != 0 {
		C.SetMacClickRegion(C.int(x), C.int(y), C.int(width), C.int(height))
	}
}

// ClearWindowRegion removes the window region, restoring full window interactability.
func ClearWindowRegion(hwnd uintptr) {
	if hwnd != 0 {
		C.ClearMacClickRegion()
	}
}

// SpanAllMonitors positions and resizes the window to cover the entire virtual screen.
func SpanAllMonitors(hwnd uintptr) {
	if hwnd != 0 {
		C.SetMacWindowOverlayEx(unsafe.Pointer(hwnd), C.int(-1))
	}
}

// SetWindowToRect positions the window at the given rectangle.
func SetWindowToRect(hwnd uintptr, x, y, w, h int) {
	if hwnd != 0 {
		// On Mac, EnumerateMonitors is currently mocked to index 0, so we just attach to the primary screen.
		C.SetMacWindowOverlayEx(unsafe.Pointer(hwnd), C.int(0))
	}
}

// EnumerateMonitors returns info about all connected monitors.
func EnumerateMonitors() []MonitorInfo {
	return []MonitorInfo{
		{
			Index:     0,
			Name:      "Main Display",
			X:         0,
			Y:         0,
			Width:     1920,
			Height:    1080,
			IsPrimary: true,
		},
	}
}

// CaptureScreenBase64 captures the virtual screen and returns it as a base64 PNG data URL.
func CaptureScreenBase64() (string, error) {
	tmpPath := "/tmp/edulinker_pen_screen.png"
	// Capture all displays silently with no cursor
	cmd := exec.Command("screencapture", "-x", "-C", tmpPath)
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("screencapture failed: %w", err)
	}
	defer os.Remove(tmpPath)

	data, err := os.ReadFile(tmpPath)
	if err != nil {
		return "", fmt.Errorf("failed to read screenshot: %w", err)
	}

	b64 := base64.StdEncoding.EncodeToString(data)
	return "data:image/png;base64," + b64, nil
}

// SetupSystemTray initializes the system tray on Mac.
func SetupSystemTray(a *App) {
	// No-op on macOS to prevent SIGTRAP with Wails' own native application menu loop.
}

// ConfigurePlatformOptions allows OS-specific Wails options.
func ConfigurePlatformOptions(opts *options.App) {
	// Disable Wails' native fullscreen on macOS which creates a black-background space
	// and breaks transparent overlays.
	opts.WindowStartState = options.Normal
}

// RunPlatformBackgroundTasks triggers OS-specific background workers on Wails startup.
func RunPlatformBackgroundTasks(a *App) {
	// No background update tasks for macOS currently.
}
