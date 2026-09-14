param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Protect', 'Unprotect')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Security

$inputText = [Console]::In.ReadToEnd().Trim()
if (-not $inputText) {
    throw 'Provider credential payload is empty.'
}

$inputBytes = [Convert]::FromBase64String($inputText)
$entropy = [System.Text.Encoding]::UTF8.GetBytes('AIFISHER.ProviderCredentials.v1')
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$outputBytes = $null
try {
    if ($Action -eq 'Protect') {
        $outputBytes = [System.Security.Cryptography.ProtectedData]::Protect(
            $inputBytes,
            $entropy,
            $scope
        )
    } else {
        $outputBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $inputBytes,
            $entropy,
            $scope
        )
    }
    [Console]::Out.Write([Convert]::ToBase64String($outputBytes))
} finally {
    if ($inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
    if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
    if ($outputBytes) { [Array]::Clear($outputBytes, 0, $outputBytes.Length) }
}
