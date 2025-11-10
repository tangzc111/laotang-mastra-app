import { InMemoryStore } from '@mastra/core/storage';
import { LibSQLStore } from '@mastra/libsql';
import type { RuntimeEnv } from './model';

const isNodeRuntime = typeof process !== 'undefined' && process.release?.name === 'node';

const SUPPORTED_REMOTE_PROTOCOL = /^(libsql|https?|wss?):/;

const canUseUrl = (url?: string) => {
  if (!url) return false;
  if (url.startsWith('file:')) {
    return isNodeRuntime;
  }
  return SUPPORTED_REMOTE_PROTOCOL.test(url);
};

type LibSQLConfig = {
  url: string;
  authToken?: string;
};

const resolveLibSQLConfig = (env?: RuntimeEnv): LibSQLConfig | null => {
  if (canUseUrl(env?.LIBSQL_URL)) {
    return {
      url: env!.LIBSQL_URL as string,
      authToken: env?.LIBSQL_AUTH_TOKEN,
    };
  }

  if (!env?.LIBSQL_URL && isNodeRuntime) {
    return { url: 'file:../mastra.db' };
  }

  return null;
};

export const createPersistentStore = (env?: RuntimeEnv) => {
  const libsqlConfig = resolveLibSQLConfig(env);

  if (libsqlConfig) {
    return new LibSQLStore({
      url: libsqlConfig.url,
      ...(libsqlConfig.authToken ? { authToken: libsqlConfig.authToken } : {}),
    });
  }

  return new InMemoryStore();
};
