package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// Version is the current version of the application
const Version = "0.1.0"

func main() {
	// Single instance check (cross-platform abstracted)
	CheckSingleInstance()

	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	opts := &options.App{
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
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                  true,
				HideTitleBar:               true,
				FullSizeContent:            true,
				UseToolbar:                 false,
				HideToolbarSeparator:       true,
			},
			WebviewIsTransparent: true,
			WindowIsTranslucent:  false, // MUST be false for absolute transparency (without frosted glass blur)
			About: &mac.AboutInfo{
				Title:   "edulinker-pen",
				Message: "EduLinker Pen",
			},
			Appearance:           mac.NSAppearanceNameDarkAqua,
		},
		Debug: options.Debug{
			OpenInspectorOnStartup: true,
		},
	}

	ConfigurePlatformOptions(opts)

	err := wails.Run(opts)

	if err != nil {
		println("Error:", err.Error())
	}
}
