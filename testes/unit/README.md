# `testes/unit/` — funções puras, sem servidor e sem banco

Ao contrário de `testes/casos/`, nada aqui fala com produção: Meta e Supabase
são simulados. Roda com o `node:test` embutido (Node 24 remove os tipos do `.ts`
sozinho):

```bash
node --import ./testes/unit/resolver-ts.mjs --test "testes/unit/*.test.mjs"
```

`resolver-ts.mjs` só existe para resolver os imports sem extensão do app.
