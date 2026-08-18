import { MolduraLegal, Secao, P, Lista, Dados, Destaque } from "../legal";
import { lerDadosLegais, dataPorExtenso, identificacao } from "../../lib/paginasLegais";

// Página PÚBLICA — par da /privacidade. Mesmo desenho: texto no código,
// dados da empresa em `paginas_legais` (migration 0088).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Termos de Uso — Murano Professional",
  description:
    "Condições do atendimento da Murano Professional por WhatsApp e do uso do nosso sistema de atendimento.",
};

export default async function Termos() {
  const d = await lerDadosLegais();
  const quem = identificacao(d);
  const foro = d.cidade_uf || "a comarca da sede da Murano";

  return (
    <MolduraLegal
      titulo="Termos de Uso"
      resumo="Estas são as condições do atendimento que prestamos por WhatsApp e do uso do sistema de atendimento da Murano Professional."
      vigencia={dataPorExtenso(d.vigencia)}
      outra={{ href: "/privacidade", texto: "Ler a Política de Privacidade" }}
    >
      <Secao n={1} titulo="Quem oferece e a quem se aplica">
        <P>
          O atendimento e o sistema descritos aqui são oferecidos por {quem}, adiante Murano. Estes
          termos valem para duas situações distintas: para <b>quem é atendido</b> pelos nossos
          canais de WhatsApp, e para <b>quem usa o sistema interno</b> de atendimento como
          colaborador autorizado.
        </P>
        <Dados
          linhas={[
            ["Razão social", d.razao_social],
            ["CNPJ", d.cnpj],
            ["Endereço", [d.endereco, d.cidade_uf, d.cep].filter(Boolean).join(" — ")],
            ["WhatsApp", d.whatsapp],
            ["E-mail", d.email_contato],
          ]}
        />
      </Secao>

      <Secao n={2} titulo="Aceitação">
        <P>
          Ao iniciar ou continuar uma conversa com a Murano pelos nossos canais, você concorda com
          estes termos e com a nossa Política de Privacidade. Se não concordar, basta não usar o
          canal — o atendimento por telefone e e-mail continua disponível.
        </P>
      </Secao>

      <Secao n={3} titulo="Como funciona o atendimento por WhatsApp">
        <Lista
          itens={[
            "O atendimento é feito por pessoas da nossa equipe comercial, dentro do horário de expediente informado no próprio canal. Fora dele, você pode receber uma resposta automática avisando quando voltamos.",
            "Podemos usar mais de um número. O número que responde a você é sempre identificado no próprio WhatsApp.",
            "Por regra da própria plataforma, quando passam 24 horas sem mensagem sua, só conseguimos retomar o contato por uma mensagem em formato pré-aprovado pela Meta. Não é escolha nossa; é como o WhatsApp funciona.",
            "Podemos ligar para você pelo WhatsApp quando isso ajudar o atendimento, e você pode ligar para nós pelo mesmo canal. O conteúdo das ligações não é gravado.",
            "A Murano não cobra nada pelo uso do canal. Custos de dados da sua operadora são por sua conta.",
          ]}
        />
        <Destaque>
          Este canal é comercial. <b>Não use o WhatsApp da Murano para emergências</b> nem para
          assuntos que exijam resposta imediata garantida — não há atendimento ininterrupto.
        </Destaque>
      </Secao>

      <Secao n={4} titulo="Orçamentos, preços e pedidos">
        <Lista
          itens={[
            "Valores, prazos e condições informados na conversa são válidos apenas enquanto vigentes e dependem de disponibilidade de estoque.",
            "O pedido só se considera fechado quando confirmado pela Murano e formalizado com a emissão da nota fiscal correspondente.",
            "Imagens de produto são ilustrativas; embalagem e apresentação podem variar conforme o fabricante.",
            "Erros evidentes de digitação em preço ou quantidade não obrigam a Murano — nesses casos avisamos e corrigimos antes de faturar.",
          ]}
        />
      </Secao>

      <Secao n={5} titulo="Uso adequado do canal">
        <P>Ao conversar conosco, você concorda em não:</P>
        <Lista
          itens={[
            "enviar conteúdo ilícito, ofensivo, discriminatório ou que viole direitos de terceiros;",
            "se passar por outra pessoa ou empresa;",
            "usar o canal para divulgar produtos ou serviços de terceiros, correntes ou golpes;",
            "tentar obter acesso indevido aos nossos sistemas, ou automatizar mensagens em volume que prejudique o atendimento de outras pessoas.",
          ]}
        />
        <P>
          Diante de abuso, podemos encerrar a conversa, bloquear o contato e, se for o caso,
          comunicar as autoridades.
        </P>
      </Secao>

      <Secao n={6} titulo="Uso do sistema por colaboradores">
        <P>
          O acesso ao sistema de atendimento é pessoal, concedido pela Murano a colaboradores
          autorizados e limitado ao que cada função exige. Quem tem acesso concorda em:
        </P>
        <Lista
          itens={[
            "não compartilhar a própria conta, senha ou sessão com terceiros;",
            "usar os dados de clientes exclusivamente para o atendimento e para as atividades da empresa, jamais para fins particulares;",
            "não extrair, copiar ou levar consigo bases de contatos e históricos de conversa;",
            "comunicar imediatamente à empresa qualquer suspeita de acesso indevido.",
          ]}
        />
        <P>
          As ações realizadas no sistema ficam registradas — mensagens enviadas, transferências de
          conversa, encerramentos e alterações de configuração —, tanto para auditoria quanto para
          a gestão do atendimento. O acesso é revogado ao término do vínculo.
        </P>
      </Secao>

      <Secao n={7} titulo="Propriedade intelectual">
        <P>
          Marcas, nomes, catálogos, textos e imagens da Murano e dos fabricantes representados são
          protegidos por lei. O material recebido no atendimento pode ser usado por você para
          avaliar e realizar a compra, mas não para redistribuição comercial sem autorização
          escrita.
        </P>
      </Secao>

      <Secao n={8} titulo="Privacidade">
        <P>
          O tratamento dos dados pessoais envolvidos neste atendimento está descrito na{" "}
          <a href="/privacidade" style={{ color: "#7b2d8b", fontWeight: 700 }}>
            Política de Privacidade
          </a>
          , que é parte integrante destes termos.
        </P>
      </Secao>

      <Secao n={9} titulo="Disponibilidade e responsabilidade">
        <P>
          O canal depende de serviços de terceiros — WhatsApp, operadoras de telefonia e provedores
          de infraestrutura. Não garantimos disponibilidade ininterrupta nem prazo de resposta, e
          não respondemos por indisponibilidade, atraso ou perda de mensagens causados por esses
          serviços.
        </P>
        <P>
          Nossa responsabilidade se limita ao fornecimento dos produtos e serviços efetivamente
          contratados, nos termos da legislação aplicável, incluindo o Código de Defesa do
          Consumidor quando for o caso.
        </P>
      </Secao>

      <Secao n={10} titulo="Mudanças nestes termos">
        <P>
          Podemos alterar estes termos para refletir mudanças no serviço ou na legislação. A versão
          vigente é sempre a publicada nesta página, com a data indicada no topo. O uso do canal
          após a mudança significa concordância com a nova versão.
        </P>
      </Secao>

      <Secao n={11} titulo="Lei aplicável e foro">
        <P>
          Estes termos são regidos pela lei brasileira. Fica eleito o foro de {foro} para dirimir
          controvérsias, ressalvado o direito do consumidor de escolher o foro do seu domicílio.
        </P>
      </Secao>

      <Secao n={12} titulo="Fale conosco">
        <Dados
          linhas={[
            ["WhatsApp", d.whatsapp],
            ["Telefone", d.telefone],
            ["E-mail", d.email_contato],
            ["Privacidade", d.email_privacidade],
          ]}
        />
      </Secao>
    </MolduraLegal>
  );
}
