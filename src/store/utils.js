import { toNumber } from "@whiskeysockets/baileys";
import Long from "long";

/**
 * Transform object props value into Prisma-supported types
 * @param {<T extends Record<string, any>>} data
 * @param {Boolean} removeNullable
 */
export function transformPrisma(data, removeNullable = true) {
	const obj = { ...data };

	for (const [key, val] of Object.entries(obj)) {
		if (val instanceof Uint8Array) {
			obj[key] = Buffer.from(val);
		} else if (typeof val === "number" || val instanceof Long) {
			obj[key] = toNumber(val);
		} else if (removeNullable && (typeof val === "undefined" || val === null)) {
			delete obj[key];
		}
	}

	return obj;
}

/**
 * Transform prisma result into JSON serializable types
 * @param {<T extends Record<string, any>>} data
 * @param {Boolean} removeNullable
 */
export function serializePrisma(data, removeNullable = true) {
	const obj = { ...data };

	for (const [key, val] of Object.entries(obj)) {
		if (val instanceof Buffer) {
			obj[key] = val.toJSON();
		} else if (typeof val === "bigint" || val instanceof BigInt) {
			obj[key] = val.toString();
		} else if (removeNullable && (typeof val === "undefined" || val === null)) {
			delete obj[key];
		}
	}

	return obj;
}
