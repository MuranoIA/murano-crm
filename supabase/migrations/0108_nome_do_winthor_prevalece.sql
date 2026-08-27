-- =============================================================================
-- 0108 · Cliente cadastrado no WinThor: o nome do ERP prevalece na tela.
--
-- Regra declarada pelo usuario (27/08/2026): *"o comportamento padrao e que se
-- houver (ja existir no winthor) entao os dados cadastrados no winthor devem
-- prevalecer na visualizacao"*.
--
-- Nao e regra nova -- e a §10.8 ("WinThor e fonte da verdade quando houver
-- divergencia de sync") finalmente aplicada ao NOME. Ate aqui as views usavam
-- `c.nome_completo`, que e a nossa copia, escrita pelo ETL na criacao do
-- contato e pelo botao "Salvar contato" do chat.
--
-- ---------------------------------------------------------------------------
-- O QUE ISSO CONSERTA, E POR QUE NAO SE CONSERTAVA SOZINHO
--
-- O botao "Salvar contato" grava `clientes.nome_completo`. Num cliente ja
-- vinculado, digitar "rom" fazia o CRM inteiro passar a chamar de "rom" quem o
-- ERP chama de "ROMULO ALBUQUERQUE" -- e ficava assim para sempre, porque o ETL
-- **nunca reescreve contato ja conhecido** (§25.2). Uma letra errada num campo
-- de texto contaminava board, chat, busca e relatorio, sem volta automatica.
--
-- Com o COALESCE invertido, a nossa copia vira o que ela sempre deveria ter
-- sido: o **fallback** de quem ainda nao existe no ERP.
--
-- ---------------------------------------------------------------------------
-- ⚠️ ISTO NAO APAGA NADA
--
-- `clientes.nome_completo` continua no banco, intacto. E ele que atende o
-- contato sem vinculo -- o novo, o lead de marketing, o que ainda nao tem CPF.
-- Assim que o CPF entra e `wth_reconciliar_vinculos()` casa (ate 10 min), o
-- nome do ERP assume sozinho. Nenhum passo manual.
--
-- ---------------------------------------------------------------------------
-- ONDE O NOME JA VINHA DO ERP (a inconsistencia que existia)
--
-- `vw_venda_card` (0105) ja usava `coalesce(w.nome, 'cliente ' || codcli)`, ou
-- seja o nome do WinThor. As views do funil usavam o nosso. O mesmo cliente
-- podia aparecer com dois nomes em duas colunas do MESMO board. Isto alinha.
--
-- Substituicao cirurgica com verificacao, como nas 0104/0105/0107.
--
-- ⚠️ SO O PRIMEIRO RAMO MUDA. As duas primeiras versoes deste arquivo morreram
-- aqui, e cada erro ensinou uma coisa:
--
--   1a tentativa (`n = 1`)  -> `em vw_funil_visivel esperava 1, achei 2`
--   2a tentativa (trocar todas) -> `missing FROM-clause entry for table "wcar"`
--
-- A `vw_funil_visivel` e uma UNION de tres ramos, e o padrao aparece em dois:
--
--   ramo 1  conversas    FROM clientes ... LEFT JOIN wth_carteira wcar   <- TROCA
--   ramo 1b ociosos      FROM clientes CROSS JOIN sel (sem wcar)         <- NAO
--   ramo 2  prospeccao   FROM wth_carteira w, ja usa `w.nome`            <- ja ok
--
-- O ramo 1b **nao pode** mudar, e nao e detalhe tecnico: o WHERE dele exige
-- `NOT EXISTS` em `wth_vinculo` E em `wth_carteira`. Ele e, por definicao,
-- quem NAO existe no WinThor (§31.3) -- nao ha nome do ERP para preferir, e o
-- nosso e o unico que existe. O erro do Postgres estava certo pelo motivo
-- certo.
--
-- Dai a substituicao ser da PRIMEIRA ocorrencia, via `position` + `overlay`,
-- em vez de `replace` (que troca todas). A trava continua cobrando pelo menos
-- uma: zero significa que alguem ja mexeu na view.
--
-- Nada disso chegou a ser aplicado pela metade nas duas tentativas: `do $$` e
-- uma transacao so, e a excecao devolveu tudo. E exatamente para isso que a
-- verificacao existe.
--
-- As duas views mudam juntas pelo motivo de sempre (§32.2): se so uma mudasse,
-- o ETL e a tela discordariam sobre o nome do mesmo cliente.
-- =============================================================================

do $$
declare
  alvo constant text := 'c.nome_completo AS cliente';
  novo constant text := 'COALESCE(wcar.nome, c.nome_completo) AS cliente';
  v text; def text; pos int;
begin
  foreach v in array array['vw_funil','vw_funil_visivel'] loop
    def := pg_get_viewdef(('public.' || v)::regclass, true);
    pos := position(alvo in def);
    if pos = 0 then
      raise exception 'em % nao achei "%" -- a view mudou desde a 0108', v, alvo;
    end if;
    -- `overlay`, nao `replace`: so o PRIMEIRO ramo tem `wcar` no escopo.
    def := overlay(def placing novo from pos for length(alvo));
    execute 'create or replace view public.' || v || ' as ' || def;
    raise notice '% : nome do ERP aplicado no ramo das conversas', v;
  end loop;
end $$;

comment on view vw_funil_visivel is
  'Funil da TELA, ja recortado pelas linhas visiveis (0099). Desde a 0108 o nome do '
  'cliente vem do WinThor quando ha vinculo -- `clientes.nome_completo` fica como '
  'fallback de quem ainda nao existe no ERP.';
