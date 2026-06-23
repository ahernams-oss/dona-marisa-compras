import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/extract-price")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { image } = (await request.json()) as { image?: string };
        if (!image || !image.startsWith("data:image")) {
          return new Response(JSON.stringify({ error: "Imagem inválida" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const systemPrompt = `Você analisa fotos de etiquetas de preço de supermercados brasileiros.
Extraia o produto e o preço. Responda APENAS com JSON válido no formato:
{"product_name": "string", "brand": "string|null", "price": number, "unit": "un|kg|g|L|ml"}
- product_name: nome curto do produto (ex: "Arroz Tio João 5kg")
- brand: marca se identificável, senão null
- price: número decimal em reais (ex: 24.90), sem símbolo
- unit: unidade de venda
Se não conseguir ler com confiança, responda {"error":"unreadable"}.`;

        try {
          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Leia esta etiqueta e devolva o JSON pedido." },
                    { type: "image_url", image_url: { url: image } },
                  ],
                },
              ],
              response_format: { type: "json_object" },
            }),
          });

          if (!upstream.ok) {
            const txt = await upstream.text();
            if (upstream.status === 429) {
              return new Response(JSON.stringify({ error: "Muitas leituras agora. Tente em alguns segundos." }), { status: 429, headers: { "Content-Type": "application/json" } });
            }
            if (upstream.status === 402) {
              return new Response(JSON.stringify({ error: "Créditos da IA esgotados." }), { status: 402, headers: { "Content-Type": "application/json" } });
            }
            return new Response(JSON.stringify({ error: "AI gateway error", detail: txt }), { status: 502, headers: { "Content-Type": "application/json" } });
          }

          const json = await upstream.json();
          const content = json?.choices?.[0]?.message?.content ?? "{}";
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(content);
          } catch {
            parsed = { error: "unreadable" };
          }
          return new Response(JSON.stringify(parsed), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
