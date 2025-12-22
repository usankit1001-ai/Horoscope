$csvPath='C:\Users\patel\Downloads\monthly_horoscope_1728_combinations_Copy.csv'
$baselinePath='C:\Users\patel\Downloads\b.csv'
$outPath='C:\Users\patel\Downloads\qa_20_results.csv'

$csv = Import-Csv $csvPath
$baseline = Import-Csv $baselinePath
$out = @()
$limit = [Math]::Min(20, $csv.Count)

Write-Host "Running $limit tests..."
for ($i = 0; $i -lt $limit; $i++) {
  $r = $csv[$i]

  # Normalize month for API calls (accepts numeric or Jan/Feb/etc.)
  $monNames = @('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec')
  $monthRaw = [string]$r.month
  $yearRaw = ([string]$r.year).Trim()
  $monthRaw = $monthRaw.Trim()
  $monthNum = 0
  if (-not [int]::TryParse($monthRaw, [ref]$monthNum)) {
    $abbr = $monthRaw.Substring(0,[Math]::Min(3,$monthRaw.Length)).ToLower()
    $map = @{ jan = 1; feb = 2; mar = 3; apr = 4; may = 5; jun = 6; jul = 7; aug = 8; sep = 9; oct = 10; nov = 11; dec = 12 }
    if ($map.ContainsKey($abbr)) { $monthNum = $map[$abbr] }
  }
  if ($monthNum -gt 0) { $monthForApi = $monthNum } else { $monthForApi = $monthRaw }

  $url = "https://stagingapi.astroapi.com/api/v1/prediction/monthly?language=$($r.language)&month=$monthForApi&year=$yearRaw&report=$($r.report)&zodiac=$($r.zodiac)"
  Write-Host "[$($r.test_case_id)] GET $url"

  $respRaw = & curl.exe -sS -i -H "x-api-key: iVf8NMjXY7Jmb8pjfKG75gumhnjVKvmasH8cEEt2" $url
  if ($LASTEXITCODE -ne 0 -or -not $respRaw) {
    Write-Host "  ERROR: curl failed (exit $LASTEXITCODE)"
    continue
  }

  $firstLine = ($respRaw -split "`n")[0].Trim()
  if ($firstLine -match 'HTTP/\d+\.\d+\s+(\d+)') { $status = $Matches[1] } else { $status = 'ERR' }
  $body = ($respRaw -split "`n")[-1]

  $prediction = ''
  try {
    $json = $body | ConvertFrom-Json -ErrorAction Stop
    if ($json -is [System.Array]) { $prediction = $json[0].prediction } else { $prediction = $json.prediction }
  } catch {
    $prediction = ''
  }

  # baseline lookup (improved: try multiple month formats)
  $expected = ''
  $matchZodiac = $r.zodiac
  if (-not $matchZodiac) { $matchZodiac = $r.zodiac_name }
  $matchZodiac = ([string]$matchZodiac).ToLower()
  $tryMonths = @()
  if ($r.expected_csv_key) {
    $parts = $r.expected_csv_key -split '_'
    if ($parts.Count -ge 3) {
      $expYear = $parts[1]
      $expMonth = $parts[2]
      # Normalize year: support 2-digit and 4-digit years from expected_csv_key
      $monNames = @('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec')
      $mnum = 0
      [int]::TryParse($expMonth, [ref]$mnum) | Out-Null
      if ($expYear.Length -eq 2) {
        $tryMonths += "${expMonth}-20${expYear}"
        $tryMonths += "${expMonth}-${expYear}"
        if ($mnum -ge 1 -and $mnum -le 12) {
          $tryMonths += "${monNames[$mnum-1]}-20${expYear}"
          $tryMonths += "${monNames[$mnum-1]}-${expYear}"
        }
      } else {
        # assume 4-digit year
        $tryMonths += "${expMonth}-${expYear}"
        if ($mnum -ge 1 -and $mnum -le 12) {
          $tryMonths += "${monNames[$mnum-1]}-${expYear}"
        }
      }
    }
  }
  if ($r.month -and $r.year) {
    $tryMonths += "${monthRaw}-${yearRaw}"

    $m = $monthNum

    if ($m -gt 0) {
      $tryMonths += "${m}-${yearRaw}"
      $tryMonths += "{0:d2}-{1}" -f $m, $yearRaw
      if ($m -ge 1 -and $m -le 12) {
        $tryMonths += "${monNames[$m-1]}-${yearRaw}"
        if ($yearRaw.Length -ge 2) {
          $tryMonths += "${monNames[$m-1]}-${yearRaw.Substring($yearRaw.Length-2)}"
        }
      }
    }
  }

  foreach ($c in $tryMonths) {
    $found = $baseline | Where-Object { ($_.month -and ($_.month.ToLower() -eq $c.ToLower())) -and ($_.zodiac_name -and ($_.zodiac_name.ToLower() -eq $matchZodiac)) }
    if ($found) { $expected = $found[0].description; break }
  }

  if ($i -eq 0) {
    Write-Host "  raw month/year: '$monthRaw' / '$($r.year)'"
    Write-Host "  expected_csv_key: $($r.expected_csv_key)"
    Write-Host "  month candidates: $($tryMonths -join ', ')"
    Write-Host "  zodiac match key: $matchZodiac"
  }

  # No loose fallback by zodiac-only: prefer explicit month/year matches
  # (leave expected empty if not found)

  $result = 'NO_BASELINE'
  if ($expected -ne '') {
    if ($prediction -and $prediction -ne '') {
      $predTokens = (($prediction -replace '[^\w\s]',' ') -split '\s+' | Where-Object { $_ -ne '' }) | ForEach-Object { $_.ToLower() }
      $expTokens = ((($expected -replace '"','') -replace '[^\w\s]',' ') -split '\s+' | Where-Object { $_ -ne '' }) | ForEach-Object { $_.ToLower() }
      $predNorm = ($predTokens -join ' ')
      $expNorm = ($expTokens -join ' ')

      if ($predNorm -and $expNorm -and ($predNorm -like "*${expNorm}*")) {
        $result = 'PASSED'
      } else {
        $predSet = @{}
        foreach ($t in $predTokens) { $predSet[$t] = $true }
        $common = ($expTokens | Where-Object { $predSet.ContainsKey($_) })
        $overlap = 0
        if ($expTokens.Count -gt 0) { $overlap = ($common.Count / $expTokens.Count) }
        if ($overlap -ge 0.55) { $result = 'PASSED' } else { $result = 'FAILED' }
      }
    } else { $result = 'FAILED' }
  }

  $predShort = ($prediction -replace '\s+', ' ')
  if ($predShort.Length -gt 300) { $predShort = $predShort.Substring(0,300) + '...' }

  $out += [PSCustomObject]@{
    test_case_id = $r.test_case_id
    url = $url
    status = $status
    prediction = $predShort
    expected = ($expected -replace '\s+', ' ')
    result = $result
  }

  Write-Host "  status: $status, result: $result"
  Start-Sleep -Milliseconds 500
}

$out | Export-Csv -Path $outPath -NoTypeInformation -Force
Write-Host "Saved results to $outPath"
$passed = ($out | Where-Object { $_.result -eq 'PASSED' }).Count
$failed = ($out | Where-Object { $_.result -eq 'FAILED' }).Count
$nob = ($out | Where-Object { $_.result -eq 'NO_BASELINE' }).Count
Write-Host "Summary: PASSED:$passed FAILED:$failed NO_BASELINE:$nob TOTAL:$($out.Count)"
