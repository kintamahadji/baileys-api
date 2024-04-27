import { logger } from "../shared.js";
import { getSession } from "../whatsapp.js";
import { makePhotoURLHandler } from "./misc.js";
import { prisma } from "../db.js";

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const list = async (req, res) => {
	try {
		const { sessionId } = req.params;
		const { cursor = undefined, limit = 25 } = req.query;
		const groups = await prisma.contact.findMany({
			cursor: cursor ? { pkId: Number(cursor) } : undefined,
			take: Number(limit),
			skip: cursor ? 1 : 0,
			where: { id: { endsWith: "g.us" }, sessionId },
		});

		res.status(200).json({
			data: groups,
			cursor:
				groups.length !== 0 && groups.length === Number(limit)
					? groups[groups.length - 1].pkId
					: null,
		});
	} catch (e) {
		const message = "An error occured during group list";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const find = async (req, res) => {
	try {
		const { sessionId, jid } = req.params;
		const session = getSession(sessionId);
		const data = await session.groupMetadata(jid);
		res.status(200).json(data);
	} catch (e) {
		const message = "An error occured during group metadata fetch";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};

export const photo = makePhotoURLHandler("group");
