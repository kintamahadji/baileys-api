import {
	createSession,
	deleteSession,
	getSession,
	getSessionStatus,
	listSessions,
	sessionExists,
} from "../whatsapp.js";

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const list = (req, res) => {
	res.status(200).json(listSessions());
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const find = (req, res) => {
	return res.status(200).json({ message: "Session found" });
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const status = (req, res) => {
	const session = getSession(req.params.sessionId);
	res.status(200).json({ status: getSessionStatus(session) });
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const add = async (req, res) => {
	const { sessionId, readIncomingMessages, ...socketConfig } = req.body;

	if (sessionExists(sessionId)) {
		return res.status(400).json({ error: "Session already exists" });
	}

	createSession({ sessionId, res, readIncomingMessages, socketConfig });
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const addSSE = async (req, res) => {
	const { sessionId } = req.params;
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	if (sessionExists(sessionId)) {
		res.write(`data: ${JSON.stringify({ error: "Session already exists" })}\n\n`);
		res.end();
		return;
	}

	createSession({ sessionId, res, SSE: true });
};

/**
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const del = async (req, res) => {
	await deleteSession(req.params.sessionId);
	res.status(200).json({ message: "Session deleted" });
};
