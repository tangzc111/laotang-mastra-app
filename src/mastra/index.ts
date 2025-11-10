
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { weatherWorkflow } from './workflows/weather-workflow';
import { createWeatherAgent } from './agents/weather-agent';
import { createSceneScriptAgent } from './agents/scene-script-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import type { RuntimeEnv } from './config/model';
import { createPersistentStore } from './config/storage';

type CreateMastraOptions = {
  env?: RuntimeEnv;
};

export const createMastra = ({ env }: CreateMastraOptions = {}) =>
  new Mastra({
    workflows: { weatherWorkflow },
    agents: {
      weatherAgent: createWeatherAgent(env),
      sceneScriptAgent: createSceneScriptAgent(env),
    },
    scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
    storage: createPersistentStore(env),
    logger: new PinoLogger({
      name: 'Mastra',
      level: 'info',
    }),
    telemetry: {
      // Telemetry is deprecated and will be removed in the Nov 4th release
      enabled: false,
    },
    observability: {
      // Enables DefaultExporter and CloudExporter for AI tracing
      default: { enabled: true },
    },
  });

export const mastra = createMastra();
