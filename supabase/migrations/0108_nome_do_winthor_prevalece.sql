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
-- Substituicao cirurgica com verificacao, como nas 0104/0105/0107: o bloco
-- FALHA se o padrao nao aparecer exatamente uma vez em cada view, entao nao ha
-- como aplicar pela metade em silencio. As duas views do funil mudam juntas
-- pelo motivo de sempre (§32.2) -- se so uma mudasse, o ETL e a tela
-- discordariam sobre o nome do mesmo cliente.
-- =============================================================================

do $$
declare
  alvo constant text := 'c.nome_completo AS cliente';
  novo constant text := 'COALESCE(wcar.nome, c.nome_completo) AS cliente';
  v text; def text; n int;
begin
  foreach v in array array['vw_funil','vw_funil_visivel'] loop
    def := pg_get_viewdef(('public.' || v)::regclass, true);
    n := (length(def) - length(replace(def, alvo, ''))) / length(alvo);
    if n <> 1 then
      raise exception 'em % esperava 1 ocorrencia de "%", achei %', v, alvo, n;
    end if;
    -- `wcar` (wth_carteira) ja esta no FROM das duas views: e de la que sai o
    -- `rca_num` exposto desde a 0093. Nenhum join novo, nenhum custo novo.
    execute 'create or replace view public.' || v || ' as ' || replace(def, alvo, novo);
  end loop;
end $$;

comment on view vw_funil_visivel is
  'Funil da TELA, ja recortado pelas linhas visiveis (0099). Desde a 0108 o nome do '
  'cliente vem do WinThor quando ha vinculo -- `clientes.nome_completo` fica como '
  'fallback de quem ainda nao existe no ERP.';
