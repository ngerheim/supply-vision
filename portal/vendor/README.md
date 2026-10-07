# Pacote SheetJS

`xlsx-0.20.3.tgz` e uma copia sem alteracoes do pacote oficial:
https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz

Licenca Apache-2.0, incluida no pacote. A integridade SHA-512 permanece no
`package-lock.json` e foi conferida antes da inclusao. `npm ci` nao consulta o
CDN para esta dependencia; as demais dependencias continuam usando o registro.

Para atualizar: obter uma versao oficial, conferir integridade e licenca,
atualizar o arquivo e o lockfile e executar os testes de importacao. O pacote
local nao e coberto automaticamente por alertas de versao do Dependabot ou
pela base de avisos do npm: sua revisao deve ser explicita nas atualizacoes.
