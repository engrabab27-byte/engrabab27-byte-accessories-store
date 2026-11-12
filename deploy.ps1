[CmdletBinding()]
param(
    [string]$Message = "Publish site update"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($gitCommand) {
    $git = $gitCommand.Source
} else {
    $git = Join-Path $env:ProgramFiles "Git\cmd\git.exe"
    if (-not (Test-Path $git)) {
        throw "Git is not installed. Install Git for Windows, then run this script again."
    }
}

Push-Location $repositoryRoot
try {
    $origin = & $git remote get-url origin
    if ($LASTEXITCODE -ne 0) {
        throw "The origin remote is not configured."
    }
    $normalizedOrigin = $origin.Trim().TrimEnd("/")
    $normalizedOrigin = $normalizedOrigin -replace "\.git$", ""
    if ($normalizedOrigin -notin @(
        "https://github.com/engrabab27-byte/engrabab27-byte-accessories-store",
        "git@github.com:engrabab27-byte/engrabab27-byte-accessories-store"
    )) {
        throw "Refusing to publish: origin is not the permanent FEDAA STORE repository."
    }

    $branch = & $git branch --show-current
    if ($LASTEXITCODE -ne 0 -or $branch.Trim() -ne "main") {
        throw "Refusing to publish: switch to the main branch first."
    }

    & $git fetch origin main
    if ($LASTEXITCODE -ne 0) {
        throw "Could not fetch origin/main. Check your network and GitHub access."
    }
    & $git merge-base --is-ancestor origin/main HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "origin/main has new commits or the branch has diverged. Sync the branch before publishing."
    }

    & $git add -A
    if ($LASTEXITCODE -ne 0) {
        throw "Could not stage the site changes."
    }
    & $git -c "core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol" diff --cached --check
    if ($LASTEXITCODE -ne 0) {
        throw "The staged changes contain whitespace errors; review them before publishing."
    }
    & $git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        & $git commit -m $Message -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create the deployment commit."
        }
    }

    $commitsToPublish = & $git rev-list --count origin/main..HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "Could not determine whether local commits need publishing."
    }
    if ([int]$commitsToPublish -eq 0) {
        Write-Output "There are no changes or commits to publish."
        return
    }

    & $git push --set-upstream origin main
    if ($LASTEXITCODE -ne 0) {
        throw "Push failed. Authenticate with GitHub or resolve the reported issue, then run this script again."
    }

    Write-Output "Published to https://engrabab27-byte.github.io/engrabab27-byte-accessories-store/"
} finally {
    Pop-Location
}
