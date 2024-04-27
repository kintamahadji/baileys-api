import { transformPrisma } from "../utils.js";
import { prisma } from "../../db.js";
import { logger } from "../../shared.js";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library.js";

/**
 *
 * @param {String} sessionId
 * @param {import('@whiskeysockets/baileys').BaileysEventEmitter} event
 * @returns
 */
export default function contactHandler(sessionId, event) {
	let listening = false;

	const set = async ({ contacts }) => {
		try {
			const contactIds = contacts.map((c) => {
				return c.id;
			});
			const deletedOldContactIds = (
				await prisma.contact.findMany({
					select: { id: true },
					where: { id: { notIn: contactIds }, sessionId },
				})
			).map((c) => {
				return c.id;
			});

			const upsertPromises = contacts
				.map((c) => {
					return transformPrisma(c);
				})
				.map((data) => {
					return prisma.contact.upsert({
						select: { pkId: true },
						create: { ...data, sessionId },
						update: data,
						where: { sessionId_id: { id: data.id, sessionId } },
					});
				});

			await Promise.any([
				...upsertPromises,
				prisma.contact.deleteMany({ where: { id: { in: deletedOldContactIds }, sessionId } }),
			]);
			logger.info(
				{ deletedContacts: deletedOldContactIds.length, newContacts: contacts.length },
				"Synced contacts",
			);
		} catch (e) {
			logger.error(e, "An error occured during contacts set");
		}
	};

	const upsert = async (contacts) => {
		try {
			await Promise.any(
				contacts
					.map((c) => {
						return transformPrisma(c);
					})
					.map((data) => {
						return prisma.contact.upsert({
							select: { pkId: true },
							create: { ...data, sessionId },
							update: data,
							where: { sessionId_id: { id: data.id, sessionId } },
						});
					}),
			);
		} catch (e) {
			logger.error(e, "An error occured during contacts upsert");
		}
	};

	const update = async (updates) => {
		for (const update of updates) {
			try {
				await prisma.contact.update({
					select: { pkId: true },
					data: transformPrisma(update),
					where: {
						sessionId_id: { id: update.id, sessionId },
					},
				});
			} catch (e) {
				if (e instanceof PrismaClientKnownRequestError && e.code === "P2025") {
					return logger.info({ update }, "Got update for non existent contact");
				}

				logger.error(e, "An error occured during contact update");
			}
		}
	};

	const listen = () => {
		if (listening) {
			return;
		}

		event.on("messaging-history.set", set);
		event.on("contacts.upsert", upsert);
		event.on("contacts.update", update);
		listening = true;
	};

	const unlisten = () => {
		if (!listening) {
			return;
		}

		event.off("messaging-history.set", set);
		event.off("contacts.upsert", upsert);
		event.off("contacts.update", update);
		listening = false;
	};

	return { listen, unlisten };
}
