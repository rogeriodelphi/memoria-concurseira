# Builda e reimplanta o servidor de producao, entregando ao supervisor que ja
# existe (tarefa agendada BaseConcurseira, ver install-autostart.ps1) em vez de
# subir um node "avulso" por conta propria.
#
# Por que isso importa: a tarefa tenta religar sozinha a cada 1 minuto se o
# processo cair. Subir um node na mao deixaria um processo de fundo brigando
# pela porta e falhando pra sempre. O jeito certo e usar a PROPRIA tarefa para
# reiniciar (schtasks /run), nao competir com ela.
#
# Uso:
#   npm run deploy
#   npm run deploy -- -SkipChecks   # pula o typecheck (emergencia)

param(
  [int]$Port = 3200,
  [string]$TaskName = 'BaseConcurseira',
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$projeto = Split-Path -Parent $PSScriptRoot

Push-Location $projeto
try {
  if (-not $SkipChecks) {
    # Antes do build de proposito: nao vale derrubar o servidor so para
    # descobrir depois que o typecheck quebrou.
    Write-Host "1/4 - typecheck..."
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "Typecheck falhou (exit $LASTEXITCODE) - nada foi tocado em producao." }
  } else {
    Write-Host "1/4 - typecheck pulado (-SkipChecks)"
  }

  Write-Host "2/4 - build..."
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build falhou (exit $LASTEXITCODE) - o servidor atual continua no ar." }
} finally {
  Pop-Location
}

Write-Host "3/4 - parando o processo atual na porta $Port..."
$dono = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($dono) {
  # So derruba se for este servidor: a porta nunca deve matar outro programa.
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($dono.OwningProcess)").CommandLine
  if ($cmd -notlike '*dist-server*server.cjs*') {
    throw "A porta $Port esta em uso por outro programa (PID $($dono.OwningProcess)) - nada foi derrubado."
  }
  Stop-Process -Id $dono.OwningProcess -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

Write-Host "4/4 - pedindo a tarefa '$TaskName' para subir com o build novo, e checando saude..."
schtasks /run /tn $TaskName | Out-Null
if ($LASTEXITCODE -ne 0) { throw "schtasks /run falhou - a tarefa '$TaskName' existe? Rode npm run service:install." }

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}

if ($ok) {
  Write-Host "OK - servidor respondendo em http://localhost:$Port"
} else {
  throw "Servidor nao respondeu apos o deploy - confira a tarefa '$TaskName' no Agendador de Tarefas do Windows."
}
