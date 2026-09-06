// ============================================================
//  LexPost — servidor
//  Detecta sozinho qual IA está configurada no Render:
//   - ANTHROPIC_API_KEY  -> Claude (permite busca real na web)
//   - OPENAI_API_KEY     -> GPT-4o (sem busca na web)
//  O front sempre fala no formato da Anthropic; quando o backend
//  é a OpenAI, este servidor traduz ida e volta. Assim o mesmo
//  index.html funciona nos dois casos, sem risco de descasar.
// ============================================================
const express = require("express"), path = require("path"), app = express();
app.use(express.json({ limit: "2mb" }));

const LEXPOST_VERSAO = "2.4";
const LEXPOST_BUILD  = new Date().toISOString();

const A_KEY = process.env.ANTHROPIC_API_KEY || "";
const O_KEY = process.env.OPENAI_API_KEY || "";
const BACKEND = A_KEY ? "anthropic" : (O_KEY ? "openai" : "nenhum");
const MODELO_A = "claude-sonnet-4-6";
const MODELO_O = "gpt-4o";

console.log("LexPost v" + LEXPOST_VERSAO + " — backend: " + BACKEND);

// Permite que o Sistema de Gestão embuta o LexPost em iframe
const FRAME_ANCESTORS = [
  "'self'",
  "https://martinsefilho.adv.br",
  "https://www.martinsefilho.adv.br",
  "https://app.martinsefilho.adv.br"
].join(" ");
app.use((req, res, next) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors " + FRAME_ANCESTORS);
  next();
});

// Diagnóstico: abrir /versao mostra exatamente qual build está no ar.
app.get("/versao", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.json({
    versao: LEXPOST_VERSAO,
    formato_download: "jpeg",
    backend: BACKEND,
    busca_na_web: BACKEND === "anthropic",
    servidor_iniciado_em: LEXPOST_BUILD
  });
});

app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── Tradutores entre os dois formatos ───────────────────────────
function paraOpenAI(body) {
  const msgs = [];
  if (body.system) msgs.push({ role: "system", content: body.system });
  (body.messages || []).forEach(m => msgs.push({ role: m.role, content: m.content }));
  const out = { model: MODELO_O, messages: msgs };
  if (body.max_tokens) out.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) out.temperature = body.temperature;
  return out;
}
function daOpenAI(d) {
  const txt = (d && d.choices && d.choices[0] && d.choices[0].message)
    ? (d.choices[0].message.content || "") : "";
  return { content: [{ type: "text", text: txt }] };
}
async function chamarIA(body) {
  if (BACKEND === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": A_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(Object.assign({}, body, { model: MODELO_A }))
    });
    return { status: r.status, data: await r.json() };
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + O_KEY },
    body: JSON.stringify(paraOpenAI(body))
  });
  const d = await r.json();
  if (d && d.error) return { status: r.status || 500, data: { error: d.error } };
  return { status: r.status, data: daOpenAI(d) };
}

// ── Geração dos carrosséis ──────────────────────────────────────
app.post("/api/generate", async (req, res) => {
  if (BACKEND === "nenhum")
    return res.status(500).json({ error: { message: "Nenhuma chave de IA configurada no Render." } });

  // Leitura de link só funciona com busca na web (Claude).
  if (req.body && req.body.tools && BACKEND !== "anthropic") {
    return res.status(501).json({
      error: { message: "Ler notícia por link exige a chave da Anthropic (busca na web)." }
    });
  }
  try {
    const r = await chamarIA(req.body);
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

// ── Temas em alta ───────────────────────────────────────────────
app.get("/api/trending-themes", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (BACKEND === "nenhum")
    return res.json({ success: false, temas: [], erro: "Nenhuma chave de IA configurada." });

  const h = new Date();
  const dataHoje = String(h.getDate()).padStart(2, "0") + "/" + String(h.getMonth() + 1).padStart(2, "0") + "/" + h.getFullYear();
  const diaSemana = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"][h.getDay()];
  const comBusca = BACKEND === "anthropic";

  // Com busca: exige conferir o status atual de cada tema.
  // Sem busca: proíbe qualquer afirmação de status legislativo, porque
  // foi exatamente daí que saiu a sugestão da PEC já votada.
  const prompt = comBusca
    ? ("Hoje é " + diaSemana + ", " + dataHoje + ".\n\n" +
       "Você é o pauteiro de um escritório de advocacia trabalhista em Brasília.\n\n" +
       "OBRIGATÓRIO: use a ferramenta de busca na web ANTES de responder. Faça no mínimo 3 buscas " +
       "sobre notícias trabalhistas e previdenciárias brasileiras das últimas 3 semanas " +
       "(TST, STF, INSS, Congresso, novas súmulas).\n\n" +
       "REGRA DURA: nunca descreva como 'em tramitação', 'em discussão' ou 'em votação' algo que já foi " +
       "votado, aprovado, rejeitado ou arquivado — confira o status atual na busca. Se o status mudou, " +
       "o ângulo deve ser o status NOVO. Não cite número de lei, PEC ou súmula sem ter confirmado.\n\n" +
       "Retorne APENAS JSON válido:\n" +
       '{"temas":[{"titulo":"máx 70 chars","relevancia":"alta","area":"trabalhista","fonte":"domínio","checado":"o que a busca confirmou, 1 frase"}]}\n\n')
    : ("Hoje é " + diaSemana + ", " + dataHoje + ".\n\n" +
       "Você é o pauteiro de um escritório de advocacia trabalhista em Brasília.\n\n" +
       "ATENÇÃO: você NÃO tem acesso à internet e não sabe o que aconteceu recentemente. " +
       "Por isso é PROIBIDO citar status legislativo: nada de 'em tramitação', 'em votação', " +
       "'nova lei', 'recém-aprovado', número de PEC, de lei ou de súmula. " +
       "Sugira apenas temas permanentes do dia a dia do trabalhador, que valem em qualquer época " +
       "(ex.: horas extras, justa causa, FGTS, rescisão indireta, assédio, INSS).\n\n" +
       "Retorne APENAS JSON válido:\n" +
       '{"temas":[{"titulo":"máx 70 chars","relevancia":"alta","area":"trabalhista"}]}\n\n');

  const regras = "Regras: exatamente 8 temas; mínimo 3 trabalhista, mínimo 2 previdenciário, mínimo 1 cotidiano; " +
    "relevância 'alta' ou 'media'; área 'trabalhista', 'previdenciario' ou 'cotidiano'; " +
    "títulos formulados como TEMA de carrossel.";

  try {
    const corpo = {
      max_tokens: 4000,
      system: "Você responde apenas com JSON válido. Nunca afirma status legislativo sem ter conferido.",
      messages: [{ role: "user", content: prompt + regras }]
    };
    if (comBusca) corpo.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }];

    const r = await chamarIA(corpo);
    const d = r.data;
    if (d && d.error) throw new Error(d.error.message || "erro da API");
    const raw = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    let parsed = null;
    try { parsed = JSON.parse(raw); }
    catch (_) { const m = raw.match(/\{[\s\S]*\}/); if (m) try { parsed = JSON.parse(m[0]); } catch (_) {} }
    if (!parsed || !parsed.temas || !parsed.temas.length) throw new Error("Formato inválido");

    // Rede de segurança: descarta tema que fale em status sem checagem.
    const suspeito = /em tramita|em discuss|em vota|rec[eé]m|nova lei|\bpec\b/i;
    const temas = parsed.temas.filter(t => t && t.titulo && !(suspeito.test(t.titulo) && !t.checado));
    if (!temas.length) throw new Error("Nenhum tema confirmado");

    res.json({ success: true, temas, comBusca, geradoEm: new Date().toISOString() });
  } catch (err) {
    console.error("[trending-themes]", err.message);
    // Sem lista fixa de reserva: uma lista velha é pior do que nenhuma.
    res.json({ success: false, temas: [], comBusca, erro: "Não consegui confirmar os temas agora." });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("LexPost pronto"));
