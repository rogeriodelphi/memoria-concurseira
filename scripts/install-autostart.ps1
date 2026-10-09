# Registra o Base Concurseira como tarefa agendada do Windows, para o app subir
# sozinho no login e voltar sozinho se o processo cair - sem depender de
# nenhum terminal ou sessao do Claude aberta.
#
# Mesmo desenho do Terminal B3 (outro projeto): gatilho de logon nao exige
# administrador, e num PC de mesa a sessao precisa estar aberta de qualquer
# forma. Servico (nssm) so valeria a pena para rodar sem ninguem logado.
#
# Porta propria (3200) de proposito: `npm run dev` usa 3000/5173, e dois
# processos na mesma porta fazem um deles morrer. Com a 3200 os dois convivem -
# o de producao serve o uso do dia a dia, o de desenvolvimento serve a edicao.
# Os dois usam o mesmo banco (data/app.db).
#
# Uso:
#   npm run service:install                                  # instala
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
#
# Registrar de novo derruba o processo vivo da tarefa (schtasks /f apaga e
# recria). Para atualizar o codigo sem isso, use `npm run deploy`.

param(
  [int]$Port = 3200,
  [string]$TaskName = 'BaseConcurseira',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$projeto = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source

if ($Remove) {
  schtasks /delete /tn $TaskName /f
  Write-Host "Tarefa removida."
  return
}

if (-not (Test-Path "$projeto\dist-server\server.cjs")) {
  throw "Build de producao ausente. Rode 'npm run build' antes."
}

# Porta ocupada por OUTRO programa faria a tarefa falhar em silencio a cada
# minuto. Se o dono for uma instancia anterior deste mesmo servidor, tudo bem.
$dono = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($dono) {
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($dono.OwningProcess)").CommandLine
  if ($cmd -notlike '*dist-server*server.cjs*') {
    throw "A porta $Port ja esta em uso por outro programa (PID $($dono.OwningProcess)). Use -Port com outra porta."
  }
}

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Base Concurseira - servidor de producao (porta $Port)</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$env:USERDOMAIN\$env:USERNAME</UserId>
    </LogonTrigger>
    <!-- O gatilho de tempo e o que REALMENTE mantem o processo de pe: o
         RestartOnFailure nao ressuscita processo de longa duracao que morre.
         Com MultipleInstancesPolicy=IgnoreNew a tentativa e descartada
         enquanto o processo esta vivo e vira restart quando nao esta.
         Medido derrubando o processo a forca: voltou em ~110 s. -->
    <TimeTrigger>
      <StartBoundary>2020-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$env:USERDOMAIN\$env:USERNAME</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <!-- Sem limite de duracao (o padrao do Windows e 72h): e um servidor. -->
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <!-- Executavel DIRETO, sem cmd /c nem PowerShell no caminho: um shell
         prende o node a um console, e o app ja morreu em producao quando esse
         console recebeu um evento de controle (STATUS_CONTROL_C_EXIT).
         NODE_ENV tambem NAO e definido: em production o cookie de sessao
         passa a ser 'secure' e para de funcionar em HTTP pelo IP da rede. -->
    <Exec>
      <Command>$node</Command>
      <Arguments>dist-server\server.cjs --port $Port</Arguments>
      <WorkingDirectory>$projeto</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$tmp = Join-Path $env:TEMP "$TaskName.xml"
# UTF-16 e exigencia do schtasks /xml - em UTF-8 ele recusa o arquivo.
$xml | Out-File -FilePath $tmp -Encoding unicode
schtasks /create /tn $TaskName /xml $tmp /f | Out-Null
if ($LASTEXITCODE -ne 0) { Remove-Item $tmp -Force; throw "schtasks /create falhou (exit $LASTEXITCODE)." }
Remove-Item $tmp -Force
Write-Host "Tarefa '$TaskName' criada (porta $Port)."
Write-Host ""
Write-Host "Para iniciar agora:  schtasks /run /tn $TaskName"
Write-Host "Para remover:        scripts\install-autostart.ps1 -Remove"
