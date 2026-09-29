import { mergeConfig, type UserConfig } from 'vite';

export default (config: UserConfig) => {
  return mergeConfig(config, {
    server: {
      allowedHosts: ['ba4b4fd928d8.ngrok-free.app'],
    },
  });
};
