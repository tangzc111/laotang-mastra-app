import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

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

export { currentTimeTool };
