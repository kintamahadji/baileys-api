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
export default function groupMetadataHandler(sessionId, event) {
	const model = prisma.groupMetadata;
	let listening = false;

	const upsert = async (groups) => {
		const promises = [];

		for (const group of groups) {
			const data = transformPrisma(group);
			promises.push(
				model.upsert({
					select: { pkId: true },
					create: { ...data, sessionId },
					update: data,
					where: { sessionId_id: { id: group.id, sessionId } },
				}),
			);
		}

		try {
			await Promise.all(promises);
		} catch (e) {
			logger.error(e, "An error occured during groups upsert");
		}
	};

	const update = async (updates) => {
		for (const update of updates) {
			try {
				await model.update({
					select: { pkId: true },
					data: transformPrisma(update),
					where: { sessionId_id: { id: update.id, sessionId } },
				});
			} catch (e) {
				if (e instanceof PrismaClientKnownRequestError && e.code === "P2025") {
					return logger.info({ update }, "Got metadata update for non existent group");
				}

				logger.error(e, "An error occured during group metadata update");
			}
		}
	};

	const updateParticipant = async ({ id, action, participants }) => {
		try {
			const metadata =
				(await model.findFirst({
					select: { participants: true },
					where: { id, sessionId },
				})) ||
				[] ||
				null;

			if (!metadata) {
				return logger.info(
					{ update: { id, action, participants } },
					"Got participants update for non existent group",
				);
			}

			switch (action) {
				case "add":
				case "revoked_membership_requests":
					metadata.participants.push(
						participants.map((id) => {
							return { id, isAdmin: false, isSuperAdmin: false };
						}),
					);
					break;
				case "demote":
				case "promote":
					for (const participant of metadata.participants) {
						if (participants.includes(participant.id)) {
							participant.isAdmin = action === "promote";
						}
					}

					break;
				case "remove":
				case "leave":
					metadata.participants = metadata.participants.filter((p) => {
						return !participants.includes(p.id);
					});
					break;
			}

			await model.update({
				select: { pkId: true },
				data: transformPrisma({ participants: metadata.participants }),
				where: { sessionId_id: { id, sessionId } },
			});
		} catch (e) {
			logger.error(e, "An error occured during group participants update");
		}
	};

	const listen = () => {
		if (listening) {
			return;
		}

		event.on("groups.upsert", upsert);
		event.on("groups.update", update);
		event.on("group-participants.update", updateParticipant);
		listening = true;
	};

	const unlisten = () => {
		if (!listening) {
			return;
		}

		event.off("groups.upsert", upsert);
		event.off("groups.update", update);
		event.off("group-participants.update", updateParticipant);
		listening = false;
	};

	return { listen, unlisten };
}
