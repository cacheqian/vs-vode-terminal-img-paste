$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$limit = 20 * 1024 * 1024
function Reply-Error([string]$code) {
    [Console]::Out.Write((@{ ok = $false; code = $code } | ConvertTo-Json -Compress))
}
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    # Keep one data object for this request; never poll the clipboard in the background.
    $snapshot = [System.Windows.Forms.Clipboard]::GetDataObject()
    if ($null -eq $snapshot) { Reply-Error 'NO_IMAGE'; exit 0 }
    $bytes = $null
    if ($snapshot.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
        $files = @($snapshot.GetData([System.Windows.Forms.DataFormats]::FileDrop))
        if ($files.Count -ne 1) { Reply-Error 'MULTIPLE_FILES'; exit 0 }
        $extension = [System.IO.Path]::GetExtension($files[0]).ToLowerInvariant()
        if ($extension -notin @('.png', '.jpg', '.jpeg', '.webp')) { Reply-Error 'UNSUPPORTED'; exit 0 }
        $stream = $null
        $memory = $null
        try {
            $stream = [System.IO.File]::Open($files[0], [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
            if ($stream.Length -gt $limit) { Reply-Error 'TOO_LARGE'; exit 0 }
            $memory = New-Object System.IO.MemoryStream
            $buffer = New-Object byte[] 65536
            while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                if (($memory.Length + $count) -gt $limit) { Reply-Error 'TOO_LARGE'; exit 0 }
                $memory.Write($buffer, 0, $count)
            }
            $bytes = $memory.ToArray()
        } catch { Reply-Error 'FILE_UNREADABLE'; exit 0 }
        finally {
            if ($null -ne $stream) { $stream.Dispose() }
            if ($null -ne $memory) { $memory.Dispose() }
        }
    } elseif ($snapshot.GetDataPresent([System.Windows.Forms.DataFormats]::Bitmap)) {
        $image = $snapshot.GetData([System.Windows.Forms.DataFormats]::Bitmap)
        if ($null -eq $image) { Reply-Error 'NO_IMAGE'; exit 0 }
        $memory = $null
        try {
            if (([long]$image.Width * [long]$image.Height) -gt 25000000) { Reply-Error 'TOO_MANY_PIXELS'; exit 0 }
            $memory = New-Object System.IO.MemoryStream
            $image.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
            if ($memory.Length -gt $limit) { Reply-Error 'TOO_LARGE'; exit 0 }
            $bytes = $memory.ToArray()
        } finally {
            $image.Dispose()
            if ($null -ne $memory) { $memory.Dispose() }
        }
    } else { Reply-Error 'NO_IMAGE'; exit 0 }
    [Console]::Out.Write((@{ ok = $true; data = [Convert]::ToBase64String($bytes) } | ConvertTo-Json -Compress))
} catch { Reply-Error 'CLIPBOARD_FAILED'; exit 0 }
