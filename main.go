package main

import (
	"embed"
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// Version is the current version of the application
const Version = "0.1.6"

func main() {
	// Single instance check using a named mutex
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	createMutex := kernel32.NewProc("CreateMutexW")
	mutexName := syscall.StringToUTF16Ptr("EduLinkerPen_SingleInstance")
	_, _, mutexErr := createMutex.Call(0, 0, uintptr(unsafe.Pointer(mutexName)))
	if mutexErr != nil && mutexErr.(syscall.Errno) == 183 { // ERROR_ALREADY_EXISTS
		fmt.Println("EduLinker Pen is already running.")
		os.Exit(0)
	}

	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:            "edulinker-pen",
		Width:            1024,
		Height:           768,
		Frameless:        true,
		DisableResize:    true,
		AlwaysOnTop:      true,
		StartHidden:      true,
		WindowStartState: options.Fullscreen,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			DisableWindowIcon:    false,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
