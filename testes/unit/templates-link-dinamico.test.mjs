// Parte A do card #19 do Entregas: botão de LINK DINÂMICO na criação de modelo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarBotoes, urlDinamica, erroDoLink } from "../../web/lib/templateVars.ts";
import { componentesDe } from "../../web/lib/whatsappTemplates.ts";

const RASTREIO = "https://app.muranoprofessional.com.br/rastreio/{{1}}";
const botao = (valor, exemplo) => ({ tipo: "URL", texto: "Acompanhar entrega", valor, exemplo });

test("urlDinamica: só {{1}} no FIM do link", () => {
  assert.equal(urlDinamica(RASTREIO), true);
  assert.equal(urlDinamica(" " + RASTREIO + " "), true);
  assert.equal(urlDinamica("https://x.com/{{ 1 }}"), true);
  assert.equal(urlDinamica("https://x.com/a"), false);
  assert.equal(urlDinamica("https://x.com/{{1}}/fim"), false);
  assert.equal(urlDinamica("https://x.com/{{2}}"), false);
  assert.equal(urlDinamica(null), false);
});

test("erroDoLink: link fixo continua valendo sem exemplo", () => {
  assert.equal(erroDoLink(botao("https://murano.com.br")), null);
  assert.match(erroDoLink(botao("murano.com.br")), /http/);
});

test("erroDoLink: dinâmico exige exemplo, sem espaço e sem o link inteiro", () => {
  assert.match(erroDoLink(botao(RASTREIO, "")), /exemplo/);
  assert.match(erroDoLink(botao(RASTREIO, "a b")), /espaço/);
  assert.match(erroDoLink(botao(RASTREIO, "https://app.muranoprofessional.com.br/rastreio/abc")), /não o link inteiro/);
  assert.equal(erroDoLink(botao(RASTREIO, "a1b2c3d4")), null);
});

test("erroDoLink: variável fora do fim, repetida, ou sem endereço fixo é recusada", () => {
  assert.match(erroDoLink(botao("https://x.com/{{1}}/a", "x")), /no final/);
  assert.match(erroDoLink(botao("https://x.com/{{1}}{{1}}", "x")), /uma parte variável/);
  assert.match(erroDoLink(botao("https://x.com/{{2}}", "x")), /no final/);
  assert.match(erroDoLink(botao("https://{{1}}", "x")), /endereço fixo/);
});

test("validarBotoes usa a regra do link dinâmico", () => {
  assert.match(validarBotoes([botao(RASTREIO, "")]).erro, /exemplo/);
  assert.equal(validarBotoes([botao(RASTREIO, "tok")]).erro, null);
});

test("componentesDe: link dinâmico leva example com SÓ a parte variável", () => {
  const comps = componentesDe({
    metaNome: "entrega_saiu", categoria: "UTILITY", idioma: "pt_BR",
    corpo: "Olá, {{1}}! Seu pedido {{2}} saiu para entrega hoje.", qtdVariaveis: 2,
    botoes: [botao(RASTREIO, " a1b2c3d4 ")],
  });
  const botoes = comps.find((c) => c.type === "BUTTONS");
  assert.deepEqual(botoes.buttons, [{
    type: "URL", text: "Acompanhar entrega", url: RASTREIO, example: ["a1b2c3d4"],
  }]);
  const corpo = comps.find((c) => c.type === "BODY");
  assert.equal(corpo.example.body_text[0].length, 2);
});

test("componentesDe: link fixo NÃO leva example (a Meta recusa)", () => {
  const comps = componentesDe({
    metaNome: "x", categoria: "MARKETING", idioma: "pt_BR", corpo: "oi", qtdVariaveis: 0,
    botoes: [botao("https://murano.com.br", "sobrou")],
  });
  assert.deepEqual(comps.find((c) => c.type === "BUTTONS").buttons[0],
    { type: "URL", text: "Acompanhar entrega", url: "https://murano.com.br" });
});
