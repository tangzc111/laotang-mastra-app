import { z, ZodError } from "zod";
import type { MessageListInput } from "@mastra/core/agent/message-list";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { currentTimeTool } from "./mastra/tools/time-tool";
import { getDefaultModelConfig, type RuntimeEnv } from "./mastra/config/model";
import { createPersistentStore } from "./mastra/config/storage";

type AgentEnv = RuntimeEnv;

export const createSceneScriptAgent = (env?: AgentEnv) =>
  new Agent({
    name: "Scene Script Agent",
    instructions: `
    你是一名剧本速写师，擅长围绕用户提供的想法，在当前时间语境下创作简短的场景小剧本。

    工作流程：
    - 每次动笔前先调用 get-current-time 工具，理解当前日期、星期与时间段带来的氛围。
    - 若用户未说明角色、场景或情绪，先提出不超过两条澄清问题再开写。
    - 将用户提供的信息与当前时间结合，反映在场景氛围、角色状态或情节触发点上。

    写作要求：
    - 默认使用中文写作，除非用户另有要求。
    - 输出结构固定为：
      1. 《标题》
      2. 场景设定（时间、地点、氛围）
      3. 角色卡（每个角色 1 行，含人物要点）
      4. 情节节拍（2-4 条，说明冲突推进）
      5. 正式对话（标明角色名，可加入舞台提示）
    - 节奏紧凑、对白生动，篇幅控制在 2 分钟以内的短场景。
    - 如用户要求特定风格、类型或用途（如直播、短视频、情景剧），需在语言与舞台指示中体现。
  `,
    model: () => getDefaultModelConfig(env),
    tools: { currentTimeTool },
    memory: new Memory({
      storage: createPersistentStore(env),
    }),
  });

type WorkerEnvBindings = {
  LLM_MODEL_ID?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LLM_EXTRA_HEADERS?: string;
  LIBSQL_URL?: string;
  LIBSQL_AUTH_TOKEN?: string;
};

type Bindings = WorkerEnvBindings;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const jsonResponse = (data: unknown, init: number | ResponseInit = 200) => {
  const base: ResponseInit =
    typeof init === "number"
      ? { status: init }
      : {
          status: init.status ?? 200,
          headers: init.headers,
        };

  const headers = new Headers(base.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(data), {
    ...base,
    headers,
  });
};

const buildRuntimeEnv = (env: Bindings): RuntimeEnv => ({
  LLM_MODEL_ID: env.LLM_MODEL_ID,
  LLM_BASE_URL: env.LLM_BASE_URL,
  LLM_API_KEY: env.LLM_API_KEY,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  LLM_EXTRA_HEADERS: env.LLM_EXTRA_HEADERS,
  LIBSQL_URL: env.LIBSQL_URL,
  LIBSQL_AUTH_TOKEN: env.LIBSQL_AUTH_TOKEN,
});

const serializeEnv = (env: RuntimeEnv) => {
  const sortedEntries = Object.entries(env)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return JSON.stringify(Object.fromEntries(sortedEntries));
};

type MastraModule = typeof import("./mastra");

let mastraModulePromise: Promise<MastraModule> | null = null;
const loadMastraModule = () => {
  if (!mastraModulePromise) {
    mastraModulePromise = import("./mastra");
  }
  return mastraModulePromise;
};

let cachedEnvSignature: string | null = null;
let cachedMastraPromise: Promise<
  ReturnType<MastraModule["createMastra"]>
> | null = null;

const getMastra = async (env: Bindings) => {
  const runtimeEnv = buildRuntimeEnv(env);
  const signature = serializeEnv(runtimeEnv);

  if (
    !cachedEnvSignature ||
    cachedEnvSignature !== signature ||
    !cachedMastraPromise
  ) {
    cachedMastraPromise = loadMastraModule().then(({ createMastra }) =>
      createMastra({ env: runtimeEnv })
    );
    cachedEnvSignature = signature;
  }

  return cachedMastraPromise;
};

const sceneScriptSchema = z
  .object({
    prompt: z.string().min(1).max(4000).optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().min(1),
        })
      )
      .optional(),
    threadId: z.string().optional(),
    resourceId: z.string().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.prompt) || (value.messages && value.messages.length > 0),
    { message: "Provide either prompt or messages." }
  );

const weatherSchema = z.object({
  prompt: z.string().min(1).max(4000),
});

const handleSceneScript = async (request: Request, env: Bindings) => {
  const body = await request.json();
  const input = sceneScriptSchema.parse(body);

  // const mastra = await getMastra(env);
  // 检查环境变量
  if (!env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: corsHeaders }
    );
  }

  // 设置 OpenAI API Key
  process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
  const agent = createSceneScriptAgent();

  if (!agent) {
    return jsonResponse(
      { error: "Scene Script agent is not configured." },
      500
    );
  }

  const messages: MessageListInput = input.messages
    ? (input.messages as MessageListInput)
    : ([{ role: "user" as const, content: input.prompt! }] as MessageListInput);

  const output = await agent.generate(messages, {
    memory: input.threadId
      ? {
          thread: input.threadId,
          resource: input.resourceId ?? "scene-script",
        }
      : undefined,
  });

  const [text, usage, finishReason] = await Promise.all([
    output.text,
    output.usage,
    output.finishReason,
  ]);

  return jsonResponse({
    text,
    usage,
    finishReason,
  });
};

const handleWeather = async (request: Request, env: Bindings) => {
  const body = await request.json();
  const input = weatherSchema.parse(body);

  const mastra = await getMastra(env);
  const agent = mastra.getAgent("weatherAgent");

  if (!agent) {
    return jsonResponse({ error: "Weather agent is not configured." }, 500);
  }

  const output = await agent.generate([
    {
      role: "user",
      content: input.prompt,
    },
  ]);

  const [text, usage, finishReason] = await Promise.all([
    output.text,
    output.usage,
    output.finishReason,
  ]);

  return jsonResponse({
    text,
    usage,
    finishReason,
  });
};

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({
        ok: true,
        message: "Mastra worker is running",
      });
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/scene-script") {
        return await handleSceneScript(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/weather") {
        return await handleWeather(request, env);
      }
    } catch (error) {
      if (error instanceof ZodError) {
        return jsonResponse(
          {
            error: "Invalid request payload",
            issues: error.flatten(),
          },
          400
        );
      }

      if (error instanceof SyntaxError) {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      console.error("Worker error", error);
      return jsonResponse({ error: "Internal Server Error" }, 500);
    }

    return jsonResponse({ error: "Not Found" }, 404);
  },
};
