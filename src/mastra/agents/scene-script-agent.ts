import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { currentTimeTool } from '../tools/time-tool';
import { getDefaultModelConfig, type RuntimeEnv } from '../config/model';
import { createPersistentStore } from '../config/storage';

type AgentEnv = RuntimeEnv;

export const createSceneScriptAgent = (env?: AgentEnv) =>
  new Agent({
    name: 'Scene Script Agent',
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

export const sceneScriptAgent = createSceneScriptAgent();
