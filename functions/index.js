import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";

const freeLlmApiUrl = defineSecret("FREELLM_API_URL");
const freeLlmApiKey = defineSecret("FREELLM_API_KEY");

function validMessages(value) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-16)
    .filter(
      (message) =>
        message &&
        ["system", "user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
    )
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 12_000),
    }));
}

export const onlineAssist = onRequest(
  {
    region: "us-central1",
    cors: true,
    secrets: [freeLlmApiUrl, freeLlmApiKey],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "POST requests only." });
      return;
    }

    const messages = validMessages(request.body?.messages);

    if (!messages.length) {
      response.status(400).json({ error: "A chat message is required." });
      return;
    }

    try {
      const upstream = await fetch(freeLlmApiUrl.value(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${freeLlmApiKey.value()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.FREELLM_MODEL || "auto:smart",
          messages,
          temperature: 0.7,
          max_tokens: 512,
          stream: false,
        }),
      });

      const result = await upstream.json().catch(() => null);

      if (!upstream.ok) {
        logger.warn("FreeLLM request failed", { status: upstream.status });
        response.status(502).json({
          error: "Online Assist is temporarily unavailable.",
        });
        return;
      }

      const content = result?.choices?.[0]?.message?.content?.trim();

      if (!content) {
        logger.warn("FreeLLM returned no chat content");
        response.status(502).json({
          error: "Online Assist returned no answer.",
        });
        return;
      }

      response.json({ content });
    } catch (error) {
      logger.error("Online Assist request failed", error);
      response.status(502).json({
        error: "Online Assist could not reach the configured service.",
      });
    }
  }
);
