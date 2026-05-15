//go:build windows

package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
)

// Where the C# helper exe is found, in order of preference:
//  1. Same directory as the main app exe (production install via NSIS)
//  2. A dev path relative to the project root (when running via `wails dev`)
//
// The helper is built with `dotnet publish -c Release` in tools/inkrecognize/.
const inkExeName = "inkrecognize.exe"

var inkExeRelDevPaths = []string{
	filepath.Join("tools", "inkrecognize", "bin", "Release",
		"net8.0-windows10.0.19041.0", "win-x64", "publish", inkExeName),
}

var (
	inkExePath  string
	inkExeOnce  sync.Once
	inkExeError error
)

// findInkExe locates the WinRT-based handwriting helper, caching the result.
func findInkExe() (string, error) {
	inkExeOnce.Do(func() {
		// 1) Next to the running app exe (production).
		if main, err := os.Executable(); err == nil {
			candidate := filepath.Join(filepath.Dir(main), inkExeName)
			if fileExists(candidate) {
				inkExePath = candidate
				return
			}
		}
		// 2) Dev paths relative to the current working directory.
		for _, rel := range inkExeRelDevPaths {
			if fileExists(rel) {
				abs, err := filepath.Abs(rel)
				if err == nil {
					inkExePath = abs
					return
				}
				inkExePath = rel
				return
			}
		}
		inkExeError = fmt.Errorf(
			"%s not found. Build it first:\n  cd tools\\inkrecognize && dotnet publish -c Release",
			inkExeName)
	})
	return inkExePath, inkExeError
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

// RecognizeInkRaw spawns the C# helper exe and returns its JSON output verbatim.
// strokesJSON: [{ "points":[{"x":..,"y":..}, ...] }, ...]
// langHint:   BCP-47 language tag (e.g., "ko-KR", "en-US"). Empty = system default.
//             Used to pick a specific recognizer when multiple are installed.
func RecognizeInkRaw(strokesJSON string, langHint string) (string, error) {
	exe, err := findInkExe()
	if err != nil {
		return "", err
	}

	args := []string{}
	if langHint != "" {
		args = append(args, "--lang", langHint)
	}
	cmd := exec.Command(exe, args...)
	cmd.Stdin = strings.NewReader(strokesJSON)
	// CREATE_NO_WINDOW (0x08000000) prevents a console flash from the helper.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("ink recognition failed: %s", msg)
	}

	out := strings.TrimSpace(stdout.String())
	if out == "" {
		return "", fmt.Errorf("recognizer returned empty output")
	}
	return out, nil
}

// runInkDiagnose invokes the helper with --diagnose to list installed recognizers.
func runInkDiagnose(exe string) (string, error) {
	cmd := exec.Command(exe, "--diagnose")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return stdout.String(), fmt.Errorf("diagnose failed: %s", msg)
	}
	return strings.TrimSpace(stdout.String()), nil
}
