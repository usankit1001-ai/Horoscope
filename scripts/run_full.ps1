# Run full QA suite against staging API
# Throttle: 1 req/sec
# Retries: 3 attempts, 2000ms between attempts

$csvPath = 'C:\Users\patel\Downloads\monthly_horoscope_1728_combinations_Copy.csv'
$baselinePath = 'C:\Users\patel\Downloads\b.csv'
$outPath = 'C:\Users\patel\Downloads\qa_full_results.csv'

$csv = Import-Csv $csvPath
$baseline = Import-Csv $baselinePath

$results = @()
$TOTAL = $csv.Count
$idx = 0

$MAX_ATTEMPTS = 3
$ATTEMPT_DELAY_MS = 2000
$THROTTLE_MS = 1000

Write-Host "Starting full run: $TOTAL tests. Throttle: 1 req/sec, Max attempts: $MAX_ATTEMPTS"

foreach ($r in $csv) {
  $idx++
  $testId = $r.test_case_id
  $url = "https://stagingapi.astroapi.com/api/v1/prediction/monthly?language=$($r.language)&month=$($r.month)&year=$($r.year)&report=$($r.report)&zodiac=$($r.zodiac)"
  Write-Host "[$idx/$TOTAL] $testId -> $url"

  $attempt = 0
  $lastStatus = 'ERR'
  $lastBody = ''
  $success = $false

  while ($attempt -lt $MAX_ATTEMPTS -and -not $success) {
    $attempt++
    $respRaw = & curl.exe -sS -i -H 'x-api-key: iVf8NMjXY7Jmb8pjfKG75gumhnjVKvmasH8cEEt2' $url
    if ($LASTEXITCODE -ne 0 -or -not $respRaw) {
      Write-Host "  Attempt ${attempt}: curl failed (exit ${LASTEXITCODE})"
      if ($attempt -lt $MAX_ATTEMPTS) { Start-Sleep -Milliseconds $ATTEMPT_DELAY_MS }
      continue
    }

    # Parse status
    $firstLine = ($respRaw -split "`n")[0].Trim()
    if ($firstLine -match 'HTTP/\d+\.\d+\s+(\d+)') { $lastStatus = $Matches[1] } else { $lastStatus = 'ERR' }
    $lastBody = ($respRaw -split "`n")[-1]

    if ($lastStatus -eq '200' -and $lastBody -and $lastBody.Trim() -ne '') {
      $success = $true
      break
    } else {
      Write-Host "  Attempt ${attempt}: status=${lastStatus} -- retrying..."
      if ($attempt -lt $MAX_ATTEMPTS) { Start-Sleep -Milliseconds $ATTEMPT_DELAY_MS }
    }
  }

  # Extract prediction
  $prediction = ''
  try {
    $json = $lastBody | ConvertFrom-Json
    if ($json -is [System.Array]) { $prediction = $json[0].prediction } else { $prediction = $json.prediction }
  } catch {
    $prediction = ''
  }

  # Baseline lookup
  $expected = ''
  if ($r.expected_csv_key) {
    $parts = $r.expected_csv_key -split '_'
    if ($parts.Count -ge 3) {
      $expYear = $parts[1]
      $expMonth = $parts[2]
      $monthStr = "${expMonth}-${expYear}"
      $found = $baseline | Where-Object { ($_.month -eq $monthStr) -and ($_.zodiac_name -ieq $parts[0]) }
      if ($found) { $expected = $found[0].description }
    }
  }

  $result = 'NO_BASELINE'
  if ($expected -ne '') {
    if ($prediction -and $prediction -ne '') {
      if ($prediction.ToLower().Contains(($expected -replace '"','').ToLower())) { $result = 'PASSED' } else { $result = 'FAILED' }
    } else { $result = 'FAILED' }
  }

  $predShort = ($prediction -replace '\s+', ' ')
  if ($predShort.Length -gt 300) { $predShort = $predShort.Substring(0,300) + '...' }

  $results += [PSCustomObject]@{
    test_case_id = $testId
    index = $idx
    url = $url
    attempts = $attempt
    status = $lastStatus
    prediction = $predShort
    expected = ($expected -replace '\s+', ' ')
    result = $result
    timestamp = (Get-Date).ToString('o')
  }

  if (($idx % 50) -eq 0) { Write-Host "  Progress: $idx / $TOTAL" }

  Start-Sleep -Milliseconds $THROTTLE_MS
}

# Save results
$results | Export-Csv -Path $outPath -NoTypeInformation -Force

# Summary
$passed = ($results | Where-Object { $_.result -eq 'PASSED' }).Count
$failed = ($results | Where-Object { $_.result -eq 'FAILED' }).Count
$nobaseline = ($results | Where-Object { $_.result -eq 'NO_BASELINE' }).Count
Write-Host "Run complete. Results saved to $outPath"
Write-Host "PASSED: $passed | FAILED: $failed | NO_BASELINE: $nobaseline | TOTAL: $TOTAL"

