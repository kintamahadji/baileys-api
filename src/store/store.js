import * as handlers from "./handlers/index.js";

export class Store {
	/**
	 *
	 * @param {String} sessionId
	 * @param {import('@whiskeysockets/baileys').BaileysEventEmitter} event
	 */
	constructor(sessionId, event) {
		this.chatHandler = handlers.chatHandler(sessionId, event);
		this.messageHandler = handlers.messageHandler(sessionId, event);
		this.contactHandler = handlers.contactHandler(sessionId, event);
		this.groupMetadataHandler = handlers.groupMetadataHandler(sessionId, event);
		this.listen();
	}

	listen() {
		this.chatHandler.listen();
		this.messageHandler.listen();
		this.contactHandler.listen();
		this.groupMetadataHandler.listen();
	}

	unlisten() {
		this.chatHandler.unlisten();
		this.messageHandler.unlisten();
		this.contactHandler.unlisten();
		this.groupMetadataHandler.unlisten();
	}
}
