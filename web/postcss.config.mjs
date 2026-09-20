// PostCSS existe neste projeto só por causa do Tailwind v4, que vive numa tela
// só: /chat-v2 (a reconstrução do chat — prototipos/chat-v2/spec.md).
//
// O plugin só transforma arquivos .css que importam o Tailwind. O resto do CRM
// é estilo inline e não passa por aqui — mas, se alguém criar um .css novo,
// passa. Ver `app/chat-v2/v2.css`: lá o preflight fica de fora de propósito,
// para não resetar as telas antigas.
export default { plugins: { "@tailwindcss/postcss": {} } };
