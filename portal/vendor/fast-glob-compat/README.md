# Adaptador de glob da compilação

Substitui a dependência fast-glob de vite-plugin-dynamic-import 1.6.0 por tinyglobby 0.2.17, já usado pelo Vite. Evita a cadeia micromatch/braces afetada por GHSA-vfj7-8cjw-p6xm, sem desativar npm audit.

Este pacote local não é uma distribuição do fast-glob nem implementa toda sua API: oferece apenas sync(patterns, options), usado pelo plugin na resolução de importações. expandDirectories permanece desativado para preservar a semântica de arquivos. O override por referência à dependência local garante resolução igual em Windows e Linux.

Ao atualizar os plugins, verificar novamente os consumidores e os testes. Quando houver uma versão oficial corrigida, reavaliar a remoção deste adaptador e do override.
