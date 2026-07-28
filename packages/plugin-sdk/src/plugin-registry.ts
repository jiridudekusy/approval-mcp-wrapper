import type {
  ApprovalPlugin,
  PluginCallDescription,
  PluginCallInput,
} from './contracts.js';
import { createGenericDescription } from './generic-plugin.js';
import { validatePluginDescription } from './validate-output.js';

export interface PluginPin {
  id: string;
  version: string;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, ApprovalPlugin>();

  public constructor(plugins: readonly ApprovalPlugin[]) {
    for (const plugin of plugins) {
      const key = this.key({ id: plugin.id, version: plugin.version });
      if (this.plugins.has(key)) {
        throw new Error(`Duplicate plugin registration: ${key}`);
      }
      this.plugins.set(key, plugin);
    }
  }

  public async describe(
    pin: PluginPin,
    input: PluginCallInput,
  ): Promise<PluginCallDescription> {
    const plugin = this.plugins.get(this.key(pin));
    if (plugin === undefined) {
      return createGenericDescription(input, 'plugin.not_found');
    }
    try {
      const description = validatePluginDescription(await plugin.describe(input));
      return {
        ...description,
        source: 'plugin',
      };
    } catch {
      return createGenericDescription(input, 'plugin.failed');
    }
  }

  private key(pin: PluginPin): string {
    return `${pin.id}@${pin.version}`;
  }
}
