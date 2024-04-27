import { jidNormalizedUser, toNumber } from "@whiskeysockets/baileys";
import { transformPrisma } from "../utils.js";
import { prisma } from "../../db.js";
import { logger } from "../../shared.js";

/**
 *
 * @param {import("@whiskeysockets/baileys").WAMessageKey | undefined | null} key
 * @returns
 */
const getKeyAuthor = (key) => {
	return (key?.fromMe ? "me" : key?.participant || key?.remoteJid) || "";
};

/**
 *
 * @param {String} sessionId
 * @param {import("@whiskeysockets/baileys").BaileysEventEmitter} event
 * @returns
 */
export default function messageHandler(sessionId, event) {
	let listening = false;

	const set = async ({ messages, isLatest }) => {
		try {
			await prisma.$transaction(async (tx) => {
				if (isLatest) {
					await tx.message.deleteMany({ where: { sessionId } });
				}

				await tx.message.createMany({
					data: messages.map((message) => {
						return {
							...transformPrisma(message),
							remoteJid: message.key.remoteJid,
							id: message.key.id,
							sessionId,
						};
					}),
				});
			});
			logger.info({ messages: messages.length }, "Synced messages");
		} catch (e) {
			logger.error(e, "An error occured during messages set");
		}
	};

	const upsert = async ({ messages, type }) => {
		switch (type) {
			case "append":
			case "notify":
				for (const message of messages) {
					try {
						const jid = jidNormalizedUser(message.key.remoteJid);
						const data = transformPrisma(message);
						await prisma.message.upsert({
							select: { pkId: true },
							create: {
								...data,
								remoteJid: jid,
								id: message.key.id,
								sessionId,
							},
							update: { ...data },
							where: { sessionId_remoteJid_id: { remoteJid: jid, id: message.key.id, sessionId } },
						});

						const chatExists = (await prisma.chat.count({ where: { id: jid, sessionId } })) > 0;
						if (type === "notify" && !chatExists) {
							event.emit("chats.upsert", [
								{
									id: jid,
									conversationTimestamp: toNumber(message.messageTimestamp),
									unreadCount: 1,
								},
							]);
						}
					} catch (e) {
						logger.error(e, "An error occured during message upsert");
					}
				}

				break;
		}
	};

	const update = async (updates) => {
		for (const { update, key } of updates) {
			try {
				await prisma.$transaction(async (tx) => {
					const prevData = await tx.message.findFirst({
						where: { id: key.id, remoteJid: key.remoteJid, sessionId },
					});
					if (!prevData) {
						return logger.info({ update }, "Got update for non existent message");
					}

					const data = { ...prevData, ...update };
					await tx.message.delete({
						select: { pkId: true },
						where: {
							sessionId_remoteJid_id: {
								id: key.id,
								remoteJid: key.remoteJid,
								sessionId,
							},
						},
					});
					await tx.message.create({
						select: { pkId: true },
						data: {
							...transformPrisma(data),
							id: data.key.id,
							remoteJid: data.key.remoteJid,
							sessionId,
						},
					});
				});
			} catch (e) {
				logger.error(e, "An error occured during message update");
			}
		}
	};

	const del = async (item) => {
		try {
			if ("all" in item) {
				await prisma.message.deleteMany({ where: { remoteJid: item.jid, sessionId } });
				return;
			}

			const jid = item.keys[0].remoteJid;
			await prisma.message.deleteMany({
				where: {
					id: {
						in: item.keys.map((k) => {
							return k.id;
						}),
					},
					remoteJid: jid,
					sessionId,
				},
			});
		} catch (e) {
			logger.error(e, "An error occured during message delete");
		}
	};

	const updateReceipt = async (updates) => {
		for (const { key, receipt } of updates) {
			try {
				await prisma.$transaction(async (tx) => {
					const message = await tx.message.findFirst({
						select: { userReceipt: true },
						where: { id: key.id, remoteJid: key.remoteJid, sessionId },
					});
					if (!message) {
						return logger.debug({ update }, "Got receipt update for non existent message");
					}

					let userReceipt = message.userReceipt || [];
					const recepient = userReceipt.find((m) => {
						return m.userJid === receipt.userJid;
					});

					if (recepient) {
						userReceipt = [
							...userReceipt.filter((m) => {
								return m.userJid !== receipt.userJid;
							}),
							receipt,
						];
					} else {
						userReceipt.push(receipt);
					}

					await tx.message.update({
						select: { pkId: true },
						data: transformPrisma({ userReceipt }),
						where: {
							sessionId_remoteJid_id: { id: key.id, remoteJid: key.remoteJid, sessionId },
						},
					});
				});
			} catch (e) {
				logger.error(e, "An error occured during message receipt update");
			}
		}
	};

	const updateReaction = async (reactions) => {
		for (const { key, reaction } of reactions) {
			try {
				await prisma.$transaction(async (tx) => {
					const message = await tx.message.findFirst({
						select: { reactions: true },
						where: { id: key.id, remoteJid: key.remoteJid, sessionId },
					});
					if (!message) {
						return logger.debug({ update }, "Got reaction update for non existent message");
					}

					const authorID = getKeyAuthor(reaction.key);
					const reactions = (message.reactions || []).filter((r) => {
						return getKeyAuthor(r.key) !== authorID;
					});

					if (reaction.text) {
						reactions.push(reaction);
					}

					await tx.message.update({
						select: { pkId: true },
						data: transformPrisma({ reactions }),
						where: {
							sessionId_remoteJid_id: { id: key.id, remoteJid: key.remoteJid, sessionId },
						},
					});
				});
			} catch (e) {
				logger.error(e, "An error occured during message reaction update");
			}
		}
	};

	const listen = () => {
		if (listening) {
			return;
		}

		event.on("messaging-history.set", set);
		event.on("messages.upsert", upsert);
		event.on("messages.update", update);
		event.on("messages.delete", del);
		event.on("message-receipt.update", updateReceipt);
		event.on("messages.reaction", updateReaction);
		listening = true;
	};

	const unlisten = () => {
		if (!listening) {
			return;
		}

		event.off("messaging-history.set", set);
		event.off("messages.upsert", upsert);
		event.off("messages.update", update);
		event.off("messages.delete", del);
		event.off("message-receipt.update", updateReceipt);
		event.off("messages.reaction", updateReaction);
		listening = false;
	};

	return { listen, unlisten };
}
