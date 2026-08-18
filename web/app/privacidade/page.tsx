import { MolduraLegal, Secao, P, Lista, Dados, Destaque } from "../legal";
import { lerDadosLegais, dataPorExtenso, identificacao } from "../../lib/paginasLegais";

// Página PÚBLICA. Sem login, sem cookie, sem dado de cliente.
// O texto mora aqui (versionado, revisável em PR); os dados da empresa vêm de
// `paginas_legais` (migration 0088), editáveis em /admin sem deploy.
//
// force-dynamic porque uma correção de CNPJ ou de e-mail precisa aparecer na
// hora: se isto ficasse em cache estático, o admin salvaria a correção e a
// página seguiria mostrando o valor antigo — o pior tipo de bug numa página que
// existe justamente para dizer a verdade sobre o tratamento de dados.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Política de Privacidade — Murano Professional",
  description:
    "Como a Murano Professional trata os dados pessoais de quem é atendido pelos nossos canais, incluindo WhatsApp.",
};

export default async function Privacidade() {
  const d = await lerDadosLegais();
  const quem = identificacao(d);
  const contatoPrivacidade = d.email_privacidade || d.email_contato;
  const enderecoCompleto = [d.endereco, d.cidade_uf, d.cep].filter(Boolean).join(" — ");

  return (
    <MolduraLegal
      titulo="Política de Privacidade"
      resumo="Esta página explica quais dados pessoais coletamos no atendimento, por que os coletamos, com quem os compartilhamos e como você pede acesso ou exclusão."
      vigencia={dataPorExtenso(d.vigencia)}
      outra={{ href: "/termos", texto: "Ler os Termos de Uso" }}
    >
      <Secao n={1} titulo="Quem trata os seus dados">
        <P>
          O responsável pelo tratamento dos dados descritos nesta política é {quem}, adiante
          chamada apenas de Murano.
        </P>
        <Dados
          linhas={[
            ["Razão social", d.razao_social],
            ["CNPJ", d.cnpj],
            ["Endereço", enderecoCompleto],
            ["Telefone", d.telefone],
            ["WhatsApp", d.whatsapp],
            ["E-mail", d.email_contato],
          ]}
        />
        <P>
          Para assuntos de privacidade e proteção de dados usamos um canal específico — ele está
          na seção 9.
        </P>
      </Secao>

      <Secao n={2} titulo="A que este documento se aplica">
        <P>
          Aplica-se ao atendimento comercial que a Murano presta por WhatsApp, telefone e e-mail,
          e ao sistema interno que a nossa equipe usa para registrar esse atendimento. Não se
          aplica ao WhatsApp em si: a troca de mensagens acontece dentro da plataforma da Meta,
          que tem política própria.
        </P>
      </Secao>

      <Secao n={3} titulo="Quais dados coletamos">
        <P>Coletamos apenas o que o atendimento exige:</P>
        <Lista
          itens={[
            <>
              <b>Identificação e contato</b> — nome, telefone, e-mail, CPF ou CNPJ e endereço,
              informados por você ou já constantes do seu cadastro de cliente.
            </>,
            <>
              <b>Conteúdo do atendimento</b> — as mensagens trocadas com a nossa equipe, incluindo
              fotos, áudios, vídeos e documentos que você envia.
            </>,
            <>
              <b>Registros técnicos das mensagens</b> — data e hora de envio, entrega e leitura, e
              por qual número o contato aconteceu.
            </>,
            <>
              <b>Registros de chamadas</b> — quando a ligação acontece pelo WhatsApp, guardamos
              data, hora, duração e o desfecho anotado pelo atendente.{" "}
              <b>Não gravamos o áudio das ligações.</b>
            </>,
            <>
              <b>Histórico comercial</b> — pedidos, notas fiscais e devoluções já existentes no
              nosso sistema de gestão.
            </>,
          ]}
        />
        <P>
          Não coletamos dados sensíveis (origem racial, convicção religiosa, opinião política,
          saúde, biometria) e pedimos que você também não os envie pelo atendimento.
        </P>
      </Secao>

      <Secao n={4} titulo="Por que usamos esses dados e com que base legal">
        <Lista
          itens={[
            <>
              <b>Atender você e processar pedidos</b> — responder mensagens, orçar, registrar
              pedido, combinar pagamento e entrega. Base: execução de contrato e de procedimentos
              preliminares (LGPD, art. 7º, V).
            </>,
            <>
              <b>Manter o histórico do relacionamento</b> — para que qualquer atendente saiba o que
              já foi conversado e você não precise repetir tudo. Base: legítimo interesse
              (art. 7º, IX).
            </>,
            <>
              <b>Cumprir obrigações legais e fiscais</b> — emissão de nota, guarda de documentos e
              prestação de contas. Base: obrigação legal (art. 7º, II).
            </>,
            <>
              <b>Enviar ofertas e novidades</b> — comunicações comerciais por WhatsApp. Base:
              consentimento ou legítimo interesse de relacionamento com cliente, sempre com
              possibilidade de recusa (seção 8).
            </>,
            <>
              <b>Medir a qualidade do atendimento</b> — indicadores internos como tempo de resposta
              e volume, usados para gerir a equipe. Base: legítimo interesse (art. 7º, IX).
            </>,
          ]}
        />
        <P>
          Não vendemos, alugamos nem cedemos dados pessoais para terceiros usarem em publicidade
          própria.
        </P>
      </Secao>

      <Secao n={5} titulo="Com quem compartilhamos">
        <P>
          Compartilhamos apenas com quem é necessário para o serviço funcionar, e sempre limitado à
          finalidade descrita:
        </P>
        <Lista
          itens={[
            <>
              <b>Meta Platforms</b> — provedora do WhatsApp, por onde as mensagens trafegam.
            </>,
            <>
              <b>RD Station Conversas (Tallos)</b> — plataforma de atendimento que ainda usamos em
              parte dos nossos números.
            </>,
            <>
              <b>Provedores de infraestrutura</b> — serviços de banco de dados e de hospedagem que
              armazenam e servem o sistema, sob contrato e sem uso próprio dos dados.
            </>,
            <>
              <b>Operadores de entrega e obrigações fiscais</b> — quando o atendimento vira pedido,
              os dados necessários à nota e à entrega seguem para quem executa cada etapa.
            </>,
            <>
              <b>Autoridades públicas</b> — quando houver requisição legal.
            </>,
          ]}
        />
        <P>
          Parte desses provedores processa dados fora do Brasil. Nesses casos a transferência
          internacional ocorre com as garantias previstas nos arts. 33 e seguintes da LGPD.
        </P>
      </Secao>

      <Secao n={6} titulo="Como protegemos">
        <Lista
          itens={[
            "O sistema de atendimento é fechado: só entra quem tem conta autorizada pela empresa, e cada vendedor enxerga a própria carteira de clientes.",
            "As chaves de acesso ao banco ficam apenas no servidor — nunca no navegador de quem usa o sistema.",
            "Fotos, áudios e documentos ficam em armazenamento privado, acessíveis só por link temporário gerado para quem está autorizado.",
            "O banco de dados bloqueia leitura por chaves públicas: nenhum acesso anônimo alcança as tabelas de clientes e de mensagens.",
          ]}
        />
        <P>
          Nenhuma medida elimina o risco por completo. Se ocorrer incidente de segurança relevante,
          comunicaremos você e a Autoridade Nacional de Proteção de Dados, como manda o art. 48 da
          LGPD.
        </P>
      </Secao>

      <Secao n={7} titulo="Por quanto tempo guardamos">
        <P>
          Mantemos o histórico de atendimento por até <b>{d.retencao_meses} meses</b> contados do
          último contato, prazo que sustenta o relacionamento comercial e a defesa de eventuais
          questionamentos. Documentos fiscais são guardados pelo prazo que a legislação exigir,
          ainda que maior. Encerrados os prazos, os dados são eliminados ou anonimizados.
        </P>
      </Secao>

      <Secao n={8} titulo="Seus direitos" id="direitos">
        <P>O art. 18 da LGPD garante a você, a qualquer momento e sem custo:</P>
        <Lista
          itens={[
            "confirmar se tratamos dados seus e obter acesso a eles;",
            "corrigir dados incompletos, inexatos ou desatualizados;",
            "pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados fora da lei;",
            "solicitar a portabilidade a outro fornecedor;",
            "revogar o consentimento e pedir a eliminação dos dados tratados com base nele;",
            "opor-se a tratamento feito com base em legítimo interesse;",
            "saber com quem compartilhamos seus dados.",
          ]}
        />
        <Destaque>
          <b>Para parar de receber mensagens comerciais</b>, basta responder no próprio WhatsApp
          pedindo para não receber mais, ou escrever para o contato da seção 9. Registramos o
          pedido e interrompemos os envios. O atendimento sobre pedidos em andamento continua
          normalmente.
        </Destaque>
      </Secao>

      <Secao n={9} titulo="Como pedir — inclusive a exclusão dos seus dados" id="exclusao-de-dados">
        <P>
          Fale pelo canal abaixo dizendo o que você quer (acesso, correção, exclusão, portabilidade
          ou parar de receber mensagens) e informe o nome e o telefone usados no atendimento, para
          conseguirmos localizar o cadastro.
        </P>
        <Dados
          linhas={[
            ["Encarregado", d.encarregado],
            ["E-mail", contatoPrivacidade],
            ["WhatsApp", d.whatsapp],
            ["Endereço", enderecoCompleto],
          ]}
        />
        <P>
          Respondemos em até 15 dias. Antes de atender, podemos pedir uma confirmação de identidade
          — é o que impede que outra pessoa peça a exclusão dos seus dados.
        </P>
        <P>
          <b>O que a exclusão apaga:</b> seu cadastro de contato e o histórico de conversas, com as
          respectivas fotos, áudios e documentos. <b>O que permanece:</b> notas fiscais e registros
          contábeis que a lei nos obriga a guardar, e dados já anonimizados usados em estatísticas,
          que não identificam mais ninguém.
        </P>
      </Secao>

      <Secao n={10} titulo="Cookies">
        <P>
          Esta página não usa cookies de rastreamento nem de publicidade. O sistema interno de
          atendimento usa um cookie de sessão apenas para manter o colaborador conectado — ele não
          alcança quem apenas lê esta política.
        </P>
      </Secao>

      <Secao n={11} titulo="Crianças e adolescentes">
        <P>
          Nosso atendimento é dirigido a profissionais e empresas. Não coletamos intencionalmente
          dados de menores de 18 anos. Se identificarmos um cadastro nessa condição, ele é
          eliminado.
        </P>
      </Secao>

      <Secao n={12} titulo="Mudanças nesta política">
        <P>
          Quando esta política mudar, publicamos a nova versão aqui mesmo, com nova data de
          vigência no topo. Alterações relevantes são avisadas pelos nossos canais de atendimento.
        </P>
      </Secao>
    </MolduraLegal>
  );
}
