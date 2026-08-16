import { PaginaLegal, Secao, P, Lista, Caixa } from "../PaginaLegal";
import { EMPRESA, RETENCAO_ANOS } from "../../lib/empresa";

// Política de Privacidade — página pública, sem sessão.
//
// Existe por duas razões que se somam: a LGPD (Lei 13.709/2018), que obriga a
// informar o titular sobre o tratamento, e o painel da Meta, que exige a URL de
// uma política publicada para tirar o app do modo Desenvolvimento (§16.6 do
// CLAUDE.md). A seção de exclusão de dados tem âncora própria (#exclusao)
// porque o painel pede esse endereço num campo separado.
//
// O texto descreve o tratamento REAL deste sistema: WhatsApp Cloud API, espelho
// no Supabase (inclusive das mídias, no bucket wa-midia) e cruzamento com o ERP
// WinThor. Ao mudar o que o sistema faz com dado pessoal, mudar aqui junto —
// política que descreve outro sistema é pior que política nenhuma.

export const metadata = {
  title: "Política de Privacidade — Murano Professional",
  description: "Como a Murano Professional trata os dados pessoais de clientes no atendimento por WhatsApp e no relacionamento comercial.",
};

export default function Privacidade() {
  return (
    <PaginaLegal
      titulo="Política de Privacidade"
      resumo="Como tratamos os dados pessoais de clientes e interessados no atendimento comercial da Murano Professional, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018)."
    >
      <Secao titulo="1. Quem é responsável pelos seus dados">
        <P>
          O controlador dos dados pessoais tratados nesta plataforma é <b>{EMPRESA.razaoSocial}</b>, inscrita
          no CNPJ {EMPRESA.cnpj}, com sede em {EMPRESA.endereco}, que atua comercialmente como {EMPRESA.nomeFantasia}.
        </P>
        <P>
          Encarregado pelo tratamento de dados pessoais (art. 41 da LGPD): {EMPRESA.encarregado}, pelo
          e-mail <b>{EMPRESA.emailContato}</b>.
        </P>
      </Secao>

      <Secao titulo="2. A quem esta política se aplica">
        <P>
          A clientes, potenciais clientes e demais pessoas que entram em contato com a Murano Professional
          pelos nossos canais de atendimento — em especial o WhatsApp — e a quem consta da nossa base
          comercial. Nossa plataforma de atendimento é de uso interno: ela é operada por pessoas autorizadas
          da Murano Professional, e não há cadastro nem área de acesso para clientes.
        </P>
      </Secao>

      <Secao titulo="3. Que dados tratamos">
        <Lista
          itens={[
            <><b>Identificação e contato:</b> nome, telefone, e-mail, CPF ou CNPJ e endereço.</>,
            <><b>Relacionamento comercial:</b> histórico de pedidos, notas fiscais, produtos adquiridos,
              valores, devoluções e o vendedor responsável pelo seu atendimento.</>,
            <><b>Conteúdo das conversas:</b> as mensagens trocadas com nossa equipe pelo WhatsApp, incluindo
              os arquivos enviados na conversa — fotos, áudios, vídeos e documentos — e as informações
              técnicas de entrega e leitura da mensagem.</>,
            <><b>Anotações internas:</b> registros que nossa equipe faz sobre o atendimento, como o motivo
              de encerramento e observações operacionais.</>,
          ]}
        />
        <P>
          Não pedimos e não temos interesse em dados pessoais sensíveis (art. 5º, II da LGPD), como dados de
          saúde, biometria, religião ou opinião política. Se algo assim for enviado espontaneamente numa
          conversa, será tratado apenas como parte daquele atendimento e poderá ser eliminado a seu pedido.
        </P>
      </Secao>

      <Secao titulo="4. De onde vêm esses dados">
        <Lista
          itens={[
            <><b>De você:</b> o que nos informa na conversa, no pedido ou no cadastro.</>,
            <><b>Do nosso sistema de gestão comercial (ERP):</b> o cadastro e o histórico de compras já
              existentes na relação comercial com a Murano Professional.</>,
            <><b>Da plataforma WhatsApp:</b> quando você nos escreve, recebemos seu número, o nome de
              exibição do seu perfil e o conteúdo da mensagem.</>,
          ]}
        />
      </Secao>

      <Secao titulo="5. Para que usamos e com qual base legal">
        <Lista
          itens={[
            <><b>Atender, negociar e vender</b> — execução de contrato ou de procedimentos preliminares
              relacionados a ele (art. 7º, V).</>,
            <><b>Registrar o histórico do atendimento</b>, para dar continuidade à conversa e não pedir
              duas vezes a mesma informação — legítimo interesse (art. 7º, IX).</>,
            <><b>Emitir notas fiscais e cumprir obrigações contábeis e tributárias</b> — cumprimento de
              obrigação legal ou regulatória (art. 7º, II).</>,
            <><b>Enviar comunicações comerciais</b>, como ofertas e novidades, quando você aceita
              recebê-las — consentimento (art. 7º, I), revogável a qualquer momento.</>,
            <><b>Medir a qualidade do atendimento</b>, com indicadores agregados como tempo de resposta —
              legítimo interesse (art. 7º, IX).</>,
          ]}
        />
        <P>
          Não usamos seus dados para decisões automatizadas que produzam efeitos jurídicos sobre você, nem
          os vendemos a terceiros.
        </P>
      </Secao>

      <Secao titulo="6. Com quem compartilhamos">
        <P>
          Não comercializamos dados pessoais. Compartilhamos apenas o necessário, com fornecedores que
          tratam os dados <b>em nosso nome</b> e sob contrato:
        </P>
        <Lista
          itens={[
            <><b>Meta Platforms</b> — provedora do WhatsApp Business, por onde a conversa trafega.</>,
            <><b>Supabase</b> — banco de dados e armazenamento de arquivos onde a plataforma guarda o
              histórico do atendimento.</>,
            <><b>Vercel</b> — hospedagem da aplicação.</>,
            <><b>Google</b> — autenticação das contas da nossa equipe.</>,
            <>Autoridades públicas, quando houver <b>obrigação legal</b> ou ordem judicial.</>,
          ]}
        />
        <P>
          Parte desses fornecedores mantém servidores fora do Brasil, o que caracteriza transferência
          internacional de dados. Ela ocorre nas hipóteses e com as garantias dos arts. 33 e seguintes da
          LGPD, por meio de cláusulas contratuais de proteção firmadas com esses fornecedores.
        </P>
      </Secao>

      <Secao titulo="7. Por quanto tempo guardamos">
        <P>
          Mantemos os dados enquanto durar o relacionamento comercial e por até <b>{RETENCAO_ANOS} anos</b> após
          o último contato, prazo compatível com a prescrição de pretensões comerciais e com a guarda de
          documentos fiscais. Depois disso, os dados são eliminados ou anonimizados.
        </P>
        <P>
          Alguns registros podem ser mantidos por mais tempo quando houver obrigação legal específica ou
          necessidade de defesa em processo (art. 16 da LGPD).
        </P>
      </Secao>

      <Secao titulo="8. Como protegemos">
        <P>
          O acesso à plataforma é individual, restrito a pessoas autorizadas da Murano Professional e
          limitado à carteira de clientes de cada vendedor. O banco de dados exige autenticação e nenhuma
          credencial de acesso é exposta ao navegador. As conversas trafegam pela infraestrutura do
          WhatsApp, com a criptografia que a própria plataforma aplica.
        </P>
        <P>
          Nenhuma medida de segurança é infalível. Se ocorrer incidente com risco relevante aos seus
          direitos, comunicaremos você e a Autoridade Nacional de Proteção de Dados, como manda o art. 48
          da LGPD.
        </P>
      </Secao>

      <Secao titulo="9. Seus direitos">
        <P>Como titular, a LGPD garante a você (art. 18), a qualquer momento e sem custo:</P>
        <Lista
          itens={[
            "confirmação de que tratamos seus dados, e acesso a eles;",
            "correção de dados incompletos, inexatos ou desatualizados;",
            "anonimização, bloqueio ou eliminação de dados desnecessários ou tratados fora da lei;",
            "portabilidade a outro fornecedor;",
            "eliminação dos dados tratados com base no seu consentimento;",
            "informação sobre com quem compartilhamos seus dados;",
            "revogação do consentimento e oposição a tratamento feito com base em legítimo interesse.",
          ]}
        />
        <P>
          Para exercer qualquer um deles, escreva para <b>{EMPRESA.emailContato}</b>. Podemos pedir
          informações que confirmem sua identidade — é uma proteção contra pedidos feitos por terceiros em
          seu nome. Respondemos em até 15 dias.
        </P>
      </Secao>

      <Secao id="exclusao" titulo="10. Como pedir a exclusão dos seus dados">
        <Caixa>
          <P>
            Envie um e-mail para <b>{EMPRESA.emailContato}</b> com o assunto <b>“Exclusão de dados”</b>,
            informando seu nome e o telefone usado no atendimento. Você também pode fazer o pedido pela
            própria conversa de WhatsApp com nossa equipe.
          </P>
          <P>
            Apagamos o histórico das conversas, os arquivos enviados e os dados de contato em até 15 dias,
            e confirmamos a conclusão pelo mesmo canal.
          </P>
        </Caixa>
        <P>
          Um limite honesto: registros que a lei nos obriga a manter — notas fiscais emitidas, por exemplo —
          não podem ser apagados antes do prazo legal. Nesse caso dizemos exatamente o que foi apagado e o
          que permaneceu, e por quê.
        </P>
      </Secao>

      <Secao titulo="11. Como deixar de receber mensagens">
        <P>
          Basta pedir na própria conversa. Registramos a recusa e paramos de enviar comunicações
          promocionais — isso não impede que respondamos ao que você nos perguntar depois, nem interrompe
          mensagens necessárias a um pedido em andamento.
        </P>
      </Secao>

      <Secao titulo="12. Cookies">
        <P>
          A plataforma usa apenas cookies necessários para manter a sessão de quem trabalha nela. Não há
          cookies de publicidade nem de rastreamento de comportamento, e estas páginas de política e termos
          não usam cookie algum.
        </P>
      </Secao>

      <Secao titulo="13. Crianças e adolescentes">
        <P>
          Nossa atuação é entre empresas e profissionais do setor de beleza. Não direcionamos o atendimento
          a menores de 18 anos nem coletamos seus dados intencionalmente. Identificado um caso desses, os
          dados são eliminados.
        </P>
      </Secao>

      <Secao titulo="14. Mudanças nesta política">
        <P>
          Podemos atualizar este documento para refletir mudanças na lei ou na forma como atendemos. A data
          da última revisão fica no topo da página. Mudanças relevantes serão comunicadas pelos canais de
          atendimento.
        </P>
      </Secao>

      <Secao titulo="15. Fale conosco">
        <P>
          Dúvidas sobre esta política ou sobre o tratamento dos seus dados: <b>{EMPRESA.emailContato}</b>.
          Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
        </P>
      </Secao>
    </PaginaLegal>
  );
}
