import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const getTimeOfDay = (hour: number) => {
  if (hour < 5) return '深夜';
  if (hour < 8) return '清晨';
  if (hour < 12) return '上午';
  if (hour < 14) return '中午';
  if (hour < 18) return '下午';
  if (hour < 21) return '傍晚';
  return '夜晚';
};

export const currentTimeTool = createTool({
  id: 'get-current-time',
  description: '获取当前时间的结构化信息，用于创作内容时贴合真实时间氛围。',
  inputSchema: z.object({
    locale: z.string().optional().describe('可选，格式化时间时使用的 locale，默认为 zh-CN'),
    timezone: z
      .string()
      .optional()
      .describe('可选，IANA 时区 ID（例如 Asia/Shanghai）；未提供或无效时回退到系统默认值'),
  }),
  outputSchema: z.object({
    iso: z.string(),
    localeString: z.string(),
    weekday: z.string(),
    date: z.string(),
    hour: z.number(),
    timeOfDay: z.string(),
  }),
  execute: async ({ context }) => {
    const locale = context.locale ?? 'zh-CN';
    const requestedTimeZone = context.timezone;

    const now = new Date();

    const baseFormatterOptions: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour12: false,
    };

    let resolvedTimeZone = requestedTimeZone;
    let localeString: string;

    try {
      localeString = new Intl.DateTimeFormat(locale, {
        ...baseFormatterOptions,
        ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
      }).format(now);
    } catch {
      resolvedTimeZone = 'Asia/Shanghai';
      localeString = new Intl.DateTimeFormat('zh-CN', {
        ...baseFormatterOptions,
        timeZone: resolvedTimeZone,
      }).format(now);
    }

    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
      }).format(now),
    );

    const date = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
    }).format(now);

    const weekday = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
    }).format(now);

    return {
      iso: now.toISOString(),
      localeString,
      weekday,
      date,
      hour,
      timeOfDay: getTimeOfDay(hour),
    };
  },
});
