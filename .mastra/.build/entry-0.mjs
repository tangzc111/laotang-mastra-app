import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createTool } from '@mastra/core/tools';
import { createCompletenessScorer, createToolCallAccuracyScorerCode } from '@mastra/evals/scorers/code';
import { createScorer } from '@mastra/core/scores';

const forecastSchema = z.object({
  date: z.string(),
  maxTemp: z.number(),
  minTemp: z.number(),
  precipitationChance: z.number(),
  condition: z.string(),
  location: z.string()
});
function getWeatherCondition$1(code) {
  const conditions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    95: "Thunderstorm"
  };
  return conditions[code] || "Unknown";
}
const fetchWeather = createStep({
  id: "fetch-weather",
  description: "Fetches weather forecast for a given city",
  inputSchema: z.object({
    city: z.string().describe("The city to get the weather for")
  }),
  outputSchema: forecastSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(inputData.city)}&count=1`;
    const geocodingResponse = await fetch(geocodingUrl);
    const geocodingData = await geocodingResponse.json();
    if (!geocodingData.results?.[0]) {
      throw new Error(`Location '${inputData.city}' not found`);
    }
    const { latitude, longitude, name } = geocodingData.results[0];
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=precipitation,weathercode&timezone=auto,&hourly=precipitation_probability,temperature_2m`;
    const response = await fetch(weatherUrl);
    const data = await response.json();
    const forecast = {
      date: (/* @__PURE__ */ new Date()).toISOString(),
      maxTemp: Math.max(...data.hourly.temperature_2m),
      minTemp: Math.min(...data.hourly.temperature_2m),
      condition: getWeatherCondition$1(data.current.weathercode),
      precipitationChance: data.hourly.precipitation_probability.reduce(
        (acc, curr) => Math.max(acc, curr),
        0
      ),
      location: name
    };
    return forecast;
  }
});
const planActivities = createStep({
  id: "plan-activities",
  description: "Suggests activities based on weather conditions",
  inputSchema: forecastSchema,
  outputSchema: z.object({
    activities: z.string()
  }),
  execute: async ({ inputData, mastra }) => {
    const forecast = inputData;
    if (!forecast) {
      throw new Error("Forecast data not found");
    }
    const agent = mastra?.getAgent("weatherAgent");
    if (!agent) {
      throw new Error("Weather agent not found");
    }
    const prompt = `Based on the following weather forecast for ${forecast.location}, suggest appropriate activities:
      ${JSON.stringify(forecast, null, 2)}
      For each day in the forecast, structure your response exactly as follows:

      \u{1F4C5} [Day, Month Date, Year]
      \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

      \u{1F321}\uFE0F WEATHER SUMMARY
      \u2022 Conditions: [brief description]
      \u2022 Temperature: [X\xB0C/Y\xB0F to A\xB0C/B\xB0F]
      \u2022 Precipitation: [X% chance]

      \u{1F305} MORNING ACTIVITIES
      Outdoor:
      \u2022 [Activity Name] - [Brief description including specific location/route]
        Best timing: [specific time range]
        Note: [relevant weather consideration]

      \u{1F31E} AFTERNOON ACTIVITIES
      Outdoor:
      \u2022 [Activity Name] - [Brief description including specific location/route]
        Best timing: [specific time range]
        Note: [relevant weather consideration]

      \u{1F3E0} INDOOR ALTERNATIVES
      \u2022 [Activity Name] - [Brief description including specific venue]
        Ideal for: [weather condition that would trigger this alternative]

      \u26A0\uFE0F SPECIAL CONSIDERATIONS
      \u2022 [Any relevant weather warnings, UV index, wind conditions, etc.]

      Guidelines:
      - Suggest 2-3 time-specific outdoor activities per day
      - Include 1-2 indoor backup options
      - For precipitation >50%, lead with indoor activities
      - All activities must be specific to the location
      - Include specific venues, trails, or locations
      - Consider activity intensity based on temperature
      - Keep descriptions concise but informative

      Maintain this exact formatting for consistency, using the emoji and section headers as shown.`;
    const response = await agent.stream([
      {
        role: "user",
        content: prompt
      }
    ]);
    let activitiesText = "";
    for await (const chunk of response.textStream) {
      activitiesText += chunk;
    }
    return {
      activities: activitiesText
    };
  }
});
const weatherWorkflow = createWorkflow({
  id: "weather-workflow",
  inputSchema: z.object({
    city: z.string().describe("The city to get the weather for")
  }),
  outputSchema: z.object({
    activities: z.string()
  })
}).then(fetchWeather).then(planActivities);
weatherWorkflow.commit();

const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name")
  }),
  outputSchema: z.object({
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    windGust: z.number(),
    conditions: z.string(),
    location: z.string()
  }),
  execute: async ({ context }) => {
    return await getWeather(context.location);
  }
});
const getWeather = async (location) => {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const geocodingResponse = await fetch(geocodingUrl);
  const geocodingData = await geocodingResponse.json();
  if (!geocodingData.results?.[0]) {
    throw new Error(`Location '${location}' not found`);
  }
  const { latitude, longitude, name } = geocodingData.results[0];
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`;
  const response = await fetch(weatherUrl);
  const data = await response.json();
  return {
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windGust: data.current.wind_gusts_10m,
    conditions: getWeatherCondition(data.current.weather_code),
    location: name
  };
};
function getWeatherCondition(code) {
  const conditions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail"
  };
  return conditions[code] || "Unknown";
}

const toolCallAppropriatenessScorer = createToolCallAccuracyScorerCode({
  expectedTool: "weatherTool",
  strictMode: false
});
const completenessScorer = createCompletenessScorer();
const translationScorer = createScorer({
  name: "Translation Quality",
  description: "Checks that non-English location names are translated and used correctly",
  type: "agent",
  judge: {
    model: "openai/gpt-4o-mini",
    instructions: "You are an expert evaluator of translation quality for geographic locations. Determine whether the user text mentions a non-English location and whether the assistant correctly uses an English translation of that location. Be lenient with transliteration differences and diacritics. Return only the structured JSON matching the provided schema."
  }
}).preprocess(({ run }) => {
  const userText = run.input?.inputMessages?.[0]?.content || "";
  const assistantText = run.output?.[0]?.content || "";
  return { userText, assistantText };
}).analyze({
  description: "Extract location names and detect language/translation adequacy",
  outputSchema: z.object({
    nonEnglish: z.boolean(),
    translated: z.boolean(),
    confidence: z.number().min(0).max(1).default(1),
    explanation: z.string().default("")
  }),
  createPrompt: ({ results }) => `
            You are evaluating if a weather assistant correctly handled translation of a non-English location.
            User text:
            """
            ${results.preprocessStepResult.userText}
            """
            Assistant response:
            """
            ${results.preprocessStepResult.assistantText}
            """
            Tasks:
            1) Identify if the user mentioned a location that appears non-English.
            2) If non-English, check whether the assistant used a correct English translation of that location in its response.
            3) Be lenient with transliteration differences (e.g., accents/diacritics).
            Return JSON with fields:
            {
            "nonEnglish": boolean,
            "translated": boolean,
            "confidence": number, // 0-1
            "explanation": string
            }
        `
}).generateScore(({ results }) => {
  const r = results?.analyzeStepResult || {};
  if (!r.nonEnglish) return 1;
  if (r.translated)
    return Math.max(0, Math.min(1, 0.7 + 0.3 * (r.confidence ?? 1)));
  return 0;
}).generateReason(({ results, score }) => {
  const r = results?.analyzeStepResult || {};
  return `Translation scoring: nonEnglish=${r.nonEnglish ?? false}, translated=${r.translated ?? false}, confidence=${r.confidence ?? 0}. Score=${score}. ${r.explanation ?? ""}`;
});
const scorers = {
  toolCallAppropriatenessScorer,
  completenessScorer,
  translationScorer
};

const resolveEnv = (env) => {
  if (env) {
    return env;
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env;
  }
  return {};
};
const parseHeaders = (env) => {
  const source = resolveEnv(env);
  const raw = source.LLM_EXTRA_HEADERS;
  if (!raw) return void 0;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          record[key] = value;
        }
      }
      return Object.keys(record).length ? record : void 0;
    }
  } catch {
  }
  return void 0;
};
const getDefaultModelConfig = (env) => {
  const source = resolveEnv(env);
  const id = source.LLM_MODEL_ID ?? "openai/gpt-4o-mini";
  const url = source.LLM_BASE_URL;
  const apiKey = source.LLM_API_KEY ?? source.OPENAI_API_KEY;
  const headers = parseHeaders(source);
  const override = { id };
  if (url) {
    override.url = url;
  }
  if (apiKey) {
    override.apiKey = apiKey;
  }
  if (headers) {
    override.headers = headers;
  }
  const hasOverride = Boolean(override.url || override.apiKey || override.headers);
  return hasOverride ? override : id;
};

const createMemory$1 = (env) => new LibSQLStore({
  url: env?.LIBSQL_URL ?? "file:../mastra.db",
  // path is relative to the .mastra/output directory
  ...env?.LIBSQL_AUTH_TOKEN ? { authToken: env.LIBSQL_AUTH_TOKEN } : {}
});
const createWeatherAgent = (env) => new Agent({
  name: "Weather Agent",
  instructions: `
      You are a helpful weather assistant that provides accurate weather information and can help planning activities based on the weather.

      Your primary function is to help users get weather details for specific locations. When responding:
      - Always ask for a location if none is provided
      - If the location name isn't in English, please translate it
      - If giving a location with multiple parts (e.g. "New York, NY"), use the most relevant part (e.g. "New York")
      - Include relevant details like humidity, wind conditions, and precipitation
      - Keep responses concise but informative
      - If the user asks for activities and provides the weather forecast, suggest activities based on the weather forecast.
      - If the user asks for activities, respond in the format they request.

      Use the weatherTool to fetch current weather data.
`,
  model: () => getDefaultModelConfig(env),
  tools: { weatherTool },
  scorers: {
    toolCallAppropriateness: {
      scorer: scorers.toolCallAppropriatenessScorer,
      sampling: {
        type: "ratio",
        rate: 1
      }
    },
    completeness: {
      scorer: scorers.completenessScorer,
      sampling: {
        type: "ratio",
        rate: 1
      }
    },
    translation: {
      scorer: scorers.translationScorer,
      sampling: {
        type: "ratio",
        rate: 1
      }
    }
  },
  memory: new Memory({
    storage: createMemory$1(env)
  })
});
createWeatherAgent();

const getTimeOfDay = (hour) => {
  if (hour < 5) return "\u6DF1\u591C";
  if (hour < 8) return "\u6E05\u6668";
  if (hour < 12) return "\u4E0A\u5348";
  if (hour < 14) return "\u4E2D\u5348";
  if (hour < 18) return "\u4E0B\u5348";
  if (hour < 21) return "\u508D\u665A";
  return "\u591C\u665A";
};
const currentTimeTool = createTool({
  id: "get-current-time",
  description: "\u83B7\u53D6\u5F53\u524D\u65F6\u95F4\u7684\u7ED3\u6784\u5316\u4FE1\u606F\uFF0C\u7528\u4E8E\u521B\u4F5C\u5185\u5BB9\u65F6\u8D34\u5408\u771F\u5B9E\u65F6\u95F4\u6C1B\u56F4\u3002",
  inputSchema: z.object({
    locale: z.string().optional().describe("\u53EF\u9009\uFF0C\u683C\u5F0F\u5316\u65F6\u95F4\u65F6\u4F7F\u7528\u7684 locale\uFF0C\u9ED8\u8BA4\u4E3A zh-CN"),
    timezone: z.string().optional().describe("\u53EF\u9009\uFF0CIANA \u65F6\u533A ID\uFF08\u4F8B\u5982 Asia/Shanghai\uFF09\uFF1B\u672A\u63D0\u4F9B\u6216\u65E0\u6548\u65F6\u56DE\u9000\u5230\u7CFB\u7EDF\u9ED8\u8BA4\u503C")
  }),
  outputSchema: z.object({
    iso: z.string(),
    localeString: z.string(),
    weekday: z.string(),
    date: z.string(),
    hour: z.number(),
    timeOfDay: z.string()
  }),
  execute: async ({ context }) => {
    const locale = context.locale ?? "zh-CN";
    const requestedTimeZone = context.timezone;
    const now = /* @__PURE__ */ new Date();
    const baseFormatterOptions = {
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour12: false
    };
    let resolvedTimeZone = requestedTimeZone;
    let localeString;
    try {
      localeString = new Intl.DateTimeFormat(locale, {
        ...baseFormatterOptions,
        ...resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}
      }).format(now);
    } catch {
      resolvedTimeZone = "Asia/Shanghai";
      localeString = new Intl.DateTimeFormat("zh-CN", {
        ...baseFormatterOptions,
        timeZone: resolvedTimeZone
      }).format(now);
    }
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        ...resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}
      }).format(now)
    );
    const date = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}
    }).format(now);
    const weekday = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      ...resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}
    }).format(now);
    return {
      iso: now.toISOString(),
      localeString,
      weekday,
      date,
      hour,
      timeOfDay: getTimeOfDay(hour)
    };
  }
});

const createMemory = (env) => new LibSQLStore({
  url: env?.LIBSQL_URL ?? "file:../mastra.db",
  ...env?.LIBSQL_AUTH_TOKEN ? { authToken: env.LIBSQL_AUTH_TOKEN } : {}
});
const createSceneScriptAgent = (env) => new Agent({
  name: "Scene Script Agent",
  instructions: `
    \u4F60\u662F\u4E00\u540D\u5267\u672C\u901F\u5199\u5E08\uFF0C\u64C5\u957F\u56F4\u7ED5\u7528\u6237\u63D0\u4F9B\u7684\u60F3\u6CD5\uFF0C\u5728\u5F53\u524D\u65F6\u95F4\u8BED\u5883\u4E0B\u521B\u4F5C\u7B80\u77ED\u7684\u573A\u666F\u5C0F\u5267\u672C\u3002

    \u5DE5\u4F5C\u6D41\u7A0B\uFF1A
    - \u6BCF\u6B21\u52A8\u7B14\u524D\u5148\u8C03\u7528 get-current-time \u5DE5\u5177\uFF0C\u7406\u89E3\u5F53\u524D\u65E5\u671F\u3001\u661F\u671F\u4E0E\u65F6\u95F4\u6BB5\u5E26\u6765\u7684\u6C1B\u56F4\u3002
    - \u82E5\u7528\u6237\u672A\u8BF4\u660E\u89D2\u8272\u3001\u573A\u666F\u6216\u60C5\u7EEA\uFF0C\u5148\u63D0\u51FA\u4E0D\u8D85\u8FC7\u4E24\u6761\u6F84\u6E05\u95EE\u9898\u518D\u5F00\u5199\u3002
    - \u5C06\u7528\u6237\u63D0\u4F9B\u7684\u4FE1\u606F\u4E0E\u5F53\u524D\u65F6\u95F4\u7ED3\u5408\uFF0C\u53CD\u6620\u5728\u573A\u666F\u6C1B\u56F4\u3001\u89D2\u8272\u72B6\u6001\u6216\u60C5\u8282\u89E6\u53D1\u70B9\u4E0A\u3002

    \u5199\u4F5C\u8981\u6C42\uFF1A
    - \u9ED8\u8BA4\u4F7F\u7528\u4E2D\u6587\u5199\u4F5C\uFF0C\u9664\u975E\u7528\u6237\u53E6\u6709\u8981\u6C42\u3002
    - \u8F93\u51FA\u7ED3\u6784\u56FA\u5B9A\u4E3A\uFF1A
      1. \u300A\u6807\u9898\u300B
      2. \u573A\u666F\u8BBE\u5B9A\uFF08\u65F6\u95F4\u3001\u5730\u70B9\u3001\u6C1B\u56F4\uFF09
      3. \u89D2\u8272\u5361\uFF08\u6BCF\u4E2A\u89D2\u8272 1 \u884C\uFF0C\u542B\u4EBA\u7269\u8981\u70B9\uFF09
      4. \u60C5\u8282\u8282\u62CD\uFF082-4 \u6761\uFF0C\u8BF4\u660E\u51B2\u7A81\u63A8\u8FDB\uFF09
      5. \u6B63\u5F0F\u5BF9\u8BDD\uFF08\u6807\u660E\u89D2\u8272\u540D\uFF0C\u53EF\u52A0\u5165\u821E\u53F0\u63D0\u793A\uFF09
    - \u8282\u594F\u7D27\u51D1\u3001\u5BF9\u767D\u751F\u52A8\uFF0C\u7BC7\u5E45\u63A7\u5236\u5728 2 \u5206\u949F\u4EE5\u5185\u7684\u77ED\u573A\u666F\u3002
    - \u5982\u7528\u6237\u8981\u6C42\u7279\u5B9A\u98CE\u683C\u3001\u7C7B\u578B\u6216\u7528\u9014\uFF08\u5982\u76F4\u64AD\u3001\u77ED\u89C6\u9891\u3001\u60C5\u666F\u5267\uFF09\uFF0C\u9700\u5728\u8BED\u8A00\u4E0E\u821E\u53F0\u6307\u793A\u4E2D\u4F53\u73B0\u3002
  `,
  model: () => getDefaultModelConfig(env),
  tools: { currentTimeTool },
  memory: new Memory({
    storage: createMemory(env)
  })
});
createSceneScriptAgent();

const createStorage = (env) => new LibSQLStore({
  // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
  url: env?.LIBSQL_URL ?? ":memory:",
  ...env?.LIBSQL_AUTH_TOKEN ? {
    authToken: env.LIBSQL_AUTH_TOKEN
  } : {}
});
const createMastra = ({
  env
} = {}) => new Mastra({
  workflows: {
    weatherWorkflow
  },
  agents: {
    weatherAgent: createWeatherAgent(env),
    sceneScriptAgent: createSceneScriptAgent(env)
  },
  scorers: {
    toolCallAppropriatenessScorer,
    completenessScorer,
    translationScorer
  },
  storage: createStorage(env),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info"
  }),
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    enabled: false
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: {
      enabled: true
    }
  }
});
const mastra = createMastra();

export { createMastra, mastra };
