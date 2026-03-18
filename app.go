package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"io"
	"net/http"
	"os/exec"

	"github.com/blang/semver"
	"github.com/energye/systray"
	"github.com/google/go-github/v60/github"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// AppConfig stores persistent user settings.
type AppConfig struct {
	MonitorIndex   int    `json:"monitorIndex"` // -1 = all monitors, 0+ = specific monitor index
	updateFilePath string `json:"-"`            // Path to the downloaded installer, kept in memory only
}

// App struct
type App struct {
	ctx    context.Context
	hwnd   syscall.Handle
	config AppConfig
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// getConfigPath returns the path to the config JSON file in %APPDATA%.
func getConfigPath() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = "."
	}
	dir := filepath.Join(appData, "edulinker-pen")
	os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "config.json")
}

// loadConfig loads the config from disk. Returns false if no config exists (first run).
func (a *App) loadConfig() bool {
	data, err := os.ReadFile(getConfigPath())
	if err != nil {
		return false
	}
	if err := json.Unmarshal(data, &a.config); err != nil {
		return false
	}
	return true
}

// saveConfig writes the current config to disk.
func (a *App) saveConfig() error {
	data, err := json.MarshalIndent(a.config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(getConfigPath(), data, 0644)
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// The window might not be fully initialized or we need its title to grab it
	a.hwnd = getHwnd("edulinker-pen")

	// Initial state: Make non-activating
	MakeNonActivating(a.hwnd)

	// Check for updates in the background on startup
	go func() {
		// Initial check
		a.CheckForUpdate(false)

		// Set up a ticker to check every 6 hours
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()

		for {
			select {
			case <-a.ctx.Done():
				return // Context canceled, stop goroutine
			case <-ticker.C:
				a.CheckForUpdate(false)
			}
		}
	}()

	// Initialize System Tray
	go systray.Run(a.onSystrayReady, a.onSystrayExit)
}

// domReady is called when the frontend DOM is loaded (transparent CSS is active).
// We position the window here to avoid a white flash on startup.
func (a *App) domReady(ctx context.Context) {
	fmt.Println("[App] DOM ready, hwnd:", a.hwnd)

	// Load config and apply monitor setting (using Win32 only, not Wails runtime)
	if a.loadConfig() {
		fmt.Println("[App] Config loaded, applying")
		a.applyMonitorConfig()
	} else {
		// First run: span all monitors, UI will show setup dialog
		fmt.Println("[App] First run, spanning all monitors")
		SpanAllMonitors(a.hwnd)
	}

	// Now show the window — transparent CSS is loaded, position is set
	runtime.WindowShow(a.ctx)
}

// applyMonitorConfig positions the window based on the saved monitor config.
func (a *App) applyMonitorConfig() {
	fmt.Println("[App] Applying monitor config, index:", a.config.MonitorIndex)

	if a.config.MonitorIndex == -1 {
		// All monitors
		fmt.Println("[App] Spanning all monitors")
		SpanAllMonitors(a.hwnd)
	} else {
		monitors := EnumerateMonitors()
		for _, m := range monitors {
			if m.Index == a.config.MonitorIndex {
				fmt.Printf("[App] Setting window to monitor %d: %dx%d at (%d,%d)\n", m.Index, m.Width, m.Height, m.X, m.Y)
				SetWindowToRect(a.hwnd, m.X, m.Y, m.Width, m.Height)
				return
			}
		}
		// Fallback: if the saved monitor doesn't exist anymore
		fmt.Println("[App] Monitor not found, spanning all")
		SpanAllMonitors(a.hwnd)
	}
}

//go:embed build/windows/icon.ico
var trayIcon []byte

// CheckForUpdate looks for newer versions on GitHub and asks user if they want to update.
// manual: true if user clicked the menu item, false if automatic background check.
func (a *App) CheckForUpdate(manual bool) {
	owner := "neohum"
	repo := "edulinker_pen_go"

	fmt.Printf("[Update] Checking for updates on %s/%s... (Current: %s)\n", owner, repo, Version)

	client := github.NewClient(nil)
	release, _, err := client.Repositories.GetLatestRelease(context.Background(), owner, repo)
	if err != nil {
		fmt.Println("[Update] Error checking for update:", err)
		if manual {
			runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
				Type:    runtime.ErrorDialog,
				Title:   "Update Check Failed",
				Message: fmt.Sprintf("Failed to check for updates: %v", err),
			})
		}
		return
	}

	latestVersionStr := release.GetTagName()
	if latestVersionStr != "" && latestVersionStr[0] == 'v' {
		latestVersionStr = latestVersionStr[1:]
	}

	currentVer, err := semver.Make(Version)
	if err != nil {
		fmt.Println("[Update] Invalid current version format:", err)
		return
	}

	latestVer, err := semver.Make(latestVersionStr)
	if err != nil {
		fmt.Println("[Update] Invalid remote version format:", err)
		return
	}

	if latestVer.LTE(currentVer) {
		fmt.Println("[Update] App is already up-to-date")
		if manual {
			runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
				Type:    runtime.InfoDialog,
				Title:   "Up to Date",
				Message: fmt.Sprintf("You are already using the latest version (v%s).", Version),
			})
		}
		return
	}

	fmt.Printf("[Update] New version available: v%s\n", latestVer.String())

	// Emit event to frontend instead of prompting via MessageDialog
	runtime.EventsEmit(a.ctx, "update-status", map[string]string{
		"status":  "available",
		"version": latestVer.String(),
		"notes":   release.GetBody(),
	})

	// Automatically start downloading in background
	go a.downloadAndInstallUpdate(release)
}

func (a *App) downloadAndInstallUpdate(release *github.RepositoryRelease) {
	var installerAsset *github.ReleaseAsset
	for _, asset := range release.Assets {
		// Look for the installer specifically
		if filepath.Ext(asset.GetName()) == ".exe" {
			installerAsset = asset
			break // in our case, there is usually only one .exe asset
		}
	}

	if installerAsset == nil {
		runtime.EventsEmit(a.ctx, "update-status", map[string]string{
			"status": "error",
			"error":  "No installer executable found in the release.",
		})
		return
	}

	downloadUrl := installerAsset.GetBrowserDownloadURL()
	fmt.Printf("[Update] Downloading installer silently: %s\n", downloadUrl)

	runtime.EventsEmit(a.ctx, "update-status", map[string]string{
		"status": "downloading",
	})

	// Create temp file for the installer
	tempDir := os.TempDir()
	tempFilePath := filepath.Join(tempDir, assetName(installerAsset))

	// Download the installer in the background
	err := downloadFile(tempFilePath, downloadUrl)
	if err != nil {
		fmt.Printf("[Update] Error downloading installer: %v\n", err)
		runtime.EventsEmit(a.ctx, "update-status", map[string]string{
			"status": "error",
			"error":  fmt.Sprintf("Failed to download the update: %v", err),
		})
		return
	}

	fmt.Printf("[Update] Download complete: %s\n", tempFilePath)

	// Save the temp file path so the UI can trigger it later
	a.config.updateFilePath = tempFilePath

	// Notify frontend that update is ready to install silently
	runtime.EventsEmit(a.ctx, "update-status", map[string]string{
		"status": "ready",
	})
}

// InstallUpdate executes the previously downloaded update installer silently and restarts the app.
// It should be called from the frontend when the user clicks 'Restart to update'.
func (a *App) InstallUpdate() {
	if a.config.updateFilePath == "" {
		fmt.Println("[Update] No update file available to install.")
		return
	}

	fmt.Println("[Update] Launching silent installer...", a.config.updateFilePath)
	cmd := exec.Command(a.config.updateFilePath, "/S")
	err := cmd.Start()
	if err != nil {
		fmt.Printf("[Update] Failed to start silent installer: %v\n", err)
		runtime.EventsEmit(a.ctx, "update-status", map[string]string{
			"status": "error",
			"error":  fmt.Sprintf("Failed to launch the update installer: %v", err),
		})
		return
	}

	// Exit our application so the installer can overwrite the files
	os.Exit(0)
}

func assetName(asset *github.ReleaseAsset) string {
	if asset.Name != nil {
		return *asset.Name
	}
	return "edulinker-pen-setup.exe"
}

// downloadFile downloads a URL to a local file
func downloadFile(filepath string, url string) error {
	out, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer out.Close()

	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bad status: %s", resp.Status)
	}

	_, err = io.Copy(out, resp.Body)
	return err
}

func (a *App) onSystrayReady() {
	systray.SetIcon(trayIcon)
	systray.SetTooltip("Edulinker Pen")

	// Create menu items
	mUpdate := systray.AddMenuItem("Check for Updates...", "Check for new versions")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Exit edulinker-pen", "Quit the whole app")

	mQuit.Click(func() {
		systray.Quit()
		runtime.Quit(a.ctx)
	})

	mUpdate.Click(func() {
		fmt.Println("Check for update clicked")
		a.CheckForUpdate(true)
	})
}

func (a *App) onSystrayExit() {
	// Cleanup on exit
}

// EnableClickThrough makes the main window ignore mouse events.
func (a *App) EnableClickThrough() {
	if a.hwnd != 0 {
		EnableClickThrough(a.hwnd)
	}
}

// DisableClickThrough makes the main window catch mouse events.
func (a *App) DisableClickThrough() {
	if a.hwnd != 0 {
		DisableClickThrough(a.hwnd)
	}
}

// SetClickArea restricts the window's physical shape to the given rectangle.
func (a *App) SetClickArea(x, y, w, h int) {
	if a.hwnd != 0 {
		SetWindowRegion(a.hwnd, x, y, w, h)
	}
}

// ClearClickArea restores the window to full screen.
func (a *App) ClearClickArea() {
	if a.hwnd != 0 {
		ClearWindowRegion(a.hwnd)
	}
}

// GetMonitors returns all connected monitors as a JSON-friendly list.
func (a *App) GetMonitors() []MonitorInfo {
	return EnumerateMonitors()
}

// GetSavedMonitorIndex returns the saved monitor index (-1 = all, 0+ = specific).
// Returns -2 if no config exists yet (first run).
func (a *App) GetSavedMonitorIndex() int {
	if _, err := os.Stat(getConfigPath()); os.IsNotExist(err) {
		return -2 // Signal: first run, show setup
	}
	return a.config.MonitorIndex
}

// SetMonitor applies the given monitor selection and saves it.
// index: -1 = all monitors, 0+ = specific monitor index
func (a *App) SetMonitor(index int) {
	fmt.Println("[App] SetMonitor called with index:", index)
	a.config.MonitorIndex = index
	a.saveConfig()
	a.applyMonitorConfig()
}

// CaptureScreen hides the pen overlay, captures the screen, and returns a base64 PNG data URL.
func (a *App) CaptureScreen() (string, error) {
	fmt.Println("[App] CaptureScreen called")

	// Briefly hide our window so it doesn't appear in the capture
	runtime.WindowHide(a.ctx)

	// Small delay to let the window actually hide
	// (Win32 window operations are async)
	time.Sleep(200 * time.Millisecond)

	// Capture the screen
	dataURL, err := CaptureScreenBase64()

	// Re-show our window
	runtime.WindowShow(a.ctx)

	if err != nil {
		fmt.Println("[App] CaptureScreen error:", err)
		return "", err
	}

	fmt.Printf("[App] CaptureScreen success, data URL length: %d\n", len(dataURL))
	return dataURL, nil
}

// CloseApp closes the wails application.
func (a *App) CloseApp() {
	runtime.Quit(a.ctx)
}

// Greet returns a greeting for the given name (Keep for testing the bridge)
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// GetVersion returns the current version of the application
func (a *App) GetVersion() string {
	return Version
}
