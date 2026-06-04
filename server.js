const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// A chave da OpenAI vem da variável de ambiente (configurada no Render)
// Nunca coloque a chave direto no código que vai para o GitHub
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// Função auxiliar para chamar a OpenAI
function callOpenAI(payload, callback) {
  if (!OPENAI_API_KEY) {
    return callback(new Error("Chave da OpenAI não configurada."), null);
  }

  const body = JSON.stringify(payload);
  const options = {
    hostname: "api.openai.com",
    path: "/v1/chat/completions",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const req = https.request(options, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => callback(null, { status: res.statusCode, body: data }));
  });

  req.on("error", (err) => callback(err, null));
  req.write(body);
  req.end();
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /api/generate → OpenAI ─────────────────────────
  if (req.method === "POST" && req.url === "/api/generate") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        // Força sempre gpt-4o
        payload.model = "gpt-4o";

        callOpenAI(payload, (err, result) => {
          if (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: err.message } }));
            return;
          }
          res.writeHead(result.status, { "Content-Type": "application/json" });
          res.end(result.body);
        });
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Requisição inválida: " + err.message } }));
      }
    });
    return;
  }

  // ── GET /api/trending-themes → OpenAI ───────────────────
  if (req.method === "GET" && req.url === "/api/trending-themes") {
    const hoje = new Date().toLocaleDateString("pt-BR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const payload = {
      model: "gpt-4o",
      max_tokens: 400,
      messages: [
        { role: "system", content: "Retorne APENAS JSON valido. Sem markdown." },
        {
          role: "user",
          content: `Hoje é ${hoje}. Liste 6 temas juridicos trabalhistas ou previdenciarios em alta no Brasil agora. JSON: {"temas":["tema1","tema2","tema3","tema4","tema5","tema6"]}`,
        },
      ],
    };

    callOpenAI(payload, (err, result) => {
      if (err) {
        res.writeHead(500);
        res.end("{}");
        return;
      }
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(result.body);
    });
    return;
  }

  // ── Servir arquivos estáticos ────────────────────────────
  let filePath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  filePath = path.join(__dirname, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve o index.html para qualquer rota não encontrada
      fs.readFile(path.join(__dirname, "index.html"), (err2, data2) => {
        if (err2) {
          res.writeHead(404);
          res.end("Não encontrado");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`LexPost rodando na porta ${PORT}`);
  if (!OPENAI_API_KEY) {
    console.warn("AVISO: Variável OPENAI_API_KEY não configurada!");
  }
});
