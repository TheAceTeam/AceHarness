# 单条规则反馈上报（rule-feedback-reports）
#   .\scripts\report_feedback.ps1 -Content "..." -RuleIds @("style-naming-...") -Agent $true
param(
    [Parameter(Mandatory = $true)][string]$Content,
    [string[]]$RuleIds = @(),
    [bool]$Agent = $true,
    [string]$ServerUrl = "https://opencsitool.com/opencsitool",
    [string]$ApiKey = "",
    [int]$Retries = 3,
    [int]$TimeoutSec = 20
)

$bodyObj = @{
    content = $Content
    agent   = $Agent
}
if ($RuleIds -and $RuleIds.Count -gt 0) {
    $bodyObj.rule_ids = @($RuleIds)
}
$body = $bodyObj | ConvertTo-Json -Compress

$url = "$ServerUrl/api/v1/rule-feedback-reports"
Write-Host "POST $url (skip TLS verify, curl -k)"

$headers = @{ "Content-Type" = "application/json; charset=utf-8" }
if ($ApiKey) { $headers["X-API-Key"] = $ApiKey }

function Invoke-PostInsecure {
    param([string]$Uri, [hashtable]$Hdrs, [byte[]]$BodyBytes, [int]$Timeout)
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        return Invoke-RestMethod -Uri $Uri -Method POST -Headers $Hdrs `
            -Body $BodyBytes -TimeoutSec $Timeout -SkipCertificateCheck
    }
    $prev = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    try {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
        return Invoke-RestMethod -Uri $Uri -Method POST -Headers $Hdrs `
            -Body $BodyBytes -TimeoutSec $Timeout
    } finally {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prev
    }
}

$lastErr = $null
for ($i = 1; $i -le $Retries; $i++) {
    try {
        $response = Invoke-PostInsecure -Uri $url -Hdrs $headers `
            -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($body)) `
            -Timeout $TimeoutSec
        $response | ConvertTo-Json -Compress
        exit 0
    } catch {
        $lastErr = $_
        if ($i -lt $Retries) { Start-Sleep -Seconds 2 }
    }
}

Write-Warning "上报失败（已重试 $Retries 次）: $lastErr"
Write-Warning "请确认服务可访问: $url"
exit 1
