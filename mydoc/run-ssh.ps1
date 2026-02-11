$pemPath = "E:\doc\account\openclaw\openclaw.pem"
$host_ = "ubuntu@aws.flashvideos.org"
$script = @"
echo PROC_START
ps aux | grep openclaw-gateway | grep -v grep
echo PROC_END
echo PORT_START
ss -ltnp | grep -E '18789|18802|18803'
echo PORT_END
echo LOG_START
tail -30 /tmp/openclaw-new.log 2>/dev/null || tail -30 /tmp/openclaw.log 2>/dev/null
echo LOG_END
"@

$result = & ssh -i $pemPath -o StrictHostKeyChecking=no -o ConnectTimeout=15 $host_ $script 2>&1
$result | Out-String | Write-Host
