// Plugin Manager for Tiiextension - Handles discovery, loading, and lifecycle of web LLM plugins
import { storage } from './browser-polyfill.js';

const PLUGIN_STORAGE_KEY = "webLLMPlugins:v1";
const PLUGINS_DIR = "plugins/"; // Relative to extension root

export class PluginManager {
  constructor() {
    this.plugins = new Map(); // pluginId => pluginInstance
    this.pluginConfigs = new Map(); // pluginId => config
  }

  // Discover available plugins by checking the plugins directory
  async discoverPlugins() {
    try {
      // In a real implementation, we would fetch the plugin list from a manifest
      // For now, we'll return a predefined list of known plugins
      return [
        { id: "chatgpt-web", name: "ChatGPT Web", src: "plugins/chatgpt-web-plugin.js" },
        { id: "claude-web", name: "Claude Web", src: "plugins/claude-web-plugin.js" },
        { id: "gemini-web", name: "Gemini Web", src: "plugins/gemini-web-plugin.js" }
      ];
    } catch (error) {
      console.error('Failed to discover plugins:', error);
      return [];
    }
  }

  // Load a plugin by its source URL
  async loadPlugin(pluginInfo) {
    try {
      // Check if plugin is already loaded
      if (this.plugins.has(pluginInfo.id)) {
        return this.plugins.get(pluginInfo.id);
      }

      // Dynamically import the plugin module
      const pluginModule = await import(pluginInfo.src);
      
      // Assume the plugin exports a default class that extends BasePlugin
      const PluginClass = pluginModule.default || pluginModule;
      
      // Create an instance of the plugin
      const pluginInstance = new PluginClass();
      
      // Initialize the plugin
      await pluginInstance.initialize(this.getPluginConfig(pluginInfo.id));
      
      // Store the plugin instance
      this.plugins.set(pluginInfo.id, pluginInstance);
      
      return pluginInstance;
    } catch (error) {
      console.error(`Failed to load plugin ${pluginInfo.id}:`, error);
      throw error;
    }
  }

  // Get a plugin by ID
  getPlugin(pluginId) {
    return this.plugins.get(pluginId);
  }

  // Get all loaded plugins
  getAllPlugins() {
    return Array.from(this.plugins.values());
  }

  // Save plugin configuration
  async savePluginConfig(pluginId, config) {
    this.pluginConfigs.set(pluginId, config);
    
    // Persist to storage
    const stored = await storage.local.get(PLUGIN_STORAGE_KEY);
    const pluginsConfig = stored[PLUGIN_STORAGE_KEY] || {};
    pluginsConfig[pluginId] = config;
    await storage.local.set({ [PLUGIN_STORAGE_KEY]: pluginsConfig });
  }

  // Get plugin configuration
  getPluginConfig(pluginId) {
    // First check in-memory cache
    if (this.pluginConfigs.has(pluginId)) {
      return this.pluginConfigs.get(pluginId);
    }
    
    // Then check storage
    // This would be implemented in a real scenario
    return {};
  }

  // Initialize a plugin (load if not already loaded)
  async initializePlugin(pluginId) {
    // Discover plugins if we haven't already
    const pluginInfo = await this.getPluginInfoById(pluginId);
    if (!pluginInfo) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }
    
    return await this.loadPlugin(pluginInfo);
  }

  // Get plugin info by ID (from discovered plugins)
  async getPluginInfoById(pluginId) {
    const plugins = await this.discoverPlugins();
    return plugins.find(p => p.id === pluginId) || null;
  }

  // Unload a plugin
  async unloadPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      try {
        await plugin.dispose();
      } catch (error) {
        console.error(`Error disposing plugin ${pluginId}:`, error);
      }
      
      this.plugins.delete(pluginId);
      this.pluginConfigs.delete(pluginId);
    }
  }

  // Unload all plugins
  async unloadAllPlugins() {
    for (const [pluginId, plugin] of this.plugins) {
      try {
        await plugin.dispose();
      } catch (error) {
        console.error(`Error disposing plugin ${pluginId}:`, error);
      }
    }
    
    this.plugins.clear();
    this.pluginConfigs.clear();
  }
}

// Create a singleton instance
export const pluginManager = new PluginManager();