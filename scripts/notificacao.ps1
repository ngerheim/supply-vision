# Notificacoes da area de trabalho para a operacao Supply Vision.
# Toda falha aqui e engolida de proposito: aviso na tela nunca pode
# derrubar o supervisor.

$script:NotificacaoAppId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'

function Notificar([string]$Titulo, [string]$Texto) {
  try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
    $modelo = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $textos = $modelo.GetElementsByTagName('text')
    [void]$textos.Item(0).AppendChild($modelo.CreateTextNode($Titulo))
    [void]$textos.Item(1).AppendChild($modelo.CreateTextNode($Texto))
    $aviso = [Windows.UI.Notifications.ToastNotification]::new($modelo)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($script:NotificacaoAppId).Show($aviso)
    return $true
  } catch {
    return $false
  }
}
