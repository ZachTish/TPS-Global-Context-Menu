import { Notice } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { HomeActionContext, HomeActionProvider, HomeComponentAction } from '../types';
import {
  routeHomeComponentAction,
  type HomeActionHandler,
} from './home-component-action-core';
import * as logger from '../logger';

export const HOME_CAPTURE_COMMAND_ID = 'tps-global-context-menu:capture-to-home-note';
export const HOME_ADD_TASK_COMMAND_ID = 'tps-global-context-menu:add-task-to-home-note';

export class HomeComponentActionService {
  private readonly handlers = new Map<string, HomeActionHandler>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  register(commandId: string, handler: HomeActionHandler): () => void {
    const id = String(commandId || '').trim();
    if (!id) throw new Error('Home action command ID is required.');
    this.handlers.set(id, handler);
    return () => {
      if (this.handlers.get(id) === handler) this.handlers.delete(id);
    };
  }

  canExecute(action: HomeComponentAction): boolean {
    const commandId = String(action.commandId || '').trim();
    if (!commandId) return false;
    if (action.target === 'workspace') return this.hasCommand(commandId);
    if (this.handlers.has(commandId)) return true;
    return this.getProviders().some((provider) => {
      try {
        return provider.canHandle(commandId);
      } catch {
        return false;
      }
    });
  }

  async execute(action: HomeComponentAction, context: HomeActionContext): Promise<boolean> {
    logger.flow('HomeAction', 'execute:requested', {
      commandId: action.commandId,
      target: action.target,
      componentId: context.componentId,
      dateIso: context.dateIso,
      dailyNotePath: context.dailyNotePath,
      basePath: context.basePath || null,
    });
    try {
      const result = await routeHomeComponentAction(action, context, {
        getRegisteredHandler: (commandId) => this.handlers.get(commandId) || null,
        getProviders: () => this.getProviders(),
        executeWorkspaceCommand: (commandId) => this.executeWorkspaceCommand(commandId),
      });
      if (result.status === 'unavailable') {
        logger.flowWarn('HomeAction', 'execute:unavailable', {
          commandId: action.commandId,
          target: action.target,
          componentId: context.componentId,
        });
        new Notice(
          action.target === 'home-note'
            ? 'This command does not support the selected Home Daily Note. Edit the action and choose Run normally if that is intentional.'
            : 'That command is not available.',
          8000,
        );
        return false;
      }
      logger.flow('HomeAction', 'execute:handled', {
        commandId: action.commandId,
        target: action.target,
        route: result.route,
        dailyNotePath: context.dailyNotePath,
      });
      return true;
    } catch (error) {
      logger.flowError('HomeAction', 'execute:failed', error, {
        commandId: action.commandId,
        target: action.target,
        componentId: context.componentId,
        dailyNotePath: context.dailyNotePath,
      });
      new Notice(error instanceof Error ? error.message : 'Home action failed.', 10000);
      return false;
    }
  }

  private getProviders(): HomeActionProvider[] {
    const plugins = (this.plugin.app as any)?.plugins?.plugins;
    if (!plugins || typeof plugins !== 'object') return [];
    const providers: HomeActionProvider[] = [];
    const seen = new Set<unknown>();
    for (const loadedPlugin of Object.values(plugins) as any[]) {
      const provider = loadedPlugin?.api?.homeActions || loadedPlugin?.homeActions;
      if (!provider || seen.has(provider)) continue;
      if (typeof provider.canHandle !== 'function' || typeof provider.execute !== 'function') continue;
      seen.add(provider);
      providers.push(provider as HomeActionProvider);
    }
    return providers;
  }

  private hasCommand(commandId: string): boolean {
    const commands = (this.plugin.app as any)?.commands;
    if (typeof commands?.findCommand === 'function') return Boolean(commands.findCommand(commandId));
    return Boolean(commands?.commands?.[commandId]);
  }

  private async executeWorkspaceCommand(commandId: string): Promise<boolean> {
    const commands = (this.plugin.app as any)?.commands;
    if (typeof commands?.executeCommandById !== 'function' || !this.hasCommand(commandId)) return false;
    const result = await commands.executeCommandById(commandId);
    return result !== false;
  }
}
