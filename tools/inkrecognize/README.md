# inkrecognize

Self-contained handwriting recognition helper called by the main app.

Uses the modern Windows Ink Platform (WinRT `Windows.UI.Input.Inking.Analysis`),
which is part of every Windows 10 (1607+) and Windows 11 installation. No
optional Tablet PC components are required.

For Korean recognition, the user's machine still needs the Korean handwriting
language pack (Settings → Time & Language → Language → 한국어 → Options →
Hand-writing → Download). English is included with the base OS.

## Build

Requires the .NET 8 SDK.

```cmd
cd tools\inkrecognize
build.bat
```

Output: `bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\inkrecognize.exe`
(~89 MB, fully self-contained — no .NET runtime needed on the target machine).

The NSIS installer (`build\windows\installer\project.nsi`) bundles this exe
next to the main app exe via a `File` directive. Rebuild this helper before
producing a release installer.

## Protocol

- **stdin** (UTF-8 JSON): `[{ "points":[{"x":..,"y":..}, ...] }, ...]`
- **stdout** (success, single line): `{ "text":"...", "candidates":["..."], "recognizers":["..."], "x":..,"y":..,"w":..,"h":.. }`
- **stderr** (failure, exit 1): human-readable error message

Numeric candidates are normalized so handwritten thousand separators and
decimal points survive segmentation. For example, `1 , 234` is returned as
`1,234`, and `12 . 34` is returned as `12.34`.

Recognition segments on different baselines are separated with `\n` in the
candidate text. The frontend uses that layout hint to grade vertical arithmetic.
