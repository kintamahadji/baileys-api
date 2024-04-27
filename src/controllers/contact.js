import { logger } from "../shared.js";
import { getSession, jidExists } from "../whatsapp.js";
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
		const contacts = await prisma.contact.findMany({
			cursor: cursor ? { pkId: Number(cursor) } : undefined,
			take: Number(limit),
			skip: cursor ? 1 : 0,
			where: { id: { endsWith: "s.whatsapp.net" }, sessionId },
		});

		res.status(200).json({
			data: contacts,
			cursor:
				contacts.length !== 0 && contacts.length === Number(limit)
					? contacts[contacts.length - 1].pkId
					: null,
		});
	} catch (e) {
		const message = "An error occured during contact list";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const listBlocked = async (req, res) => {
	try {
		const session = getSession(req.params.sessionId);
		const data = await session.fetchBlocklist();
		res.status(200).json(data);
	} catch (e) {
		const message = "An error occured during blocklist fetch";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const updateBlock = async (req, res) => {
	try {
		const session = getSession(req.params.sessionId);
		const { jid, action = "block" } = req.body;

		const exists = await jidExists(session, jid);
		if (!exists) {
			return res.status(400).json({ error: "Jid does not exists" });
		}

		await session.updateBlockStatus(jid, action);
		res.status(200).json({ message: `Contact ${action}ed` });
	} catch (e) {
		const message = "An error occured during blocklist update";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const check = async (req, res) => {
	try {
		const { sessionId, jid } = req.params;
		const session = getSession(sessionId);

		const exists = await jidExists(session, jid);
		res.status(200).json({ exists });
	} catch (e) {
		const message = "An error occured during jid check";
		logger.error(e, message);
		res.status(500).json({ error: message });
	}
};

export const photo = makePhotoURLHandler();
