# Export only a committed prototype revision; local credentials are never copied.
param(
  [Parameter(Mandatory = $true)]
  [string]$StagePath,
  [string]$SourceRef = "HEAD"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath $StagePath) {
  throw "Staging path already exists; choose a new empty destination: $StagePath"
}
$commit = git -C $repo rev-parse --verify "$($SourceRef)^{commit}"
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve source revision: $SourceRef" }
$notices = @{}
foreach ($name in @("LICENSE", "THIRD_PARTY_NOTICES.md")) {
  $contents = git -C $repo show "$($commit):$name"
  if ($LASTEXITCODE -ne 0) { throw "Source revision is missing required notice: $name" }
  $notices[$name] = $contents
}
$archive = Join-Path ([System.IO.Path]::GetTempPath()) ("openround-" + [guid]::NewGuid() + ".zip")
try {
  git -C $repo archive --format=zip --output=$archive "$($commit):prototypes/openround-iphone"
  if ($LASTEXITCODE -ne 0) { throw "Could not export the committed prototype" }
  Expand-Archive -LiteralPath $archive -DestinationPath $StagePath
  foreach ($name in $notices.Keys) {
    $notices[$name] | Set-Content -LiteralPath (Join-Path $StagePath $name) -Encoding utf8
  }
  Write-Output "source=$commit stage=$StagePath"
  Write-Output "Only committed source was exported. Review it before publication."
} finally {
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
}
