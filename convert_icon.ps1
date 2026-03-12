Add-Type -AssemblyName System.Drawing

$srcPath = "d:\works\edulinker-pen-go\frontend\src\assets\images\pen.png"
$dstPath = "d:\works\edulinker-pen-go\build\windows\icon.ico"

# Load the source image
$srcBmp = New-Object System.Drawing.Bitmap($srcPath)

# Create multiple sizes for proper ICO
$sizes = @(16, 32, 48, 256)
$pngStreams = @()

foreach ($size in $sizes) {
    $resized = New-Object System.Drawing.Bitmap($srcBmp, $size, $size)
    $ms = New-Object System.IO.MemoryStream
    $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngStreams += , @($size, $ms.ToArray())
    $ms.Dispose()
    $resized.Dispose()
}

$srcBmp.Dispose()

# Build ICO file manually
$fs = New-Object System.IO.FileStream($dstPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICO Header: Reserved(2) + Type(2) + Count(2)
$bw.Write([uint16]0)       # Reserved
$bw.Write([uint16]1)       # Type: 1 = ICO
$bw.Write([uint16]$sizes.Count)  # Number of images

# Calculate data offset (header=6, each entry=16)
$dataOffset = 6 + (16 * $sizes.Count)

# Write directory entries
foreach ($entry in $pngStreams) {
    $size = $entry[0]
    $pngData = $entry[1]
    
    $w = if ($size -ge 256) { 0 } else { [byte]$size }
    $h = if ($size -ge 256) { 0 } else { [byte]$size }
    
    $bw.Write([byte]$w)          # Width
    $bw.Write([byte]$h)          # Height
    $bw.Write([byte]0)           # Color palette
    $bw.Write([byte]0)           # Reserved
    $bw.Write([uint16]1)         # Color planes
    $bw.Write([uint16]32)        # Bits per pixel
    $bw.Write([uint32]$pngData.Length)  # Size of image data
    $bw.Write([uint32]$dataOffset)     # Offset to image data
    
    $dataOffset += $pngData.Length
}

# Write image data
foreach ($entry in $pngStreams) {
    $pngData = $entry[1]
    $bw.Write($pngData)
}

$bw.Close()
$fs.Close()

Write-Host "Multi-resolution ICO file created successfully ($($sizes -join ', ')px)"
