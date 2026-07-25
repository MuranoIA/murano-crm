import Link from "next/link";

export const metadata = { title: "Relatórios — CRM" };

// Placeholder — só o nome por enquanto (conteúdo a definir).
export default function Relatorios() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#142138" }}>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 0.2 }}>Relatórios</div>
      <div style={{ color: "#7d8695", fontSize: 14 }}>em breve</div>
      <Link href="/" style={{ color: "#0ea3dc", fontSize: 13, textDecoration: "none", marginTop: 6 }}>← voltar ao funil</Link>
    </div>
  );
}
