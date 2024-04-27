import { sessionExists } from "../whatsapp.js";

/**
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns
 */
export default function sessionValidator(req, res, next) {
	if (!sessionExists(req.params.sessionId)) {
		return res.status(404).json({ error: "Session not found" });
	}

	next();
}
