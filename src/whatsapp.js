import makeWASocket, {
	DisconnectReason,
	isJidBroadcast,
	makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { Store, useSession } from "./store/index.js";
import { prisma } from "./db.js";
import { logger } from "./shared.js";
import { toDataURL } from "qrcode";
import { delay } from "./utils.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * @typedef {Object} Session
 * @property {WASocket} socket - Objek WASocket
 * @property {() => Promise<void>} destroy - Fungsi untuk menghancurkan sesi
 * @property {Store} store - Objek Store
 */

const sessions = new Map();
const retries = new Map();
const SSEQRGenerations = new Map();

const RECONNECT_INTERVAL = Number(process.env.RECONNECT_INTERVAL || 0);
const MAX_RECONNECT_RETRIES = Number(process.env.MAX_RECONNECT_RETRIES || 5);
const SSE_MAX_QR_GENERATION = Number(process.env.SSE_MAX_QR_GENERATION || 5);
const SESSION_CONFIG_ID = "session-config";

export async function init() {
	const sessions = await prisma.session.findMany({
		select: { sessionId: true, data: true },
		where: { id: { startsWith: SESSION_CONFIG_ID } },
	});

	for (const { sessionId, data } of sessions) {
		const { readIncomingMessages, ...socketConfig } = JSON.parse(data);
		createSession({ sessionId, readIncomingMessages, socketConfig });
	}
}

/**
 *
 * @param {String} sessionId
 * @returns
 */
function shouldReconnect(sessionId) {
	let attempts = retries.get(sessionId) ?? 0;

	if (attempts < MAX_RECONNECT_RETRIES) {
		attempts += 1;
		retries.set(sessionId, attempts);
		return true;
	}

	return false;
}

/**
 *
 * @typedef {Object} createSessionOptions
 * @property {String} sessionId
 * @property {import("express").Response} res
 * @property {Boolean} SSE
 * @property {Boolean} readIncomingMessages
 * @property {import("@whiskeysockets/baileys").SocketConfig} socketConfig
 */

/**
 *
 * @param {createSessionOptions} options
 */
export async function createSession(options) {
	const { sessionId, res, SSE = false, readIncomingMessages = false, socketConfig } = options;
	const configID = `${SESSION_CONFIG_ID}-${sessionId}`;
	let connectionState = { connection: "close" };

	const destroy = async (logout = true) => {
		try {
			await Promise.all([
				logout && socket.logout(),
				prisma.chat.deleteMany({ where: { sessionId } }),
				prisma.contact.deleteMany({ where: { sessionId } }),
				prisma.message.deleteMany({ where: { sessionId } }),
				prisma.groupMetadata.deleteMany({ where: { sessionId } }),
				prisma.session.deleteMany({ where: { sessionId } }),
			]);
			logger.info({ session: sessionId }, "Session destroyed");
		} catch (e) {
			logger.error(e, "An error occured during session destroy");
		} finally {
			sessions.delete(sessionId);
		}
	};

	const handleConnectionClose = () => {
		const code = connectionState.lastDisconnect?.error?.output?.statusCode;
		const restartRequired = code === DisconnectReason.restartRequired;
		const doNotReconnect = !shouldReconnect(sessionId);

		if (code === DisconnectReason.loggedOut || doNotReconnect) {
			if (res) {
				!SSE && !res.headersSent && res.status(500).json({ error: "Unable to create session" });
				res.end();
			}

			destroy(doNotReconnect);
			return;
		}

		if (!restartRequired) {
			logger.info({ attempts: retries.get(sessionId) ?? 1, sessionId }, "Reconnecting...");
		}

		setTimeout(
			() => {
				return createSession(options);
			},
			restartRequired ? 0 : RECONNECT_INTERVAL,
		);
	};

	const handleNormalConnectionUpdate = async () => {
		if (connectionState.qr?.length) {
			if (res && !res.headersSent) {
				try {
					const qr = await toDataURL(connectionState.qr);
					res.status(200).json({ qr });
					return;
				} catch (e) {
					logger.error(e, "An error occured during QR generation");
					res.status(500).json({ error: "Unable to generate QR" });
				}
			}

			destroy();
		}
	};

	const handleSSEConnectionUpdate = async () => {
		let qr;
		if (connectionState.qr?.length) {
			try {
				qr = await toDataURL(connectionState.qr);
			} catch (e) {
				logger.error(e, "An error occured during QR generation");
			}
		}

		const currentGenerations = SSEQRGenerations.get(sessionId) ?? 0;
		if (!res || res.writableEnded || (qr && currentGenerations >= SSE_MAX_QR_GENERATION)) {
			res && !res.writableEnded && res.end();
			destroy();
			return;
		}

		const data = { ...connectionState, qr };
		if (qr) {
			SSEQRGenerations.set(sessionId, currentGenerations + 1);
		}

		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	const handleConnectionUpdate = SSE ? handleSSEConnectionUpdate : handleNormalConnectionUpdate;
	const { state, saveCreds } = await useSession(sessionId);
	const socket = makeWASocket.default({
		printQRInTerminal: true,
		browser: [process.env.NAME_BOT_BROWSER || "Whatsapp Bot", "Chrome", "3.0"],
		generateHighQualityLinkPreview: true,
		...socketConfig,
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		logger,
		shouldIgnoreJid(jid) {
			return isJidBroadcast(jid);
		},
		async getMessage(key) {
			const data = await prisma.message.findFirst({
				where: { remoteJid: key.remoteJid, id: key.id, sessionId },
			});
			return data?.message || undefined;
		},
	});

	const store = new Store(sessionId, socket.ev);
	sessions.set(sessionId, { ...socket, destroy, store });

	socket.ev.on("creds.update", saveCreds);
	socket.ev.on("connection.update", (update) => {
		connectionState = update;
		const { connection } = update;

		if (connection === "open") {
			retries.delete(sessionId);
			SSEQRGenerations.delete(sessionId);
		}

		if (connection === "close") {
			handleConnectionClose();
		}

		handleConnectionUpdate();
	});

	if (readIncomingMessages) {
		socket.ev.on("messages.upsert", async (m) => {
			const message = m.messages[0];
			if (message.key.fromMe || m.type !== "notify") {
				return;
			}

			await delay(1000);
			await socket.readMessages([message.key]);
		});
	}

	// Debug events
	// socket.ev.on("messaging-history.set", (data) => dump("messaging-history.set", data));
	// socket.ev.on("chats.upsert", (data) => dump("chats.upsert", data));
	// socket.ev.on("contacts.update", (data) => dump("contacts.update", data));
	// socket.ev.on("groups.upsert", (data) => dump("groups.upsert", data));

	await prisma.session.upsert({
		create: {
			id: configID,
			sessionId,
			data: JSON.stringify({ readIncomingMessages, ...socketConfig }),
		},
		update: {},
		where: { sessionId_id: { id: configID, sessionId } },
	});
}

/**
 *
 * @param {Session} session
 * @returns
 */
export function getSessionStatus(session) {
	const state = ["CONNECTING", "CONNECTED", "DISCONNECTING", "DISCONNECTED"];
	let status = state[session.ws.readyState];
	status = session.user ? "AUTHENTICATED" : status;
	return status;
}

export function listSessions() {
	return Array.from(sessions.entries()).map(([id, session]) => {
		return {
			id,
			status: getSessionStatus(session),
		};
	});
}

/**
 *
 * @param {String} sessionId
 * @returns
 */
export function getSession(sessionId) {
	return sessions.get(sessionId);
}

/**
 *
 * @param {String} sessionId
 * @returns
 */
export async function deleteSession(sessionId) {
	sessions.get(sessionId)?.destroy();
}

/**
 *
 * @param {String} sessionId
 * @returns
 */
export function sessionExists(sessionId) {
	return sessions.has(sessionId);
}

/**
 *
 * @param {Session} session
 * @param {String} jid
 * @param {"group" | "number"} type
 * @returns
 */
export async function jidExists(session, jid, type = "number") {
	try {
		if (type === "number") {
			const [result] = await session.onWhatsApp(jid);
			return Boolean(result?.exists);
		}

		const groupMeta = await session.groupMetadata(jid);
		return Boolean(groupMeta.id);
	} catch (e) {
		return Promise.reject(e);
	}
}
