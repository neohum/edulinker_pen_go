// Windows Ink handwriting recognition helper.
// Reads stroke JSON from stdin: [{ "points":[{"x":..,"y":..}, ...] }, ...]
// Stdout (success): { "candidates":["a","b",...], "recognizers":[...], "x":..,"y":..,"w":..,"h":.. }
//   - Runs EVERY installed handwriting recognizer in parallel and merges their
//     top candidates. So users with both Korean and English recognizers
//     installed get both sets of suggestions automatically — they just pick
//     the chip that matches what they wrote.
//   - candidates[0] is the auto-applied guess; the rest are alternatives for
//     the UI chip picker so the user can correct misrecognitions in one click.
// Stderr / exit 1: human-readable error.
//
// Uses Windows.UI.Input.Inking.InkRecognizerContainer (text-only recognition,
// returns ranked alternatives) instead of InkAnalyzer (layout + text).
// InkRecognizerContainer is bundled with every Windows 10 (1607+) and 11.
//
// Args:
//   --diagnose        prints recognizer info to stdout (no stdin needed)
//   --lang ko-KR      preferred language (BCP-47); its top candidate is the
//                     auto-applied one. Others go into the picker.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.UI.Input.Inking;

namespace InkRecognize;

internal static class Program
{
    private sealed class StrokePoint { public double x { get; set; } public double y { get; set; } public long timestamp { get; set; } }
    private sealed class InputStroke { public StrokePoint[]? points { get; set; } }
    private sealed class Output
    {
        public string text { get; set; } = "";
        public string[] candidates { get; set; } = Array.Empty<string>();
        public string[] recognizers { get; set; } = Array.Empty<string>();
        public double x { get; set; }
        public double y { get; set; }
        public double w { get; set; }
        public double h { get; set; }
    }

    // Per-recognizer set of top candidates with the recognizer name.
    private sealed record RecognizerOutput(string Name, List<string> Candidates);
    private sealed record RecognizedSegment(InkRecognitionResult Result, Rect Bounds);

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        try
        {
            return MainAsync(args).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static async Task<int> MainAsync(string[] args)
    {
        string? langHint = null;
        bool diagnose = false;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--diagnose") diagnose = true;
            else if (args[i] == "--lang" && i + 1 < args.Length) { langHint = args[i + 1]; i++; }
        }

        var container = new InkRecognizerContainer();
        var recognizers = container.GetRecognizers();

        if (diagnose)
        {
            Console.Out.WriteLine("Installed handwriting recognizers:");
            foreach (var r in recognizers)
            {
                Console.Out.WriteLine($"  - {r.Name}");
            }
            if (recognizers.Count == 0)
            {
                Console.Out.WriteLine("  (none — install handwriting language packs in Windows Settings → Time & Language → Language → [language] → Options → Hand-writing)");
            }
            return 0;
        }

        if (recognizers.Count == 0)
        {
            Console.Error.WriteLine(
                "No handwriting recognizer installed. Open Windows Settings → Time & Language → " +
                "Language → 한국어 (or your language) → Options → Hand-writing → Download.");
            return 1;
        }

        // Identify the preferred recognizer (its top candidate gets auto-applied).
        // We still RUN every installed recognizer though, so users with both
        // Korean and English packs see suggestions from both.
        InkRecognizer? preferred = null;
        if (!string.IsNullOrEmpty(langHint))
        {
            string[] keywords = langHint.ToLowerInvariant() switch
            {
                "ko-kr" or "ko" => new[] { "한글", "한국", "korean", "ko-kr", "ko_kr" },
                "en-us" or "en" => new[] { "english", "영어", "en-us", "en_us" },
                "ja-jp" or "ja" => new[] { "japanese", "일본", "ja-jp" },
                "zh-cn" or "zh" => new[] { "chinese", "중국", "zh-cn" },
                _ => new[] { langHint.ToLowerInvariant() },
            };
            preferred = recognizers.FirstOrDefault(r =>
                keywords.Any(k => r.Name.ToLowerInvariant().Contains(k)));
        }
        preferred ??= recognizers[0];

        var inputJson = await Console.In.ReadToEndAsync();
        if (string.IsNullOrWhiteSpace(inputJson))
        {
            Console.Error.WriteLine("no stroke JSON on stdin");
            return 1;
        }

        var jsonOpts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        InputStroke[]? strokes;
        try
        {
            strokes = JsonSerializer.Deserialize<InputStroke[]>(inputJson, jsonOpts);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("invalid stroke JSON: " + ex.Message);
            return 1;
        }
        if (strokes == null || strokes.Length == 0)
        {
            Console.Error.WriteLine("no strokes provided");
            return 1;
        }

        // Pixel-space bbox for the caller to position the rendered text.
        double minX = double.MaxValue, minY = double.MaxValue;
        double maxX = double.MinValue, maxY = double.MinValue;
        int totalPts = 0;
        foreach (var s in strokes)
        {
            if (s.points == null) continue;
            foreach (var p in s.points)
            {
                totalPts++;
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
        }
        if (totalPts == 0)
        {
            Console.Error.WriteLine("no points in any stroke");
            return 1;
        }

        // Build InkStrokes via InkStrokeBuilder. Coordinates are in DIPs.
        var inkBuilder = new InkStrokeBuilder();
        var attr = new InkDrawingAttributes
        {
            Color = Windows.UI.Color.FromArgb(255, 0, 0, 0),
            Size = new Size(2, 2),
        };
        inkBuilder.SetDefaultDrawingAttributes(attr);

        var strokeContainer = new InkStrokeContainer();
        foreach (var s in strokes)
        {
            if (s.points == null || s.points.Length < 2) continue;
            var pts = new List<InkPoint>(s.points.Length);
            foreach (var p in s.points) {
                var inkPt = new InkPoint(new Point(p.x, p.y), 0.5f, 0.0f, 0.0f, (ulong)(p.timestamp * 1000));
                pts.Add(inkPt);
            }
            strokeContainer.AddStroke(inkBuilder.CreateStrokeFromInkPoints(pts, System.Numerics.Matrix3x2.Identity));
        }
        if (strokeContainer.GetStrokes().Count == 0)
        {
            Console.Error.WriteLine("all strokes had < 2 points");
            return 1;
        }

        // Run every installed recognizer in parallel. Each gets its own
        // InkRecognizerContainer (the container holds the default recognizer)
        // but they share the same InkStrokeContainer.
        const int candidatesPerRecognizer = 4;
        var perRecognizerTasks = recognizers.Select(async r =>
        {
            var rc = new InkRecognizerContainer();
            rc.SetDefaultRecognizer(r);
            try
            {
                var segs = await rc.RecognizeAsync(strokeContainer, InkRecognitionTarget.All);
                return new RecognizerOutput(r.Name, JoinSegmentCandidates(segs, candidatesPerRecognizer));
            }
            catch (Exception ex)
            {
                // Don't fail the whole call if one recognizer dies; just skip it.
                Console.Error.WriteLine($"[{r.Name}] {ex.Message}");
                return new RecognizerOutput(r.Name, new List<string>());
            }
        }).ToArray();

        var perRecognizer = await Task.WhenAll(perRecognizerTasks);

        // Merge candidates: preferred recognizer's results come first (so its
        // top candidate is auto-applied), then others. Deduplicate while
        // preserving order. Skip empty/whitespace-only entries.
        var merged = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var orderedRecognizers = perRecognizer
            .OrderByDescending(p => ReferenceEquals(FindRecognizerByName(recognizers, p.Name), preferred))
            .ToArray();

        foreach (var per in orderedRecognizers)
        {
            foreach (var c in per.Candidates)
            {
                AddCandidate(merged, seen, c);
            }
        }

        if (merged.Count == 0)
        {
            Console.Error.WriteLine("Recognizer returned no text candidates.");
            return 1;
        }

        var output = new Output
        {
            text = merged[0],
            candidates = merged.ToArray(),
            recognizers = orderedRecognizers.Select(p => p.Name).ToArray(),
            x = minX,
            y = minY,
            w = maxX - minX,
            h = maxY - minY,
        };
        Console.Out.WriteLine(JsonSerializer.Serialize(output));
        return 0;
    }

    // Take per-segment results from one recognizer and produce up to N joined
    // candidate strings. Segments that sit on different baselines are separated
    // with newlines so vertical arithmetic can be parsed by the frontend.
    private static List<string> JoinSegmentCandidates(IReadOnlyList<InkRecognitionResult> segs, int n)
    {
        var outList = new List<string>();
        var rows = GroupSegmentsByRow(segs);

        for (int alt = 0; alt < n; alt++)
        {
            var sb = new StringBuilder();
            bool any = false;
            foreach (var row in rows)
            {
                var rowText = new StringBuilder();
                foreach (var seg in row)
                {
                    var cands = seg.Result.GetTextCandidates();
                    if (cands.Count == 0) continue;
                    int idx = Math.Min(alt, cands.Count - 1);
                    if (rowText.Length > 0) rowText.Append(' ');
                    rowText.Append(cands[idx]);
                    any = true;
                }
                if (rowText.Length == 0) continue;
                if (sb.Length > 0) sb.Append('\n');
                sb.Append(rowText);
            }
            if (!any) break;
            AddCandidate(outList, new HashSet<string>(outList, StringComparer.Ordinal), sb.ToString());
        }
        return outList;
    }

    private static List<List<RecognizedSegment>> GroupSegmentsByRow(IReadOnlyList<InkRecognitionResult> segs)
    {
        var sorted = segs
            .Select(seg => new RecognizedSegment(seg, seg.BoundingRect))
            .OrderBy(seg => seg.Bounds.Top)
            .ThenBy(seg => seg.Bounds.Left)
            .ToList();
        var rows = new List<List<RecognizedSegment>>();

        foreach (var seg in sorted)
        {
            var centerY = seg.Bounds.Top + seg.Bounds.Height / 2.0;
            List<RecognizedSegment>? target = null;
            foreach (var row in rows)
            {
                var rowTop = row.Min(s => s.Bounds.Top);
                var rowBottom = row.Max(s => s.Bounds.Bottom);
                var rowCenter = (rowTop + rowBottom) / 2.0;
                var tolerance = Math.Max(10, Math.Max(rowBottom - rowTop, seg.Bounds.Height) * 0.65);
                if (Math.Abs(centerY - rowCenter) <= tolerance)
                {
                    target = row;
                    break;
                }
            }

            if (target == null)
            {
                target = new List<RecognizedSegment>();
                rows.Add(target);
            }
            target.Add(seg);
        }

        foreach (var row in rows)
        {
            row.Sort((a, b) => a.Bounds.Left.CompareTo(b.Bounds.Left));
        }

        rows.Sort((a, b) => a.Min(s => s.Bounds.Top).CompareTo(b.Min(s => s.Bounds.Top)));
        return rows;
    }

    private static void AddCandidate(List<string> candidates, HashSet<string> seen, string candidate)
    {
        var trimmed = candidate.Trim();
        if (string.IsNullOrEmpty(trimmed)) return;

        var numeric = NormalizeNumericCandidate(trimmed);
        if (numeric != null && HasNumericPunctuation(trimmed) && seen.Add(numeric))
        {
            candidates.Add(numeric);
        }

        if (seen.Add(trimmed)) candidates.Add(trimmed);

        if (numeric != null && seen.Add(numeric)) candidates.Add(numeric);
    }

    private static bool HasNumericPunctuation(string candidate)
    {
        foreach (var ch in candidate)
        {
            switch (ch)
            {
                case ',':
                case '，':
                case '、':
                case '.':
                case '．':
                case '。':
                case '·':
                case 'ㆍ':
                    return true;
            }
        }
        return false;
    }

    private static string? NormalizeNumericCandidate(string candidate)
    {
        var sb = new StringBuilder();
        bool hasDigit = false;

        foreach (var ch in candidate)
        {
            if (char.IsWhiteSpace(ch)) continue;

            if (ch >= '０' && ch <= '９')
            {
                sb.Append((char)('0' + (ch - '０')));
                hasDigit = true;
                continue;
            }

            if (char.IsDigit(ch))
            {
                sb.Append(ch);
                hasDigit = true;
                continue;
            }

            switch (ch)
            {
                case ',':
                case '，':
                case '、':
                    sb.Append(',');
                    break;
                case '.':
                case '．':
                case '。':
                case '·':
                case 'ㆍ':
                    sb.Append('.');
                    break;
                case '-':
                case '−':
                    sb.Append('-');
                    break;
                case '+':
                    sb.Append('+');
                    break;
                default:
                    return null;
            }
        }

        var normalized = sb.ToString();
        if (!hasDigit || normalized.Length == 0 || normalized == candidate) return null;
        return normalized;
    }

    private static InkRecognizer? FindRecognizerByName(IReadOnlyList<InkRecognizer> recs, string name)
    {
        foreach (var r in recs) if (r.Name == name) return r;
        return null;
    }
}
