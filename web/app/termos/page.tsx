import { PaginaLegal, Secao, P, Lista } from "../PaginaLegal";
import { EMPRESA } from "../../lib/empresa";

// Termos de Uso — página pública, sem sessão.
//
// O painel da Meta exige a URL de termos publicados, junto com a política de
// privacidade, para tirar o app do modo Desenvolvimento (§16.6 do CLAUDE.md).
//
// Cuidado ao mexer: esta plataforma tem DOIS públicos com deveres diferentes, e
// o texto trata os dois separadamente de propósito. Quem USA o sistema é a
// equipe interna (seções 2 a 6); quem CONVERSA com a equipe pelo WhatsApp é o
// cliente, que não acessa nada aqui e por isso não pode ser sujeito às mesmas
// obrigações (seção 7). Fundir os dois faria o documento cobrar do cliente
// regras de uso de um sistema que ele nunca abriu.

export const metadata = {
  title: "Termos de Uso — Murano Professional",
  description: "Condições de uso da plataforma de atendimento e relacionamento comercial da Murano Professional.",
};

export default function Termos() {
  return (
    <PaginaLegal
      titulo="Termos de Uso"
      resumo="Condições de uso da plataforma de atendimento e relacionamento comercial da Murano Professional, e do atendimento prestado por ela pelo WhatsApp."
    >
      <Secao titulo="1. O que é esta plataforma">
        <P>
          É o sistema interno de atendimento e relacionamento comercial de <b>{EMPRESA.razaoSocial}</b>,
          CNPJ {EMPRESA.cnpj} ({EMPRESA.nomeFantasia}), disponível em {EMPRESA.site}. Por meio dele nossa
          equipe conversa com clientes pelo WhatsApp, acompanha negociações e consulta o histórico
          comercial.
        </P>
        <P>
          <b>Não é um serviço aberto ao público e não há cadastro para clientes.</b> O acesso é concedido
          individualmente pela Murano Professional a pessoas autorizadas.
        </P>
      </Secao>

      <Secao titulo="2. Quem pode acessar">
        <P>
          Somente colaboradores, representantes e prestadores autorizados pela Murano Professional, com
          conta liberada nominalmente. O acesso é pessoal e intransferível: senhas, contas e sessões não
          podem ser compartilhadas, e cada pessoa responde pelo que é feito sob sua conta.
        </P>
        <P>
          O acesso é concedido enquanto durar o vínculo com a Murano Professional e pode ser suspenso ou
          encerrado a qualquer momento, sem aviso prévio, inclusive por descumprimento destes termos.
        </P>
      </Secao>

      <Secao titulo="3. Uso permitido">
        <P>A plataforma deve ser usada apenas para as atividades de atendimento e relacionamento comercial da empresa. Ao usá-la, o usuário autorizado se compromete a:</P>
        <Lista
          itens={[
            "acessar apenas os dados necessários ao próprio trabalho;",
            "tratar os dados de clientes com confidencialidade, dentro e fora do horário de trabalho;",
            "não copiar, exportar ou transferir a base de clientes para uso pessoal ou de terceiros;",
            "não usar os dados para finalidade estranha à relação comercial da Murano Professional, incluindo oferta de produtos de terceiros;",
            "comunicar imediatamente qualquer suspeita de acesso indevido, perda de dispositivo ou vazamento.",
          ]}
        />
      </Secao>

      <Secao titulo="4. Uso proibido">
        <Lista
          itens={[
            "tentar acessar contas, carteiras ou dados de outros usuários sem autorização;",
            "burlar, testar ou explorar controles de segurança, autenticação ou limites da plataforma;",
            "usar meios automatizados para extrair dados em massa;",
            "enviar, pelos canais da empresa, mensagens ilícitas, enganosas, ofensivas ou não solicitadas em desacordo com as políticas do WhatsApp;",
            "reproduzir, distribuir ou disponibilizar a plataforma, seu código ou seu conteúdo a terceiros.",
          ]}
        />
      </Secao>

      <Secao titulo="5. Conteúdo e propriedade">
        <P>
          O sistema, seu código, sua interface, suas marcas e os dados nele armazenados pertencem à Murano
          Professional. O acesso concedido não transfere nenhum direito de propriedade intelectual, e
          termina com o fim da autorização de uso.
        </P>
      </Secao>

      <Secao titulo="6. Disponibilidade">
        <P>
          A plataforma é fornecida no estado em que se encontra. Trabalhamos para mantê-la disponível e
          correta, mas não garantimos funcionamento ininterrupto: ela depende de serviços de terceiros —
          entre eles o WhatsApp, a hospedagem e o banco de dados — e pode ficar indisponível por manutenção,
          falha ou mudança nesses serviços. Funcionalidades podem ser alteradas ou descontinuadas.
        </P>
      </Secao>

      <Secao titulo="7. Atendimento a clientes pelo WhatsApp">
        <P>
          Se você é <b>cliente</b> e conversa com a Murano Professional pelo WhatsApp, não precisa de conta
          nem de cadastro nesta plataforma — as regras acima são dirigidas a quem opera o sistema. Ao nos
          escrever, vale o seguinte:
        </P>
        <Lista
          itens={[
            "o atendimento é feito por pessoas da nossa equipe comercial, em horário comercial, e as mensagens ficam registradas no histórico do seu atendimento;",
            "preços, prazos e condições informados na conversa valem apenas para o pedido tratado ali e podem mudar até a confirmação;",
            "a conversa não substitui a nota fiscal nem os documentos do pedido, que prevalecem em caso de divergência;",
            "você pode pedir a qualquer momento para parar de receber mensagens promocionais, ou solicitar a exclusão dos seus dados.",
          ]}
        />
        <P>
          O tratamento dos seus dados nessa conversa está descrito na nossa{" "}
          <a href="/privacidade" style={{ fontWeight: 600 }}>Política de Privacidade</a>.
        </P>
      </Secao>

      <Secao titulo="8. Responsabilidade">
        <P>
          A Murano Professional não responde por danos decorrentes do uso indevido da plataforma, de acesso
          feito com credenciais compartilhadas pelo próprio usuário, ou de indisponibilidade de serviços de
          terceiros dos quais a plataforma depende. Isso não afasta as responsabilidades que a lei não
          permite excluir, especialmente as relativas à proteção de dados pessoais.
        </P>
      </Secao>

      <Secao titulo="9. Alterações destes termos">
        <P>
          Estes termos podem ser atualizados a qualquer momento; a data da última revisão fica no topo da
          página. O uso da plataforma após a mudança significa concordância com a versão vigente.
        </P>
      </Secao>

      <Secao titulo="10. Lei aplicável e foro">
        <P>
          Estes termos são regidos pela lei brasileira. Fica eleito o foro da comarca da sede da Murano
          Professional para dirimir controvérsias, salvo quando a lei determinar foro diverso.
        </P>
      </Secao>

      <Secao titulo="11. Contato">
        <P>
          Dúvidas sobre estes termos: <b>{EMPRESA.emailContato}</b>.
        </P>
      </Secao>
    </PaginaLegal>
  );
}
