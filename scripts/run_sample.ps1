$csv = Import-Csv 'C:\Users\patel\Downloads\monthly_horoscope_1728_combinations_Copy.csv'
$baseline = Import-Csv 'C:\Users\patel\Downloads\b.csv'
$out = @()
$limit = [Math]::Min(10, $csv.Count)
for ($i = 0; $i -lt $limit; $i++) {
  $r = $csv[$i]
  $url = "https://stagingapi.astroapi.com/api/v1/prediction/monthly?language=$($r.language)&month=$($r.month)&year=$($r.year)&report=$($r.report)&zodiac=$($r.zodiac)"
  Write-Host "[$($r.test_case_id)] GET $url"
  $resp = & curl.exe -sS -H 'x-api-key: iVf8NMjXY7Jmb8pjfKG75gumhnjVKvmasH8cEEt2' $url
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: curl failed (exit $LASTEXITCODE)"
    continue
  }
  try {
    $json = $resp | ConvertFrom-Json
  } catch {
    Write-Host "  ERROR: Response not JSON"
    continue
  }
  $prediction = if ($json -is [System.Array]) { $json[0].prediction } else { $json.prediction }
  $predShort = ($prediction -replace '\s+', ' ')
  if ($predShort.Length -gt 200) { $predShort = $predShort.Substring(0,200) + '...' }

  # Try to find baseline by expected_csv_key
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

  $obj = [PSCustomObject]@{
    test_case_id = $r.test_case_id
    url = $url
    status = '200'
    prediction = $predShort
    expected = ($expected -replace '\s+', ' ')
    result = $result
  }
  $out += $obj
  Write-Host "  status: OK, result: $result"
  Start-Sleep -Milliseconds 500
}
$out | Format-Table -AutoSize
$out | Export-Csv -Path 'C:\Users\patel\Downloads\qa_sample_results.csv' -NoTypeInformation -Force
Write-Host 'Saved results to C:\Users\patel\Downloads\qa_sample_results.csv'