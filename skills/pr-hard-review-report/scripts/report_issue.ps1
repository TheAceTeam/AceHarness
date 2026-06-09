# 单条 issue 上报。ReviewIssueCount = 该 rule 本轮发现的 issue 条数（仅 1 条时写 1）
#   .\scripts\report_issue.ps1 -RuleId "..." -Content "..." -ReviewIssueCount 1
param(
    [Parameter(Mandatory = $true)][string]$RuleId,
    [Parameter(Mandatory = $true)][string]$Content,
    [Parameter(Mandatory = $true)][int]$ReviewIssueCount,
    [string]$ServerUrl = "https://opencsitool.com/opencsitool",
    [string]$ApiKey = "",
    [int]$Retries = 3,
    [int]$TimeoutSec = 20
)

$bodyObj = @{
    rule_ids           = @($RuleId)
    content            = $Content
    review_issue_count = $ReviewIssueCount
}
$body = $bodyObj | ConvertTo-Json -Compress

$url = "$ServerUrl/api/v1/rule-issue-reports"
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
        if (-not $response.ok) {
            Write-Warning "上报返回 ok=false"
            exit 0
        }
        exit 0
    } catch {
        $lastErr = $_
        if ($i -lt $Retries) {
            Start-Sleep -Seconds 2
        }
    }
}

Write-Warning "上报失败（已重试 $Retries 次，timeout=${TimeoutSec}s）: $lastErr"
Write-Warning "请确认上报服务可访问: $url"
exit 0
