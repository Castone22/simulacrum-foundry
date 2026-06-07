import { SimulacrumError } from '../utils/errors.js';
import { ConversationCommands } from './conversation-commands.js';
import { createLogger } from '../utils/logger.js';
import { processMessageForDisplay } from './sidebar-state-syncer.js';
// Assuming SimulacrumCore will be the main entry point for AI processing
// and will be defined later in simulacrum.js or a dedicated core file.
// For now, we'll mock its existence or assume it's globally available in FoundryVTT context.
// CHAT_MESSAGE_TYPES was renamed CHAT_MESSAGE_STYLES in v13.331+; v14 keeps both
// available but the new name is canonical. Fall through so this works on v13–v14.
const CHAT_STYLES =
  (typeof CONST !== 'undefined' && (CONST.CHAT_MESSAGE_STYLES ?? CONST.CHAT_MESSAGE_TYPES)) || {};

const SimulacrumCore = window.SimulacrumCore || {
  processMessage: async message => ({
    display: `AI Core not initialized. Message: "${message}"`,
    content: `AI Core not initialized. Message: "${message}"`,
  }),
};

/**
 * @class ChatInterface
 * @description Manages the integration of the AI assistant with FoundryVTT's chat interface.
 *              Registers chat commands and displays AI responses.
 */
class ChatInterface {
  /**
   * Initializes the chat interface by registering commands and hooks.
   */
  static init() {
    const logger = createLogger('ChatInterface');
    logger.info('Initializing Chat Interface...');
    // Register chat commands like /sim or /simulacrum
    Hooks.on('chatCommandsReady', ChatInterface._registerChatCommands);
    // Hook into chat message rendering to add CSS classes. v14 introduced
    // `renderChatMessageHTML` which passes an HTMLElement (and v14 still
    // fires the legacy `renderChatMessage` with a jQuery wrapper, but with
    // a deprecation warning). Prefer the new hook when available, fall back
    // to the legacy one for v13.
    if (
      'renderChatMessageHTML' in (Hooks.events ?? {}) ||
      foundry.utils?.isNewerVersion?.(game.version, '13.330')
    ) {
      Hooks.on('renderChatMessageHTML', ChatInterface._onRenderChatMessageHTML);
    } else {
      Hooks.on('renderChatMessage', ChatInterface._onRenderChatMessage);
    }
  }

  /**
   * Registers chat commands for the AI assistant.
   * @param {ChatCommands} chatCommands - The ChatCommands API instance.
   * @private
   */
  static _registerChatCommands(chatCommands) {
    const logger = createLogger('ChatInterface');
    chatCommands.register({
      name: 'sim',
      alias: 'simulacrum',
      hint: 'Interact with the Simulacrum AI Assistant.',
      gmOnly: false,
      handler: (chatlog, messageText) => ChatInterface.processChatCommand(messageText, game.user),
      description: 'Send a message to the Simulacrum AI Assistant.',
    });
    logger.info('Chat commands registered.');
  }

  /**
   * Processes a chat command sent to the AI assistant.
   * @param {string} messageText - The text of the chat message.
   * @param {User} user - The FoundryVTT User who sent the message.
   * @returns {Promise<void>}
   */
  static async processChatCommand(messageText, user) {
    try {
      // Check if it's a conversation command first
      if (typeof SimulacrumCore !== 'undefined' && SimulacrumCore.conversationManager) {
        const commandResult = await ConversationCommands.handleConversationCommand(
          messageText,
          SimulacrumCore.conversationManager
        );

        if (commandResult.isCommand) {
          // Display command result directly in chat
          ChatMessage.create({
            author: user.id,
            content: commandResult.message,
            style: CHAT_STYLES.OTHER ?? 0,
            speaker: { alias: 'Simulacrum AI' },
            flags: { simulacrum: { commandResponse: true, success: commandResult.success } },
          });
          return;
        }
      }

      // Display user's message in chat immediately
      ChatMessage.create({
        author: user.id,
        content: `**To Simulacrum:** ${messageText}`,
        style: CHAT_STYLES.OTHER ?? 0,
        speaker: ChatMessage.getSpeaker({ user: user }),
        flags: { simulacrum: { userMessage: true } },
      });

      // Process the message with the AI core
      const response = await SimulacrumCore.processMessage(messageText, user);
      await ChatInterface.displayResponse(response, user);
    } catch (error) {
      const logger = createLogger('ChatInterface');
      logger.error('Error processing chat command:', error);
      ChatInterface.displayErrorResponse(error, user);
    }
  }

  /**
   * Displays the AI's response in the chat.
   * @param {object} response - The AI's response object (must contain a 'display' property).
   * @param {User} user - The FoundryVTT User to attribute the message to.
   */
  static async displayResponse(response, user) {
    // Process markdown and enrichment before display
    const processedDisplay = await processMessageForDisplay(response.display);

    ChatMessage.create({
      author: user.id,
      content: processedDisplay,
      style: CHAT_STYLES.OTHER ?? 0,
      speaker: { alias: 'Simulacrum AI' }, // AI's speaker
      flags: { simulacrum: { aiGenerated: true } },
    });
  }

  /**
   * Displays an error message from the AI assistant in the chat.
   * @param {Error} error - The error object.
   * @param {User} user - The FoundryVTT User to attribute the message to.
   */
  static displayErrorResponse(error, user) {
    const errorMessage =
      error instanceof SimulacrumError
        ? `Simulacrum Error (${error.type}): ${error.message}`
        : `An unexpected error occurred: ${error.message}`;

    ChatMessage.create({
      author: user.id,
      content: `**Simulacrum Error:** ${errorMessage}`,
      style: CHAT_STYLES.OOC ?? 1,
      speaker: { alias: 'Simulacrum AI' },
      flags: { simulacrum: { aiError: true } },
    });
  }

  /**
   * Hook function for rendering chat messages. Can be used for custom styling or interactions.
   * @param {ChatMessage} message - The chat message being rendered.
   * @param {JQuery} html - The jQuery object for the chat message HTML.
   * @param {object} data - Additional rendering data.
   * @private
   */
  static _onRenderChatMessage(message, html) {
    // Legacy v13 hook — `html` is a jQuery wrapper.
    if (message.flags?.simulacrum?.aiGenerated) {
      html.addClass('simulacrum-ai-message');
    }
    if (message.flags?.simulacrum?.userMessage) {
      html.addClass('simulacrum-user-message');
    }
    if (message.flags?.simulacrum?.aiError) {
      html.addClass('simulacrum-ai-error-message');
    }
  }

  /**
   * v14 chat-message render hook. `html` is a real HTMLElement.
   * @param {ChatMessage} message
   * @param {HTMLElement} html
   * @private
   */
  static _onRenderChatMessageHTML(message, html) {
    if (message.flags?.simulacrum?.aiGenerated) {
      html.classList.add('simulacrum-ai-message');
    }
    if (message.flags?.simulacrum?.userMessage) {
      html.classList.add('simulacrum-user-message');
    }
    if (message.flags?.simulacrum?.aiError) {
      html.classList.add('simulacrum-ai-error-message');
    }
  }
}

export { ChatInterface };
