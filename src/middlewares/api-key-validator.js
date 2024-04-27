import dotenv from "dotenv";

dotenv.config();

/**
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns
 */
export function apiKeyValidator(req, res, next) {
	const apiKey = process.env.API_KEY;

	if (apiKey === undefined) {
		return next();
	}

	const headerApiKey = req.headers["x-api-key"] || req.headers["X-API-Key"];
	if (!headerApiKey) {
		return res.status(403).json({ error: "X-API-Key Header doesn't exist" });
	}

	if (headerApiKey !== apiKey) {
		return res.status(403).json({ error: "Your API key is invalid" });
	}

	next();
}

/**
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns
 */
export function apiKeyValidatorParam(req, res, next) {
	const apiKey = process.env.API_KEY;

	if (apiKey === undefined) {
		return next();
	}

	const paramApiKey = req.query.api_key || req.query.API_KEY;
	if (!paramApiKey) {
		return res.status(403).json({ error: "api_key query params doesn't exist" });
	}

	if (paramApiKey !== apiKey) {
		return res.status(403).json({ error: "Your API key is invalid" });
	}

	next();
}
